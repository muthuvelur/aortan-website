/**
 * Ticket booking backend for a Google Sheet (Google Apps Script).
 * Bookings arrive from booking.html, get a unique bank-transfer reference,
 * and the treasurer matches the bank statement to them from the sheet menu.
 * Setup steps are in README.md. Edit CONFIG each year.
 */

const CONFIG = {
  organiser: 'AORTAN',
  eventName: 'Thamizhar Thirunal – Pongal 2027',
  dateText: 'Saturday, date to be confirmed, 2027 from 4 PM',
  venue: 'Walsall Football Club, Jimmy Walker Suite, Bescot Crescent, Walsall, WS1 4SA',
  contactEmail: 'aortanbirmingham@gmail.com',
  bank: { accountName: 'AORTAN', sortCode: '00-00-00', accountNumber: '00000000' },
  refPrefix: 'AOR',
  payWithinDays: 3,
  capacity: 0,
  bookingsOpen: true,
  closedMessage: 'Bookings are not open yet. Please check back soon.',
  spreadsheetId: '',
  tickets: [
    { key: 'adult', label: 'Adult (25 and over)', price: 40, max: 10 },
    { key: 'youth', label: 'Ages 16 to 24', price: 30, max: 10 },
    { key: 'child', label: 'Ages 6 to 15', price: 20, max: 10 },
    { key: 'infant', label: 'Children under 5', price: 0, max: 10 },
  ],
};

const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

// ---------- pure helpers (unit tested in test.js) ----------

function round2_(n) { return Math.round(n * 100) / 100; }

function schema_() {
  const cols = [
    ['ref', 'Reference'], ['bookedAt', 'Booked at'], ['name', 'Name'], ['email', 'Email'], ['mobile', 'Mobile'],
  ].concat(CONFIG.tickets.map(function (t) { return ['t_' + t.key, t.label]; }), [
    ['people', 'People'], ['veg', 'Vegetarian'], ['nonVeg', 'Non-vegetarian'], ['total', 'Total (£)'],
    ['paidBank', 'Paid by bank (£)'], ['paidManual', 'Paid manually (£)'], ['balance', 'Balance (£)'],
    ['status', 'Status'], ['notes', 'Notes'], ['reminderSent', 'Reminder sent'], ['receiptSent', 'Receipt sent'],
  ]);
  const idx = {};
  cols.forEach(function (c, i) { idx[c[0]] = i + 1; });
  return { keys: cols.map(function (c) { return c[0]; }), headers: cols.map(function (c) { return c[1]; }), idx: idx };
}

function colLetter_(n) {
  let s = '';
  while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); }
  return s;
}

function safeCell_(s) {
  s = String(s);
  return /^[=+\-@]/.test(s) ? "'" + s : s;
}

function normaliseMobile_(raw) {
  let d = String(raw || '').replace(/\D/g, '');
  if (d.indexOf('44') === 0 && d.length === 12) d = '0' + d.slice(2);
  return d;
}

function last10_(mobile) {
  const d = String(mobile || '').replace(/\D/g, '');
  return d.length >= 10 ? d.slice(-10) : '';
}

