// Run with: node backend/test.js
const fs = require('fs');
const vm = require('vm');
const path = require('path');
const assert = require('assert');

const code = fs.readFileSync(path.join(__dirname, 'Code.gs'), 'utf8');
const T = vm.runInNewContext(code + `
;({ CONFIG, DEFAULTS, SETTING_DEFS, REF_BLOCKED, schema_, colLetter_, safeCell_, normaliseMobile_, validateBooking_,
   generateReference_, findDuplicate_, parseAmount_, matchPayments_, deriveStatus_, computeSummary_,
   buildConfirmationEmail_, parseSettings_, ss_ })`, { SpreadsheetApp: { getActiveSpreadsheet: () => null } });

const plain = (x) => JSON.parse(JSON.stringify(x));
let passed = 0;
function test(name, fn) { fn(); passed++; console.log('ok  ' + name); }
const good = { name: ' Priya  Kumar ', email: 'Priya@Example.com ', mobile: '+44 7700 900123',
  counts: { adult: 2, youth: 1, child: 1, infant: 1 }, veg: 2, consent: true };

// ---------- bookings ----------
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

// ---------- references ----------
test('references are 5 easy-to-type letters, name-shaped, and unique', () => {
  const existing = {};
  for (let i = 0; i < 3000; i++) {
    const r = T.generateReference_(existing);
    assert(/^[BDGKLMNPRSTV][AEIOU][BDGKLMNPRSTV][AEIOU][BDGKLMNPRSTV]$/.test(r), r);
    existing[r] = true;
  }
  assert.strictEqual(Object.keys(existing).length, 3000);
});

test('blocked words are never issued', () => {
  const blocked = plain(T.REF_BLOCKED).filter((w) => /^[BDGKLMNPRSTV][AEIOU][BDGKLMNPRSTV][AEIOU][BDGKLMNPRSTV]$/.test(w));
  assert(blocked.length >= 5, 'blocklist should contain reachable words');
  for (const word of blocked) {
    // force the generator to produce exactly this word first, then something else
    const letters = word.split('');
    const seq = [];
    letters.forEach((ch, i) => {
      const set = i % 2 === 0 ? 'BDGKLMNPRSTV' : 'AEIOU';
      seq.push((set.indexOf(ch) + 0.5) / set.length);
    });
    let n = 0;
    const rnd = () => (n < 5 ? seq[n++] : 0.99);
    const r = T.generateReference_({}, rnd);
    assert.notStrictEqual(r, word);
  }
});

test('real bank words and common surnames are blocked', () => {
  ['SAVER', 'DEBIT', 'TOTAL', 'KUMAR', 'TAMIL'].forEach((w) => assert(plain(T.REF_BLOCKED).includes(w), w));
});

test('reference generation retries on collision', () => {
  let calls = 0;
  const rnd = () => (calls++ < 5 ? 0 : 0.5);
  const r = T.generateReference_({ BABAB: true }, rnd);
  assert.notStrictEqual(r, 'BABAB');
});

