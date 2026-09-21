// Run with: node backend/test.js
const fs = require('fs');
const vm = require('vm');
const path = require('path');
const assert = require('assert');

const code = fs.readFileSync(path.join(__dirname, 'Code.gs'), 'utf8');
const T = vm.runInNewContext(code + `
;({ CONFIG, schema_, colLetter_, safeCell_, normaliseMobile_, validateBooking_, generateReference_, findDuplicate_,
   parseAmount_, matchPayments_, deriveStatus_, computeSummary_, buildConfirmationEmail_, ALPHABET })`, {});

const plain = (x) => JSON.parse(JSON.stringify(x));
let passed = 0;
function test(name, fn) { fn(); passed++; console.log('ok  ' + name); }
const good = { name: ' Priya  Kumar ', email: 'Priya@Example.com ', mobile: '+44 7700 900123',
  counts: { adult: 2, youth: 1, child: 1, infant: 1 }, veg: 2, consent: true };

test('valid booking is priced by the server and normalised', () => {
  const v = T.validateBooking_(good, T.CONFIG);
  assert.deepStrictEqual(plain(v.errors), []);
  assert.strictEqual(v.value.total, 2 * 40 + 30 + 20);
  assert.strictEqual(v.value.people, 5);
  assert.strictEqual(v.value.nonVeg, 3);
  assert.strictEqual(v.value.name, 'Priya Kumar');
  assert.strictEqual(v.value.email, 'priya@example.com');
  assert.strictEqual(v.value.mobile, '07700900123');
});

test('client-supplied total or prices are ignored', () => {
  const v = T.validateBooking_(Object.assign({}, good, { total: 1, prices: { adult: 1 } }), T.CONFIG);
  assert.strictEqual(v.value.total, 130);
});

test('bad inputs are rejected', () => {
  const bad = (patch) => T.validateBooking_(Object.assign({}, good, patch), T.CONFIG).errors.length > 0;
  assert(bad({ name: '' }));
  assert(bad({ email: 'nope' }));
  assert(bad({ mobile: '123' }));
  assert(bad({ counts: { adult: 11 } }));
  assert(bad({ counts: { adult: -1 } }));
  assert(bad({ counts: { adult: 1.5 } }));
  assert(bad({ counts: { infant: 2 } }), 'only free tickets');
  assert(bad({ veg: 99 }));
  assert(bad({ consent: false }));
});