function validateBooking_(input, cfg) {
  const errors = [];
  input = input || {};
  const name = String(input.name || '').trim().replace(/\s+/g, ' ');
  const email = String(input.email || '').trim().toLowerCase();
  const mobile = normaliseMobile_(input.mobile);
  if (name.length < 2 || name.length > 80) errors.push('Please enter your full name.');
  if (email.length > 120 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errors.push('Please enter a valid email address.');
  if (mobile.length < 10 || mobile.length > 15) errors.push('Please enter a valid mobile number.');

  const counts = {};
  let people = 0, paying = 0, total = 0;
  cfg.tickets.forEach(function (t) {
    const raw = input.counts ? input.counts[t.key] : 0;
    const n = Number(raw || 0);
    if (!Number.isInteger(n) || n < 0 || n > t.max) { errors.push('Invalid number of tickets for ' + t.label + '.'); return; }
    counts[t.key] = n;
    people += n;
    total += n * t.price;
    if (t.price > 0) paying += n;
  });
  if (paying < 1) errors.push('Please choose at least one paid ticket.');

  const veg = Number(input.veg || 0);
  if (!Number.isInteger(veg) || veg < 0 || veg > people) errors.push('The vegetarian number cannot be more than the number of people.');
  if (input.consent !== true) errors.push('Please tick the box to confirm you agree to us using your details for this booking.');

  return {
    errors: errors,
    value: { name: name, email: email, mobile: mobile, counts: counts, people: people, veg: veg, nonVeg: people - veg, total: round2_(total) },
  };
}

function generateReference_(prefix, existing, rnd) {
  rnd = rnd || Math.random;
  for (let attempt = 0; attempt < 100; attempt++) {
    let s = '';
    for (let i = 0; i < 5; i++) s += ALPHABET.charAt(Math.floor(rnd() * ALPHABET.length));
    const ref = prefix + s;
    if (!existing[ref]) return ref;
  }
  throw new Error('Could not generate a unique reference');
}

function sameCounts_(a, b) {
  const keys = Object.keys(a).concat(Object.keys(b));
  return keys.every(function (k) { return (a[k] || 0) === (b[k] || 0); });
}

function findDuplicate_(bookings, b, nowMs) {
  const dayMs = 24 * 60 * 60 * 1000;
  for (let i = 0; i < bookings.length; i++) {
    const x = bookings[i];
    if (!x.ref || x.status === 'Cancelled') continue;
    const at = x.bookedAt instanceof Date ? x.bookedAt.getTime() : new Date(x.bookedAt).getTime();
    if (nowMs - at > dayMs) continue;
    if (String(x.email).toLowerCase() === b.email && last10_(x.mobile) === last10_(b.mobile) && sameCounts_(x.counts, b.counts)) return x;
  }
  return null;
}

function norm_(s) { return String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, ''); }

function parseAmount_(v) {
  if (typeof v === 'number') return v;
  const n = parseFloat(String(v || '').replace(/[£,\s]/g, ''));
  return isNaN(n) ? 0 : n;
}

function matchPayments_(bookings, rows, prefix) {
  const live = bookings.filter(function (b) { return b.ref; });
  const byRef = {};
  live.forEach(function (b) { byRef[b.ref] = b; });
  const byMobile = {};
  live.forEach(function (b) {
    const k = last10_(b.mobile);
    if (k) (byMobile[k] = byMobile[k] || []).push(b);
  });
  const re = new RegExp(prefix + '[' + ALPHABET + ']{5}', 'g');
  const results = [];
  const paid = {};

  rows.forEach(function (r) {
    if (!(r.amount > 0)) { results.push({ status: 'skip', text: '', ref: '' }); return; }
    let ref = null, how = '';
    const found = norm_(r.desc).match(re) || [];
    for (let i = 0; i < found.length; i++) { if (byRef[found[i]]) { ref = found[i]; how = 'reference'; break; } }
    if (!ref) {
      const digits = String(r.desc || '').replace(/\D/g, '');
      const cands = [];
      Object.keys(byMobile).forEach(function (k) {
        if (digits.indexOf(k) !== -1) byMobile[k].forEach(function (b) { cands.push(b); });
      });
      if (cands.length === 1) { ref = cands[0].ref; how = 'mobile number in reference (check)'; }
    }
    if (ref) {
      paid[ref] = round2_((paid[ref] || 0) + r.amount);
      results.push({ status: 'matched', ref: ref, text: 'Matched by ' + how });
    } else {
      results.push({ status: 'unmatched', ref: '', text: '' });
    }
  });

  results.forEach(function (res, i) {
    if (res.status !== 'unmatched') return;
    const amount = rows[i].amount;
    const cands = live.filter(function (b) { return b.status !== 'Cancelled' && !paid[b.ref] && round2_(b.total) === round2_(amount); });
    if (cands.length === 1) res.text = 'NOT MATCHED. Possible: ' + cands[0].ref + ' (' + cands[0].name + ', same amount). Check before accepting.';
    else if (cands.length > 1) res.text = 'NOT MATCHED. Amount fits ' + cands.length + ' unpaid bookings; ask the payer for their reference.';
    else res.text = 'NOT MATCHED. No booking with this reference or amount.';
  });

  return { results: results, paid: paid };
}

function deriveStatus_(total, paidTotal, current) {
  if (current === 'Cancelled') return 'Cancelled';
  if (!(paidTotal > 0)) return 'Pending';
  const bal = round2_(total - paidTotal);
  if (bal > 0) return 'Part paid';
  if (bal < 0) return 'Overpaid';
  return 'Paid';
}