test('a double submit returns the existing booking', () => {
  const v = T.validateBooking_(good, T.CONFIG).value;
  const existing = [{ ref: 'RAKIM', status: 'Pending', email: v.email, mobile: v.mobile, counts: v.counts, bookedAt: new Date(Date.now() - 60000) }];
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

// ---------- bank matching ----------
const B = (ref, mobile, total, extra) => Object.assign({ ref, mobile, total, status: 'Pending', name: 'Name ' + ref, counts: {}, people: 1, veg: 0, nonVeg: 1, paidBank: 0, paidManual: 0 }, extra || {});
const bookings = [
  B('RAKIM', '07700900111', 130), B('MODAN', '07700900222', 40), B('NEGUS', '07700900333', 80),
  B('POSIL', '07700900444', 80), B('TUBEK', '07700900555', 60, { status: 'Cancelled' }),
];
const row = (desc, amount) => ({ desc, amount });
const match = (rows) => T.matchPayments_(bookings, rows);

test('matches the reference however the payer typed it', () => {
  const m = match([row('RAKIM', 130), row('ref rakim thanks', 130), row('FP 12/10 Rakim.', 130), row('Rakim-Pongal', 130), row('PONGAL: RAKIM', 130)]);
  m.results.forEach((r) => { assert.strictEqual(r.status, 'matched'); assert.strictEqual(r.ref, 'RAKIM'); });
  assert.strictEqual(m.paid.RAKIM, 650);
});

test('a reference glued into other letters is NOT guessed at (no false matches)', () => {
  const m = match([row('PONGALRAKIMTICKETS', 130)]);
  assert.strictEqual(m.results[0].status, 'unmatched');
  assert.match(m.results[0].text, /Possible: RAKIM/);
});

test('ordinary bank text never matches a booking by accident', () => {
  const texts = ['FASTER PAYMENT FROM MRS P KUMAR', 'TICKETS FOR DINNER', 'PONGAL 2027 ADULT TICKET', 'MOBILE PAYMENT TOTAL DEBIT', 'MR RAJ SENIOR'];
  texts.forEach((t) => assert.notStrictEqual(match([row(t, 12.34)]).results[0].status, 'matched', t));
});

test('a payer whose NAME equals a reference is not matched unless the amount also fits', () => {
  // NEGUS is a reference for an £80 booking; here it is just a surname on a £25 payment
  const wrongAmount = match([row('FASTER PAYMENT MR NEGUS TICKETS', 25)]);
  assert.strictEqual(wrongAmount.results[0].status, 'unmatched');
  assert.strictEqual(Object.keys(wrongAmount.paid).length, 0);
  assert.match(wrongAmount.results[0].text, /NEGUS.*not the £80 they owe/);
  // the real payment for that booking still matches
  assert.strictEqual(match([row('MR NEGUS', 80)]).results[0].ref, 'NEGUS');
});

test('a part payment or wrong amount is flagged for a human, not silently applied', () => {
  const m = match([row('RAKIM', 100)]);
  assert.strictEqual(m.results[0].status, 'unmatched');
  assert.match(m.results[0].text, /enter 100 in Paid manually for RAKIM/);
  assert.strictEqual(Object.keys(m.paid).length, 0);
});

test('paying the remaining balance after a manual part payment matches', () => {
  const list = [B('RAKIM', '07700900111', 130, { paidManual: 100 })];
  const m = T.matchPayments_(list, [row('RAKIM', 30)]);
  assert.strictEqual(m.results[0].status, 'matched');
  assert.strictEqual(m.paid.RAKIM, 30);
});

test('falls back to the mobile number when the reference is wrong', () => {
  const m = match([row('07700900222 pongal', 40), row('+44 7700 900222', 40)]);
  assert.strictEqual(m.results[0].ref, 'MODAN');
  assert.match(m.results[0].text, /check/);
});

test('an unknown reference with a unique matching amount is only suggested, never applied', () => {
  const m = match([row('PONGAL TICKETS', 130)]);
  assert.strictEqual(m.results[0].status, 'unmatched');
  assert.match(m.results[0].text, /Possible: RAKIM/);
  assert.strictEqual(Object.keys(m.paid).length, 0);
});

test('an amount that fits several unpaid bookings asks for the reference', () => {
  const m = match([row('PONGAL', 80)]);
  assert.strictEqual(m.results[0].status, 'unmatched');
  assert.match(m.results[0].text, /2 unpaid bookings/);
});

test('mobile number fallback also needs the right amount', () => {
  const m = match([row('07700900222', 5)]);
  assert.strictEqual(m.results[0].status, 'unmatched');
  assert.match(m.results[0].text, /MODAN/);
});

test('money going out, zero rows and unrelated payments are not matched', () => {
  const m = match([row('RAKIM', -130), row('RAKIM', 0), row('SALARY', 1234.5)]);
  assert.strictEqual(m.results[0].status, 'skip');
  assert.strictEqual(m.results[1].status, 'skip');
  assert.strictEqual(m.results[2].status, 'unmatched');
  assert.strictEqual(Object.keys(m.paid).length, 0);
});

test('a reference that does not exist is not matched', () => {
  assert.notStrictEqual(match([row('ZZZZZ', 40)]).results[0].status, 'matched');
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
  const m = match([row('MODAN', 40), row('MODAN', 40)]);
  assert.strictEqual(T.deriveStatus_(40, m.paid.MODAN, 'Pending'), 'Overpaid');
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
  assert.strictEqual(get('Still to collect (£)')[1], 40);
});

test('confirmation email has the reference, amount, bank details and says to keep it', () => {
  const v = T.validateBooking_(good, T.CONFIG).value;
  v.ref = 'RAKIM';
  const mail = T.buildConfirmationEmail_(v, T.CONFIG);
  assert(mail.subject.includes('RAKIM'));
  ['PAYMENT REFERENCE: RAKIM', '£130', T.CONFIG.bank.sortCode, T.CONFIG.bank.accountNumber, 'Adult (25 and over) x 2 = £80', 'Keep this email'].forEach((s) => assert(mail.body.includes(s), s));
});

test('sheet schema is consistent', () => {
  const S = T.schema_();
  assert.strictEqual(S.keys.length, S.headers.length);
  assert.strictEqual(new Set(S.keys).size, S.keys.length);
});

// ---------- Settings sheet ----------
const goodVals = { organiser: 'Tamil Sangam', eventName: 'Diwali Night 2027', dateText: 'Sat 6 Nov, 6pm', venue: 'Town Hall',
  contactEmail: 'sangam@example.com', bankAccountName: 'TAMIL SANGAM', bankSortCode: '12 34 56', bankAccountNumber: '12345678',
  payWithinDays: '5', capacity: '250', bookingsOpen: 'Yes', askFood: 'Yes', closedMessage: '' };
const goodTickets = [['Adult', 25, 10], ['Child', '£12.50', ''], ['Under 5', 0, 4], ['', '', ''], ['', '', ''], ['', '', ''], ['', '', ''], ['', '', '']];
const settings = (v, t) => plain(T.parseSettings_(Object.assign({}, goodVals, v), t || goodTickets));

test('valid settings are accepted and normalised', () => {
  const c = settings({});
  assert.deepStrictEqual(c.problems, []);
  assert.strictEqual(c.bank.sortCode, '12-34-56');
  assert.strictEqual(c.bank.accountNumber, '12345678');
  assert.strictEqual(c.payWithinDays, 5);
  assert.strictEqual(c.capacity, 250);
  assert.strictEqual(c.bookingsOpen, true);
  assert.deepStrictEqual(c.tickets.map((t) => [t.key, t.label, t.price, t.max]), [['t1', 'Adult', 25, 10], ['t2', 'Child', 12.5, 10], ['t3', 'Under 5', 0, 4]]);
});

test('a new organisation can run a different event end to end', () => {
  const c = settings({});
  const v = T.validateBooking_({ name: 'Anu Raj', email: 'a@b.co', mobile: '07123456789', counts: { t1: 2, t2: 1, t3: 1 }, veg: 1, consent: true }, c);
  assert.deepStrictEqual(plain(v.errors), []);
  assert.strictEqual(v.value.total, 62.5);
});

test('the example bank details are refused so nobody is told to pay 00-00-00', () => {
  const c = settings({ bankSortCode: '00-00-00', bankAccountNumber: '00000000' });
  assert(c.problems.some((p) => /example/.test(p)));
});

test('bad settings are reported in plain English', () => {
  const has = (patch, re, t) => assert(settings(patch, t).problems.some((p) => re.test(p)), JSON.stringify(patch) + ' -> ' + re);
  has({ eventName: '' }, /Event name/);
  has({ contactEmail: 'nope' }, /Contact email/);
  has({ bankSortCode: '12345' }, /sort code.*6 digits/i);
  has({ bankAccountNumber: '1234567' }, /account number.*8 digits/i);
  has({ payWithinDays: '0' }, /Days to pay/);
  has({ capacity: '-1' }, /Maximum people/);
  has({ capacity: 'lots' }, /Maximum people/);
  has({ bookingsOpen: 'maybe' }, /Yes or No/);
  has({}, /Add at least one ticket/, []);
  has({}, /price above 0/, [['Free', 0, 5]]);
  has({}, /needs a price/, [['Adult', 'abc', 5]]);
  has({}, /needs a price/, [['Adult', '', 5]]);
  has({}, /max per booking/, [['Adult', 10, 0]]);
  has({}, /used twice/, [['Adult', 10, 5], ['adult', 12, 5]]);
  has({}, /no name/, [['', 10, 5], ['Adult', 10, 5]]);
});

test('bookings can be closed from the sheet', () => {
  assert.strictEqual(settings({ bookingsOpen: 'No' }).bookingsOpen, false);
  assert.strictEqual(settings({ bookingsOpen: 'no ' }).problems.length, 0);
});

test('shipped example values pass the checks except the bank details', () => {
  const d = T.DEFAULTS;
  const vals = { organiser: d.organiser, eventName: d.eventName, dateText: d.dateText, venue: d.venue, contactEmail: d.contactEmail,
    bankAccountName: d.bank.accountName, bankSortCode: d.bank.sortCode, bankAccountNumber: d.bank.accountNumber,
    payWithinDays: d.payWithinDays, capacity: d.capacity, bookingsOpen: 'Yes', askFood: 'Yes', closedMessage: d.closedMessage,
    tagline: d.tagline, tagline2: d.tagline2, logoUrl: d.logoUrl, websiteUrl: d.websiteUrl, headerColour: d.headerColour, buttonColour: d.buttonColour };
  const c = plain(T.parseSettings_(vals, d.tickets.map((t) => [t.label, t.price, t.max])));
  assert.strictEqual(c.problems.length, 1);
  assert.match(c.problems[0], /example/);
});

// ---------- price changes, other organisations, page look ----------
test('changing this year\'s prices is just editing the ticket table', () => {
  const lastYear = settings({}, [['Adult', 40, 10], ['Youth', 30, 10], ['Child', 20, 10]]);
  const thisYear = settings({}, [['Adult', 45, 10], ['Youth', 35, 10], ['Child', 22.5, 10]]);
  assert.deepStrictEqual(thisYear.problems, []);
  const order = { name: 'Anu Raj', email: 'a@b.co', mobile: '07123456789', counts: { t1: 2, t2: 1, t3: 2 }, veg: 0, consent: true };
  assert.strictEqual(T.validateBooking_(order, lastYear).value.total, 2 * 40 + 30 + 2 * 20);
  assert.strictEqual(T.validateBooking_(order, thisYear).value.total, 2 * 45 + 35 + 2 * 22.5);
});

test('an event without a food question stores no food numbers and asks nothing', () => {
  const c = settings({ askFood: 'No' });
  assert.strictEqual(c.askFood, false);
  const v = T.validateBooking_({ name: 'Anu Raj', email: 'a@b.co', mobile: '07123456789', counts: { t1: 2 }, veg: 99, consent: true }, c);
  assert.deepStrictEqual(plain(v.errors), []);
  assert.strictEqual(v.value.veg, 0);
  assert.strictEqual(v.value.nonVeg, 0);
  const b = Object.assign({ ref: 'RAKIM' }, v.value);
  assert(!T.buildConfirmationEmail_(b, c).body.includes('Vegetarian'));
  assert(!T.computeSummary_([], c).some((r) => /vegetarian/i.test(r[0])));
});

test('food question stays on by default', () => {
  const b = Object.assign({ ref: 'RAKIM' }, T.validateBooking_(good, T.CONFIG).value);
  assert(T.buildConfirmationEmail_(b, T.CONFIG).body.includes('Vegetarian: 2   Non-vegetarian: 3'));
});

test('page look settings are optional and validated', () => {
  const ok = settings({ tagline: 'Friends of Sangam', logoUrl: 'https://example.org/logo.png', websiteUrl: 'https://example.org', headerColour: '#123ABC', buttonColour: '#8e1b1b' });
  assert.deepStrictEqual(ok.problems, []);
  assert.strictEqual(ok.logoUrl, 'https://example.org/logo.png');
  assert.deepStrictEqual(settings({}).problems, []);
  const has = (patch, re) => assert(settings(patch).problems.some((p) => re.test(p)), JSON.stringify(patch));
  has({ logoUrl: 'http://example.org/logo.png' }, /logo web address.*https/);
  has({ logoUrl: 'javascript:alert(1)' }, /logo web address/);
  has({ websiteUrl: 'example.org' }, /your website.*https/);
  has({ headerColour: 'red' }, /header colour/);
  has({ buttonColour: '#12345' }, /button colour/);
});

test('two organisations can run different events from one script code', () => {
  const a = settings({ organiser: 'AORTAN', eventName: 'Pongal 2027' }, [['Adult', 45, 10], ['Child', 22, 10], ['Under 5', 0, 5]]);
  const b = settings({ organiser: 'Kerala Samajam', eventName: 'Onam 2027', bankAccountName: 'KERALA SAMAJAM', bankSortCode: '11-22-33', bankAccountNumber: '87654321', askFood: 'No' }, [['Member', 30, 6], ['Guest', 40, 6]]);
  assert.deepStrictEqual([a.problems, b.problems], [[], []]);
  const mail = T.buildConfirmationEmail_(Object.assign({ ref: 'MODAN', name: 'X Y', counts: { t1: 2 }, people: 2, veg: 0, nonVeg: 0, total: 60 }, {}), b);
  ['Kerala Samajam', 'Onam 2027', '11-22-33', '87654321', 'Member x 2 = £60'].forEach((x) => assert(mail.body.includes(x) || mail.subject.includes(x), x));
  assert(!mail.body.includes('AORTAN') && !mail.body.includes('Pongal'));
});

test('a script not attached to a Sheet says so in plain English', () => {
  assert.throws(() => T.ss_(), /not attached to a Google Sheet.*Extensions > Apps Script/);
});

test('the warm-up trigger is installed once and not duplicated on repeat setup', () => {
  const triggers = [];
  const sandbox = {
    console: { log() {}, error() {} },
    SpreadsheetApp: { getActiveSpreadsheet: () => null },
    ScriptApp: {
      getProjectTriggers: () => triggers,
      newTrigger(fn) {
        const t = { fn, timeBased: () => ({ everyMinutes: () => ({ create: () => { triggers.push({ getHandlerFunction: () => fn }); } }) }) };
        return t;
      },
    },
  };
  const U = vm.runInNewContext(code + '\n;({ installWarmupTrigger_ })', sandbox);
  U.installWarmupTrigger_();
  U.installWarmupTrigger_();
  U.installWarmupTrigger_();
  assert.strictEqual(triggers.length, 1);
  assert.strictEqual(triggers[0].getHandlerFunction(), 'keepWarm');
});

test('running from the code editor (no pop-up window) uses a toast instead of crashing', () => {
  const toasts = [];
  const sandbox = { console: { log() {}, error() {} }, SpreadsheetApp: {
    getUi() { throw new Error('Cannot call SpreadsheetApp.getUi() from this context.'); },
    getActiveSpreadsheet: () => ({ toast: (m, t) => toasts.push([t, m]) }),
  } };
  const U = vm.runInNewContext(code + '\n;({ notify_ })', sandbox);
  U.notify_('Setup done', 'Sheets ready');
  assert.deepStrictEqual(plain(toasts), [['Setup done', 'Sheets ready']]);
});

test('from the Sheet menu a pop-up window is used', () => {
  const alerts = [];
  const sandbox = { console: { log() {}, error() {} }, SpreadsheetApp: {
    getUi: () => ({ alert: (t, m) => alerts.push([t, m]), ButtonSet: { OK: 'OK' } }),
    getActiveSpreadsheet: () => ({ toast() { throw new Error('should not toast'); } }),
  } };
  const U = vm.runInNewContext(code + '\n;({ notify_ })', sandbox);
  U.notify_('Settings look good', 'All fine');
  assert.deepStrictEqual(plain(alerts), [['Settings look good', 'All fine']]);
});

console.log('\n' + passed + ' tests passed');