test('references use the safe alphabet and are unique', () => {
  const existing = {};
  for (let i = 0; i < 2000; i++) {
    const r = T.generateReference_('AOR', existing);
    assert(/^AOR[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{5}$/.test(r), r);
    assert(!/[01OIL]/.test(r.slice(3)));
    existing[r] = true;
  }
  assert.strictEqual(Object.keys(existing).length, 2000);
});

test('reference generation retries on collision', () => {
  let calls = 0;
  const rnd = () => (calls++ < 5 ? 0 : 0.5);
  const first = 'AOR' + 'AAAAA';
  const r = T.generateReference_('AOR', { [first]: true }, rnd);
  assert.notStrictEqual(r, first);
});

test('a double submit returns the existing booking', () => {
  const v = T.validateBooking_(good, T.CONFIG).value;
  const existing = [{ ref: 'AOR22222', status: 'Pending', email: v.email, mobile: v.mobile, counts: v.counts, bookedAt: new Date(Date.now() - 60000) }];
  assert(T.findDuplicate_(existing, v, Date.now()));
  assert.strictEqual(T.findDuplicate_([Object.assign({}, existing[0], { counts: { adult: 1 } })], v, Date.now()), null);
  assert.strictEqual(T.findDuplicate_([Object.assign({}, existing[0], { status: 'Cancelled' })], v, Date.now()), null);
  assert.strictEqual(T.findDuplicate_([Object.assign({}, existing[0], { bookedAt: new Date(Date.now() - 3 * 864e5) })], v, Date.now()), null);
});

test('spreadsheet formula injection is neutralised', () => {
  assert.strictEqual(T.safeCell_('=HYPERLINK("x")'), "'=HYPERLINK(\"x\")");
  assert.strictEqual(T.safeCell_('Priya'), 'Priya');
});

test('column letters', () => {
  assert.strictEqual(T.colLetter_(1), 'A');
  assert.strictEqual(T.colLetter_(26), 'Z');
  assert.strictEqual(T.colLetter_(27), 'AA');
});

const B = (ref, mobile, total, extra) => Object.assign({ ref, mobile, total, status: 'Pending', name: 'Name ' + ref, counts: {}, people: 1, veg: 0, nonVeg: 1, paidBank: 0, paidManual: 0 }, extra || {});
const bookings = [
  B('AOR7K3QP', '07700900111', 130), B('AORMMMMM', '07700900222', 40), B('AORNNNNN', '07700900333', 80),
  B('AORPPPPP', '07700900444', 80), B('AORQQQQQ', '07700900555', 60, { status: 'Cancelled' }),
];
const row = (desc, amount) => ({ desc, amount });
const match = (rows) => T.matchPayments_(bookings, rows, 'AOR');

test('matches the reference however the payer typed it', () => {
  const m = match([row('AOR7K3QP', 130), row('ref aor7k3qp thanks', 130), row('FP 12/10 aor 7k3qp', 130), row('AOR-7K3QP', 130)]);
  m.results.forEach((r) => { assert.strictEqual(r.status, 'matched'); assert.strictEqual(r.ref, 'AOR7K3QP'); });
  assert.strictEqual(m.paid.AOR7K3QP, 520);
});

test('falls back to the mobile number when the reference is wrong', () => {
  const m = match([row('07700900222 pongal', 40), row('+44 7700 900222', 40)]);
  assert.strictEqual(m.results[0].ref, 'AORMMMMM');
  assert.match(m.results[0].text, /check/);
});

test('an unknown reference with a unique matching amount is only suggested, never applied', () => {
  const m = match([row('PONGAL TICKETS', 130)]);
  assert.strictEqual(m.results[0].status, 'unmatched');
  assert.match(m.results[0].text, /Possible: AOR7K3QP/);
  assert.strictEqual(Object.keys(m.paid).length, 0);
});

test('an amount that fits several unpaid bookings asks for the reference', () => {
  const m = match([row('PONGAL', 80)]);
  assert.strictEqual(m.results[0].status, 'unmatched');
  assert.match(m.results[0].text, /2 unpaid bookings/);
});

test('money going out, zero rows and unrelated payments are not matched', () => {
  const m = match([row('AOR7K3QP', -130), row('AOR7K3QP', 0), row('SALARY', 1234.5)]);
  assert.strictEqual(m.results[0].status, 'skip');
  assert.strictEqual(m.results[1].status, 'skip');
  assert.strictEqual(m.results[2].status, 'unmatched');
  assert.strictEqual(Object.keys(m.paid).length, 0);
});

test('a reference that does not exist is not matched', () => {
  const m = match([row('AORZZZZZ', 40)]);
  assert.notStrictEqual(m.results[0].status, 'matched');
});

test('status: pending, part paid, paid, overpaid, cancelled', () => {
  assert.strictEqual(T.deriveStatus_(130, 0, 'Pending'), 'Pending');
  assert.strictEqual(T.deriveStatus_(130, 100, 'Pending'), 'Part paid');
  assert.strictEqual(T.deriveStatus_(130, 130, 'Pending'), 'Paid');
  assert.strictEqual(T.deriveStatus_(130, 260, 'Pending'), 'Overpaid');
  assert.strictEqual(T.deriveStatus_(130, 130, 'Cancelled'), 'Cancelled');
  assert.strictEqual(T.deriveStatus_(0.3, 0.1 + 0.2, 'Pending'), 'Paid', 'float safe');
});

test('paying twice is spotted as overpaid', () => {
  const m = match([row('AORMMMMM', 40), row('AORMMMMM', 40)]);
  assert.strictEqual(T.deriveStatus_(40, m.paid.AORMMMMM, 'Pending'), 'Overpaid');
});

test('summary totals for the caterer and treasurer', () => {
  const list = [
    B('A', '1', 130, { status: 'Paid', paidBank: 130, people: 5, veg: 2, nonVeg: 3, counts: { adult: 2, youth: 1, child: 1, infant: 1 } }),
    B('B', '2', 40, { status: 'Pending', people: 1, veg: 1, nonVeg: 0, counts: { adult: 1 } }),
    B('C', '3', 80, { status: 'Cancelled', people: 2, counts: { adult: 2 } }),
  ];
  const s = T.computeSummary_(list, T.CONFIG);
  const get = (label) => s.find((r) => r[0] === label);
  assert.deepStrictEqual(plain(get('Adult (25 and over)').slice(1)), [3, 2]);
  assert.deepStrictEqual(plain(get('Total people').slice(1)), [6, 5]);
  assert.deepStrictEqual(plain(get('Vegetarian').slice(1)), [3, 2]);
  assert.deepStrictEqual(plain(get('Non-vegetarian').slice(1)), [3, 3]);
  assert.deepStrictEqual(plain(get('Money expected (£)').slice(1)), [170, 130]);
  assert.deepStrictEqual(get('Still to collect (£)')[1], 40);
});

test('confirmation email has the reference, amount and bank details', () => {
  const v = T.validateBooking_(good, T.CONFIG).value;
  v.ref = 'AOR7K3QP';
  const mail = T.buildConfirmationEmail_(v, T.CONFIG);
  assert(mail.subject.includes('AOR7K3QP'));
  ['AOR7K3QP', '£130', T.CONFIG.bank.sortCode, T.CONFIG.bank.accountNumber, 'Adult (25 and over) x 2 = £80'].forEach((s) => assert(mail.body.includes(s), s));
});

test('sheet schema is consistent', () => {
  const S = T.schema_();
  assert.strictEqual(S.keys.length, S.headers.length);
  assert.strictEqual(new Set(S.keys).size, S.keys.length);
});

console.log('\n' + passed + ' tests passed');