function computeSummary_(bookings, cfg) {
  const active = bookings.filter(function (b) { return b.ref && b.status !== 'Cancelled'; });
  const settled = active.filter(function (b) { return b.status === 'Paid' || b.status === 'Overpaid'; });
  const sum = function (list, f) { return round2_(list.reduce(function (a, b) { return a + f(b); }, 0)); };
  const rows = [['', 'All bookings (not cancelled)', 'Fully paid only']];
  cfg.tickets.forEach(function (t) {
    rows.push([t.label, sum(active, function (b) { return b.counts[t.key] || 0; }), sum(settled, function (b) { return b.counts[t.key] || 0; })]);
  });
  rows.push(['Total people', sum(active, function (b) { return b.people; }), sum(settled, function (b) { return b.people; })]);
  rows.push(['Vegetarian', sum(active, function (b) { return b.veg; }), sum(settled, function (b) { return b.veg; })]);
  rows.push(['Non-vegetarian', sum(active, function (b) { return b.nonVeg; }), sum(settled, function (b) { return b.nonVeg; })]);
  rows.push(['Bookings', active.length, settled.length]);
  rows.push(['Money expected (£)', sum(active, function (b) { return b.total; }), sum(settled, function (b) { return b.total; })]);
  rows.push(['Money received (£)', sum(active, function (b) { return b.paidBank + b.paidManual; }), sum(settled, function (b) { return b.paidBank + b.paidManual; })]);
  rows.push(['Still to collect (£)', sum(active, function (b) { return Math.max(0, b.total - b.paidBank - b.paidManual); }), '']);
  return rows;
}

function money_(n) { return '£' + (Number.isInteger(n) ? n : n.toFixed(2)); }

function ticketLines_(b, cfg) {
  const lines = [];
  cfg.tickets.forEach(function (t) {
    const n = b.counts[t.key] || 0;
    if (n > 0) lines.push('  ' + t.label + ' x ' + n + (t.price > 0 ? ' = ' + money_(n * t.price) : ' (free)'));
  });
  return lines;
}

function buildConfirmationEmail_(b, cfg) {
  const body = [
    'Dear ' + b.name + ',',
    '',
    'Thank you for booking for ' + cfg.eventName + '.',
    cfg.dateText + ' - ' + cfg.venue,
    '',
    'YOUR BOOKING (' + b.people + ' people)',
  ].concat(ticketLines_(b, cfg), [
    '  Vegetarian: ' + b.veg + '   Non-vegetarian: ' + b.nonVeg,
    '',
    'TO CONFIRM YOUR PLACES, PLEASE PAY BY BANK TRANSFER WITHIN ' + cfg.payWithinDays + ' DAYS',
    '  Amount:         ' + money_(b.total),
    '  Account name:   ' + cfg.bank.accountName,
    '  Sort code:      ' + cfg.bank.sortCode,
    '  Account number: ' + cfg.bank.accountNumber,
    '  PAYMENT REFERENCE: ' + b.ref,
    '',
    'Please use exactly this reference (not your mobile number) and pay the exact amount.',
    'Your booking is only confirmed once we receive payment. Unpaid bookings may be released.',
    'Please do not fill in the booking form a second time.',
    '',
    'Questions? Reply to this email or write to ' + cfg.contactEmail + '.',
    '',
    cfg.organiser,
  ]);
  return { subject: cfg.organiser + ' booking - payment reference ' + b.ref, body: body.join('\n') };
}

function buildReceiptEmail_(b, cfg) {
  const body = [
    'Dear ' + b.name + ',',
    '',
    'We have received your payment for ' + cfg.eventName + '. Thank you!',
    'Booking reference: ' + b.ref,
    '',
  ].concat(ticketLines_(b, cfg), [
    '',
    cfg.dateText + ' - ' + cfg.venue,
    'Please bring this email, or quote your reference, at registration.',
    '',
    cfg.organiser,
  ]);
  return { subject: cfg.organiser + ' - payment received (' + b.ref + ')', body: body.join('\n') };
}

function buildReminderEmail_(b, cfg) {
  const body = [
    'Dear ' + b.name + ',',
    '',
    'We have not yet received payment for your booking for ' + cfg.eventName + '.',
    'Amount due: ' + money_(round2_(b.total - b.paidBank - b.paidManual)),
    'Account name: ' + cfg.bank.accountName + '   Sort code: ' + cfg.bank.sortCode + '   Account number: ' + cfg.bank.accountNumber,
    'PAYMENT REFERENCE: ' + b.ref,
    '',
    'If you have already paid, please reply with the date and the reference you used, and we will sort it out.',
    'If you no longer need the tickets, please let us know so we can release them.',
    '',
    cfg.organiser,
  ];
  return { subject: cfg.organiser + ' - payment reminder (' + b.ref + ')', body: body.join('\n') };
}

// ---------- web endpoints ----------

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function doGet(e) {
  const action = e && e.parameter && e.parameter.action;
  if (action === 'config') return json_(publicConfig_());
  return json_({ ok: true, service: CONFIG.organiser + ' bookings' });
}

function publicConfig_() {
  let spacesLeft = null;
  if (CONFIG.capacity > 0) {
    const taken = readBookings_(getBookingsSheet_()).filter(function (b) { return b.ref && b.status !== 'Cancelled'; })
      .reduce(function (a, b) { return a + b.people; }, 0);
    spacesLeft = Math.max(0, CONFIG.capacity - taken);
  }
  return {
    ok: true, organiser: CONFIG.organiser, eventName: CONFIG.eventName, dateText: CONFIG.dateText, venue: CONFIG.venue,
    open: CONFIG.bookingsOpen && spacesLeft !== 0, closedMessage: spacesLeft === 0 ? 'Sorry, this event is now fully booked.' : CONFIG.closedMessage,
    payWithinDays: CONFIG.payWithinDays, tickets: CONFIG.tickets, spacesLeft: spacesLeft,
  };
}

function doPost(e) {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(20000);
    return json_(createBooking_(JSON.parse(e.postData.contents)));
  } catch (err) {
    console.error(err);
    return json_({ ok: false, error: 'Sorry, something went wrong. Please try again, or email ' + CONFIG.contactEmail + '.' });
  } finally {
    try { lock.releaseLock(); } catch (x) { /* not locked */ }
  }
}

function bookingResponse_(b, extra) {
  const r = {
    ok: true, reference: b.ref, total: b.total, name: b.name, email: b.email, people: b.people,
    payWithinDays: CONFIG.payWithinDays, bank: CONFIG.bank, eventName: CONFIG.eventName,
  };
  Object.keys(extra || {}).forEach(function (k) { r[k] = extra[k]; });
  return r;
}

function createBooking_(input) {
  if (input && input.website) return { ok: false, error: 'Rejected.' };
  if (!CONFIG.bookingsOpen) return { ok: false, error: CONFIG.closedMessage };

  const v = validateBooking_(input, CONFIG);
  if (v.errors.length) return { ok: false, error: v.errors.join(' ') };
  const b = v.value;

  const sheet = getBookingsSheet_();
  const bookings = readBookings_(sheet);

  const dup = findDuplicate_(bookings, b, Date.now());
  if (dup) return bookingResponse_(dup, { duplicate: true });

  const active = bookings.filter(function (x) { return x.ref && x.status !== 'Cancelled'; });
  if (CONFIG.capacity > 0) {
    const left = CONFIG.capacity - active.reduce(function (a, x) { return a + x.people; }, 0);
    if (b.people > left) return { ok: false, error: left > 0 ? 'Sorry, only ' + left + ' places are left.' : 'Sorry, this event is now fully booked.' };
  }

  const existing = {};
  bookings.forEach(function (x) { if (x.ref) existing[x.ref] = true; });
  b.ref = generateReference_(CONFIG.refPrefix, existing);

  const others = active.filter(function (x) {
    return String(x.email).toLowerCase() === b.email || (last10_(x.mobile) && last10_(x.mobile) === last10_(b.mobile));
  }).map(function (x) { return x.ref; });
  b.notes = others.length ? 'CHECK: same email or mobile as ' + others.join(', ') : '';

  appendBooking_(sheet, b);

  let emailSent = true;
  try {
    const mail = buildConfirmationEmail_(b, CONFIG);
    MailApp.sendEmail({ to: b.email, subject: mail.subject, body: mail.body, replyTo: CONFIG.contactEmail, name: CONFIG.organiser });
  } catch (err) {
    console.error(err);
    emailSent = false;
  }
  return bookingResponse_(b, { emailSent: emailSent });
}

// ---------- sheet access ----------

function ss_() {
  return CONFIG.spreadsheetId ? SpreadsheetApp.openById(CONFIG.spreadsheetId) : SpreadsheetApp.getActiveSpreadsheet();
}

function getBookingsSheet_() {
  const ss = ss_();
  let sheet = ss.getSheetByName('Bookings');
  if (!sheet) { sheet = ss.insertSheet('Bookings'); formatBookingsSheet_(sheet); }
  return sheet;
}

function getBankSheet_() {
  const ss = ss_();
  let sheet = ss.getSheetByName('Bank');
  if (!sheet) { sheet = ss.insertSheet('Bank'); formatBankSheet_(sheet); }
  return sheet;
}

function formatBookingsSheet_(sheet) {
  const S = schema_();
  sheet.getRange(1, 1, 1, S.headers.length).setValues([S.headers]).setFontWeight('bold').setBackground('#0d5c68').setFontColor('#ffffff');
  sheet.setFrozenRows(1);
  sheet.getRange(2, S.idx.mobile, sheet.getMaxRows() - 1, 1).setNumberFormat('@');
  sheet.getRange(2, S.idx.status, sheet.getMaxRows() - 1, 1).setDataValidation(
    SpreadsheetApp.newDataValidation().requireValueInList(['Pending', 'Part paid', 'Paid', 'Overpaid', 'Cancelled'], true).setAllowInvalid(false).build());
  sheet.setColumnWidth(S.idx.notes, 260);
}

function formatBankSheet_(sheet) {
  sheet.getRange(1, 1, 1, 5).setValues([['Date', 'Description', 'Paid in (£)', 'Result', 'Booking']]).setFontWeight('bold').setBackground('#8e1b1b').setFontColor('#ffffff');
  sheet.setFrozenRows(1);
  sheet.setColumnWidth(2, 320);
  sheet.setColumnWidth(4, 420);
}

function readBookings_(sheet) {
  const S = schema_();
  const last = sheet.getLastRow();
  if (last < 2) return [];
  const vals = sheet.getRange(2, 1, last - 1, S.keys.length).getValues();
  return vals.map(function (r, i) {
    const o = { row: i + 2 };
    S.keys.forEach(function (k, j) { o[k] = r[j]; });
    o.ref = String(o.ref || '');
    o.mobile = String(o.mobile || '');
    o.counts = {};
    CONFIG.tickets.forEach(function (t) { o.counts[t.key] = Number(o['t_' + t.key]) || 0; });
    ['people', 'veg', 'nonVeg', 'total', 'paidBank', 'paidManual'].forEach(function (k) { o[k] = Number(o[k]) || 0; });
    o.status = String(o.status || 'Pending');
    return o;
  });
}

function appendBooking_(sheet, b) {
  const S = schema_();
  const row = new Array(S.keys.length).fill('');
  row[S.idx.ref - 1] = b.ref;
  row[S.idx.bookedAt - 1] = new Date();
  row[S.idx.name - 1] = safeCell_(b.name);
  row[S.idx.email - 1] = safeCell_(b.email);
  row[S.idx.mobile - 1] = b.mobile;
  CONFIG.tickets.forEach(function (t) { row[S.idx['t_' + t.key] - 1] = b.counts[t.key] || 0; });
  row[S.idx.people - 1] = b.people;
  row[S.idx.veg - 1] = b.veg;
  row[S.idx.nonVeg - 1] = b.nonVeg;
  row[S.idx.total - 1] = b.total;
  row[S.idx.paidBank - 1] = 0;
  row[S.idx.paidManual - 1] = 0;
  row[S.idx.status - 1] = 'Pending';
  row[S.idx.notes - 1] = b.notes || '';
  sheet.appendRow(row);
  const r = sheet.getLastRow();
  sheet.getRange(r, S.idx.mobile).setNumberFormat('@').setValue(b.mobile);
  sheet.getRange(r, S.idx.balance).setFormula('=' + colLetter_(S.idx.total) + r + '-' + colLetter_(S.idx.paidBank) + r + '-' + colLetter_(S.idx.paidManual) + r);
}

// ---------- treasurer menu ----------

function onOpen() {
  SpreadsheetApp.getUi().createMenu(CONFIG.organiser + ' tickets')
    .addItem('1. Match bank payments', 'matchBankPayments')
    .addItem('2. Email "payment received" to newly paid', 'sendReceipts')
    .addItem('3. Email reminders to unpaid', 'sendReminders')
    .addItem('Refresh summary', 'refreshSummary')
    .addSeparator()
    .addItem('First-time setup', 'setup')
    .addToUi();
}

function setup() {
  getBookingsSheet_();
  getBankSheet_();
  refreshSummary();
  SpreadsheetApp.getUi().alert('Setup done. Sheets created: Bookings, Bank, Summary.');
}

function matchBankPayments() {
  const ui = SpreadsheetApp.getUi();
  const S = schema_();
  const sheet = getBookingsSheet_();
  const bank = getBankSheet_();
  const bookings = readBookings_(sheet);
  const last = bank.getLastRow();
  const rows = last >= 2 ? bank.getRange(2, 1, last - 1, 3).getValues().map(function (r) {
    return { desc: String(r[1] || ''), amount: parseAmount_(r[2]) };
  }) : [];

  const m = matchPayments_(bookings, rows, CONFIG.refPrefix);

  if (rows.length) {
    bank.getRange(2, 4, rows.length, 2).setValues(m.results.map(function (r) { return [r.text, r.ref]; }));
  }

  if (bookings.length) {
    const paidCol = [], statusCol = [], noteCol = [];
    bookings.forEach(function (b) {
      if (!b.ref) { paidCol.push(['']); statusCol.push(['']); noteCol.push([b.notes || '']); return; }
      const paidBank = m.paid[b.ref] || 0;
      const status = deriveStatus_(b.total, paidBank + b.paidManual, b.status);
      let note = String(b.notes || '');
      if (b.status === 'Cancelled' && paidBank > 0 && note.indexOf('PAID BUT CANCELLED') === -1) note = (note ? note + ' | ' : '') + 'PAID BUT CANCELLED - refund?';
      paidCol.push([paidBank]); statusCol.push([status]); noteCol.push([note]);
    });
    sheet.getRange(2, S.idx.paidBank, bookings.length, 1).setValues(paidCol);
    sheet.getRange(2, S.idx.status, bookings.length, 1).setValues(statusCol);
    sheet.getRange(2, S.idx.notes, bookings.length, 1).setValues(noteCol);
  }
  refreshSummary();

  const counts = { matched: 0, unmatched: 0 };
  m.results.forEach(function (r) { if (r.status === 'matched') counts.matched++; else if (r.status === 'unmatched') counts.unmatched++; });
  ui.alert('Matched ' + counts.matched + ' payments to bookings.\n' + counts.unmatched + ' payments could not be matched - see the Result column on the Bank sheet.');
}

function sendMailBatch_(label, filterFn, builderFn, stampKey) {
  const ui = SpreadsheetApp.getUi();
  const S = schema_();
  const sheet = getBookingsSheet_();
  const list = readBookings_(sheet).filter(function (b) { return b.ref && !b[stampKey] && filterFn(b); });
  if (!list.length) { ui.alert('Nobody to email.'); return; }
  const ok = ui.alert(label, 'This will send ' + list.length + ' email(s). Continue?', ui.ButtonSet.YES_NO);
  if (ok !== ui.Button.YES) return;
  let sent = 0;
  list.forEach(function (b) {
    try {
      const mail = builderFn(b, CONFIG);
      MailApp.sendEmail({ to: b.email, subject: mail.subject, body: mail.body, replyTo: CONFIG.contactEmail, name: CONFIG.organiser });
      sheet.getRange(b.row, S.idx[stampKey]).setValue(new Date());
      sent++;
    } catch (err) { console.error(err); }
  });
  ui.alert('Sent ' + sent + ' of ' + list.length + ' emails.');
}

function sendReceipts() {
  sendMailBatch_('Payment received emails', function (b) { return b.status === 'Paid' || b.status === 'Overpaid'; }, buildReceiptEmail_, 'receiptSent');
}

function sendReminders() {
  const cutoff = Date.now() - CONFIG.payWithinDays * 24 * 60 * 60 * 1000;
  sendMailBatch_('Payment reminders', function (b) {
    return (b.status === 'Pending' || b.status === 'Part paid') && new Date(b.bookedAt).getTime() < cutoff;
  }, buildReminderEmail_, 'reminderSent');
}

function refreshSummary() {
  const ss = ss_();
  let sheet = ss.getSheetByName('Summary');
  if (!sheet) sheet = ss.insertSheet('Summary');
  const rows = computeSummary_(readBookings_(getBookingsSheet_()), CONFIG);
  sheet.clear();
  sheet.getRange(1, 1, rows.length, 3).setValues(rows);
  sheet.getRange(1, 1, 1, 3).setFontWeight('bold').setBackground('#0d5c68').setFontColor('#ffffff');
  sheet.setColumnWidth(1, 240);
  sheet.setColumnWidth(2, 190);
  sheet.setColumnWidth(3, 150);
}
