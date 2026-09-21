/**
 * Ticket booking backend for a Google Sheet (Google Apps Script).
 * Bookings arrive from booking.html, get a unique bank-transfer reference,
 * and the treasurer matches the bank statement to them from the sheet menu.
 * Everything an organiser changes lives in the "Settings" sheet, not in this code.
 * Setup steps are in README.md.
 */

// Example values used to fill the Settings sheet the first time. Not used once the sheet exists.
const DEFAULTS = {
  organiser: 'AORTAN',
  eventName: 'Thamizhar Thirunal – Pongal 2027',
  dateText: 'Saturday, date to be confirmed, 2027 from 4 PM',
  venue: 'Walsall Football Club, Jimmy Walker Suite, Bescot Crescent, Walsall, WS1 4SA',
  contactEmail: 'aortanbirmingham@gmail.com',
  bank: { accountName: 'AORTAN', sortCode: '00-00-00', accountNumber: '00000000' },
  payWithinDays: 3,
  capacity: 0,
  bookingsOpen: true,
  askFood: true,
  tagline: 'Association of Overseas Residents of Tamil Nadu',
  tagline2: 'அயல்நாடு வாழ் தமிழ் நாட்டினர் சங்கம்',
  logoUrl: 'https://aortan.org.uk/images/logo-cutout.png',
  websiteUrl: 'https://aortan.org.uk',
  headerColour: '',
  buttonColour: '',
  closedMessage: 'Bookings are not open yet. Please check back soon.',
  spreadsheetId: '',
  problems: [],
  tickets: [
    { key: 'adult', label: 'Adult (25 and over)', price: 40, max: 10 },
    { key: 'youth', label: 'Ages 16 to 24', price: 30, max: 10 },
    { key: 'child', label: 'Ages 6 to 15', price: 20, max: 10 },
    { key: 'infant', label: 'Children under 5', price: 0, max: 10 },
  ],
};

// The live settings, loaded from the Settings sheet at the start of every request (see useSettings_).
let CONFIG = DEFAULTS;

const SETTING_DEFS = [
  { key: 'organiser', label: 'Organisation name', help: 'Shown in emails, e.g. AORTAN', required: true },
  { key: 'eventName', label: 'Event name', help: 'e.g. Thamizhar Thirunal - Pongal 2027', required: true },
  { key: 'dateText', label: 'Date and time', help: 'Free text, e.g. Saturday 30 January 2027, 4 PM', required: true },
  { key: 'venue', label: 'Venue', help: 'Name and address', required: true },
  { key: 'contactEmail', label: 'Contact email', help: 'Replies to booking emails go here', required: true, type: 'email' },
  { key: 'bankAccountName', label: 'Bank account name', help: 'Exactly as the bank shows it', required: true },
  { key: 'bankSortCode', label: 'Bank sort code', help: '6 digits, e.g. 12-34-56', required: true, type: 'sortcode' },
  { key: 'bankAccountNumber', label: 'Bank account number', help: '8 digits', required: true, type: 'account' },
  { key: 'payWithinDays', label: 'Days to pay', help: 'Used in the reminder emails', type: 'int', min: 1, max: 60 },
  { key: 'capacity', label: 'Maximum people', help: '0 means no limit; otherwise bookings stop when full', type: 'int', min: 0, max: 100000 },
  { key: 'bookingsOpen', label: 'Bookings open?', help: 'Yes or No. Set to No to close bookings', type: 'yesno' },
  { key: 'askFood', label: 'Ask about vegetarian food?', help: 'Yes or No. Choose No if food choice does not matter for your event', type: 'yesno' },
  { key: 'closedMessage', label: 'Message when closed', help: 'Shown on the page when bookings are closed', required: false },
  { key: 'tagline', label: 'PAGE LOOK (optional): line under the name', help: 'e.g. Association of Overseas Residents of Tamil Nadu. Leave empty for none', required: false },
  { key: 'tagline2', label: 'PAGE LOOK (optional): second line', help: 'Another short line, for example in another language', required: false },
  { key: 'logoUrl', label: 'PAGE LOOK (optional): logo web address', help: 'A link starting https:// to your logo image (PNG or JPG). Leave empty for no logo', required: false, type: 'url' },
  { key: 'websiteUrl', label: 'PAGE LOOK (optional): your website', help: 'A link starting https://. Adds a "Back to website" link on the page', required: false, type: 'url' },
  { key: 'headerColour', label: 'PAGE LOOK (optional): header colour', help: 'Hex colour like #0d5c68. Leave empty for the default teal', required: false, type: 'colour' },
  { key: 'buttonColour', label: 'PAGE LOOK (optional): button colour', help: 'Hex colour like #8e1b1b. Leave empty for the default maroon', required: false, type: 'colour' },
];
const TICKET_ROWS = 8;

// References are 5 letters shaped like a name (consonant-vowel-consonant-vowel-consonant), e.g. RAKIM,
// easy to say, read and type. Words that could be rude, or that appear in bank statements, are never issued.
const REF_CONSONANTS = 'BDGKLMNPRSTV';
const REF_VOWELS = 'AEIOU';
const REF_BLOCKED = ['PENIS', 'BONER', 'SEMEN', 'NIGER', 'PAKIS', 'KIKES', 'DAGOS', 'PUTAS', 'GONAD', 'TITUS',
  'DEBIT', 'TOTAL', 'LEGAL', 'LEVEL', 'MODEL', 'METAL', 'TIMES', 'RATES', 'SALES', 'DATES', 'TAXES', 'BASIS',
  'SAVER', 'BONUS', 'SUPER', 'MOTOR', 'LOGIN', 'TAMIL', 'KUMAR'];

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

  const askFood = cfg.askFood !== false;
  const veg = askFood ? Number(input.veg || 0) : 0;
  if (askFood && (!Number.isInteger(veg) || veg < 0 || veg > people)) errors.push('The vegetarian number cannot be more than the number of people.');
  if (input.consent !== true) errors.push('Please tick the box to confirm you agree to us using your details for this booking.');

  return {
    errors: errors,
    value: { name: name, email: email, mobile: mobile, counts: counts, people: people, veg: veg, nonVeg: askFood ? people - veg : 0, total: round2_(total) },
  };
}

function generateReference_(existing, rnd) {
  rnd = rnd || Math.random;
  const pick = function (chars) { return chars.charAt(Math.floor(rnd() * chars.length)); };
  for (let attempt = 0; attempt < 200; attempt++) {
    const ref = pick(REF_CONSONANTS) + pick(REF_VOWELS) + pick(REF_CONSONANTS) + pick(REF_VOWELS) + pick(REF_CONSONANTS);
    if (!existing[ref] && REF_BLOCKED.indexOf(ref) === -1) return ref;
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

function parseAmount_(v) {
  if (typeof v === 'number') return v;
  const n = parseFloat(String(v || '').replace(/[£,\s]/g, ''));
  return isNaN(n) ? 0 : n;
}

function matchPayments_(bookings, rows) {
  const live = bookings.filter(function (b) { return b.ref; });
  const byRef = {};
  live.forEach(function (b) { byRef[b.ref] = b; });
  const byMobile = {};
  live.forEach(function (b) {
    const k = last10_(b.mobile);
    if (k) (byMobile[k] = byMobile[k] || []).push(b);
  });
  const results = [];
  const paid = {};

  // References look like names, so a payer's own name in the bank text could equal someone's reference.
  // A match is therefore only accepted when the amount is what that booking owes (its total, or what is left).
  const fits = function (b, amount) {
    const left = round2_(b.total - (paid[b.ref] || 0) - (b.paidManual || 0));
    return Math.abs(amount - b.total) < 0.005 || (left > 0 && Math.abs(amount - left) < 0.005);
  };

  rows.forEach(function (r) {
    if (!(r.amount > 0)) { results.push({ status: 'skip', text: '', ref: '' }); return; }
    let ref = null, how = '', loose = null;
    const tokens = String(r.desc || '').toUpperCase().split(/[^A-Z0-9]+/);
    for (let i = 0; i < tokens.length && !ref; i++) {
      const b = tokens[i] ? byRef[tokens[i]] : null;
      if (!b) continue;
      if (fits(b, r.amount)) { ref = b.ref; how = 'reference'; } else if (!loose) loose = b;
    }
    if (!ref) {
      const digits = String(r.desc || '').replace(/\D/g, '');
      const cands = [];
      Object.keys(byMobile).forEach(function (k) {
        if (digits.indexOf(k) !== -1) byMobile[k].forEach(function (b) { cands.push(b); });
      });
      if (cands.length === 1) {
        if (fits(cands[0], r.amount)) { ref = cands[0].ref; how = 'mobile number (check)'; } else if (!loose) loose = cands[0];
      }
    }
    if (ref) {
      paid[ref] = round2_((paid[ref] || 0) + r.amount);
      results.push({ status: 'matched', ref: ref, text: 'Matched by ' + how });
    } else if (loose) {
      results.push({ status: 'unmatched', ref: '', text: 'NOT MATCHED. ' + loose.ref + ' (' + loose.name + ') is mentioned but ' + money_(r.amount) +
        ' is not the ' + money_(loose.total) + ' they owe. If it is their payment, enter ' + r.amount + ' in Paid manually for ' + loose.ref + '.' });
    } else {
      results.push({ status: 'unmatched', ref: '', text: '' });
    }
  });

  results.forEach(function (res, i) {
    if (res.status !== 'unmatched' || res.text) return;
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
  if (cfg.askFood !== false) {
    rows.push(['Vegetarian', sum(active, function (b) { return b.veg; }), sum(settled, function (b) { return b.veg; })]);
    rows.push(['Non-vegetarian', sum(active, function (b) { return b.nonVeg; }), sum(settled, function (b) { return b.nonVeg; })]);
  }
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
    ...(cfg.askFood !== false ? ['  Vegetarian: ' + b.veg + '   Non-vegetarian: ' + b.nonVeg] : []),
    '',
    'TO CONFIRM YOUR PLACES, PLEASE PAY BY BANK TRANSFER WITHIN ' + cfg.payWithinDays + ' DAYS',
    '  Amount:         ' + money_(b.total),
    '  Account name:   ' + cfg.bank.accountName,
    '  Sort code:      ' + cfg.bank.sortCode,
    '  Account number: ' + cfg.bank.accountNumber,
    '  PAYMENT REFERENCE: ' + b.ref,
    '',
    'Please use exactly this reference (not your mobile number) and pay the exact amount.',
    'Keep this email: your reference is always here if you need it again.',
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

// ---------- settings sheet ----------

function parseSettings_(vals, ticketRows) {
  const problems = [];
  const cfg = {};
  const blank = function (v) { return v === undefined || v === null || String(v).trim() === ''; };

  SETTING_DEFS.forEach(function (d) {
    const raw = vals[d.key];
    let v;
    if (d.type === 'int') {
      v = Number(String(raw).trim());
      if (blank(raw) || !Number.isInteger(v) || v < d.min || v > d.max) {
        problems.push('"' + d.label + '" must be a whole number from ' + d.min + ' to ' + d.max + '.');
        v = d.min;
      }
    } else if (d.type === 'yesno') {
      const t = blank(raw) ? '' : String(raw).trim().toLowerCase();
      if (t !== 'yes' && t !== 'no') problems.push('"' + d.label + '" must be Yes or No.');
      v = t === 'yes';
    } else {
      v = blank(raw) ? '' : String(raw).trim();
      if (d.required && !v) problems.push('"' + d.label + '" is empty.');
      if (v && d.type === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) problems.push('"' + d.label + '" is not a valid email address.');
      if (v && d.type === 'url' && !/^https:\/\/[^\s"'<>]+$/i.test(v)) problems.push('"' + d.label + '" must be a link starting with https://');
      if (v && d.type === 'colour' && !/^#[0-9a-fA-F]{6}$/.test(v)) problems.push('"' + d.label + '" must look like #0d5c68 (a # then 6 letters or digits).');
      if (v && d.type === 'sortcode') {
        const digits = v.replace(/\D/g, '');
        if (digits.length !== 6) problems.push('"' + d.label + '" must have 6 digits.');
        else v = digits.slice(0, 2) + '-' + digits.slice(2, 4) + '-' + digits.slice(4);
      }
      if (v && d.type === 'account') {
        const digits = v.replace(/\D/g, '');
        if (digits.length !== 8) problems.push('"' + d.label + '" must have 8 digits.');
        else v = digits;
      }
    }
    cfg[d.key] = v;
  });

  cfg.bank = { accountName: cfg.bankAccountName, sortCode: cfg.bankSortCode, accountNumber: cfg.bankAccountNumber };
  if (/^0+(-0+)*$/.test(cfg.bankSortCode) || /^0+$/.test(cfg.bankAccountNumber)) {
    problems.push('The bank details are still the example ones. Enter your real sort code and account number.');
  }

  const tickets = [];
  const seen = {};
  (ticketRows || []).forEach(function (r, i) {
    const label = blank(r[0]) ? '' : String(r[0]).trim();
    if (!label && blank(r[1]) && blank(r[2])) return;
    if (!label) { problems.push('Ticket row ' + (i + 1) + ' has a price but no name.'); return; }
    const priceText = String(r[1] === undefined || r[1] === null ? '' : r[1]).replace(/[£,\s]/g, '');
    const price = Number(priceText);
    if (priceText === '' || isNaN(price) || price < 0 || price > 1000) {
      problems.push('Ticket "' + label + '" needs a price from 0 to 1000 (use 0 for free).');
      return;
    }
    const max = blank(r[2]) ? 10 : Number(r[2]);
    if (!Number.isInteger(max) || max < 1 || max > 50) { problems.push('Ticket "' + label + '": max per booking must be a whole number from 1 to 50.'); return; }
    if (seen[label.toLowerCase()]) { problems.push('Ticket name "' + label + '" is used twice.'); return; }
    seen[label.toLowerCase()] = true;
    tickets.push({ key: 't' + (tickets.length + 1), label: label, price: round2_(price), max: max });
  });
  if (!tickets.length) problems.push('Add at least one ticket type in the Ticket table.');
  else if (!tickets.some(function (t) { return t.price > 0; })) problems.push('At least one ticket type must have a price above 0.');
  cfg.tickets = tickets;
  cfg.problems = problems;
  return cfg;
}

function seedSettings_(sheet) {
  const bank = DEFAULTS.bank;
  const seed = {
    organiser: DEFAULTS.organiser, eventName: DEFAULTS.eventName, dateText: DEFAULTS.dateText, venue: DEFAULTS.venue,
    contactEmail: DEFAULTS.contactEmail, bankAccountName: bank.accountName, bankSortCode: bank.sortCode,
    bankAccountNumber: bank.accountNumber, payWithinDays: DEFAULTS.payWithinDays, capacity: DEFAULTS.capacity,
    bookingsOpen: DEFAULTS.bookingsOpen ? 'Yes' : 'No', askFood: DEFAULTS.askFood ? 'Yes' : 'No', closedMessage: DEFAULTS.closedMessage,
    tagline: DEFAULTS.tagline, tagline2: DEFAULTS.tagline2, logoUrl: DEFAULTS.logoUrl, websiteUrl: DEFAULTS.websiteUrl,
    headerColour: DEFAULTS.headerColour, buttonColour: DEFAULTS.buttonColour,
  };
  sheet.getRange(1, 1, 1, 3).setValues([['Setting', 'Value', 'What to enter']]);
  sheet.getRange(2, 2, SETTING_DEFS.length, 1).setNumberFormat('@');
  sheet.getRange(2, 1, SETTING_DEFS.length, 3).setValues(SETTING_DEFS.map(function (d) { return [d.label, seed[d.key], d.help]; }));
  sheet.getRange(1, 5, 1, 3).setValues([['Ticket type', 'Price (£)', 'Max per booking']]);
  const rows = [];
  for (let i = 0; i < TICKET_ROWS; i++) {
    const t = DEFAULTS.tickets[i];
    rows.push(t ? [t.label, t.price, t.max] : ['', '', '']);
  }
  sheet.getRange(2, 5, TICKET_ROWS, 3).setValues(rows);
  sheet.getRange(1, 1, 1, 3).setFontWeight('bold').setBackground('#0d5c68').setFontColor('#ffffff');
  sheet.getRange(1, 5, 1, 3).setFontWeight('bold').setBackground('#8e1b1b').setFontColor('#ffffff');
  sheet.setColumnWidth(1, 220); sheet.setColumnWidth(2, 300); sheet.setColumnWidth(3, 340);
  sheet.setColumnWidth(4, 30); sheet.setColumnWidth(5, 220); sheet.setColumnWidth(6, 90); sheet.setColumnWidth(7, 130);
  ['bookingsOpen', 'askFood'].forEach(function (key) {
    const row = SETTING_DEFS.findIndex(function (d) { return d.key === key; }) + 2;
    sheet.getRange(row, 2).setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(['Yes', 'No'], true).build());
  });
  const help = SETTING_DEFS.length + 4;
  sheet.getRange(help, 1, 5, 1).setValues([
    ['HOW TO USE THIS SHEET'],
    ['To change a ticket price or add a ticket type: edit the Ticket table on the right. It applies straight away, no redeploy.'],
    ['To close bookings: set "Bookings open?" to No. To stop selling when full: set "Maximum people".'],
    ['Click the menu at the top, then "Check settings", to see anything that needs fixing.'],
    ['Do not change ticket names after people have booked (the Bookings sheet columns follow them).'],
  ]);
  sheet.getRange(help, 1).setFontWeight('bold');
  sheet.setFrozenRows(1);
}

function readSettings_() {
  const sheet = ss_().getSheetByName('Settings');
  if (!sheet) {
    const c = JSON.parse(JSON.stringify(DEFAULTS));
    c.problems = ['The Settings sheet has not been created yet. Run First-time setup.'];
    return c;
  }
  const rows = sheet.getRange(2, 1, SETTING_DEFS.length, 2).getValues();
  const vals = {};
  SETTING_DEFS.forEach(function (d, i) { vals[d.key] = rows[i][1]; });
  return parseSettings_(vals, sheet.getRange(2, 5, TICKET_ROWS, 3).getValues());
}

function useSettings_() { CONFIG = readSettings_(); return CONFIG; }

// ---------- web endpoints ----------

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function doGet(e) {
  useSettings_();
  const action = e && e.parameter && e.parameter.action;
  if (action === 'config') {
    try { return json_(publicConfig_()); } catch (err) {
      console.error(err);
      return json_({ ok: true, open: false, tickets: [], closedMessage: 'Booking is not available yet. Please check back soon.' });
    }
  }
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
    open: !CONFIG.problems.length && CONFIG.bookingsOpen && spacesLeft !== 0,
    closedMessage: CONFIG.problems.length ? 'Booking is not available yet. Please check back soon.' : (spacesLeft === 0 ? 'Sorry, this event is now fully booked.' : CONFIG.closedMessage),
    payWithinDays: CONFIG.payWithinDays, tickets: CONFIG.tickets, spacesLeft: spacesLeft,
    askFood: CONFIG.askFood !== false, contactEmail: CONFIG.contactEmail, tagline: CONFIG.tagline || '', tagline2: CONFIG.tagline2 || '',
    logoUrl: CONFIG.logoUrl || '', websiteUrl: CONFIG.websiteUrl || '', headerColour: CONFIG.headerColour || '', buttonColour: CONFIG.buttonColour || '',
  };
}

function doPost(e) {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(20000);
    useSettings_();
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
  if (CONFIG.problems.length) { console.error(CONFIG.problems.join(' ')); return { ok: false, error: 'Booking is not available yet. Please check back soon.' }; }
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
  b.ref = generateReference_(existing);

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
  return DEFAULTS.spreadsheetId ? SpreadsheetApp.openById(DEFAULTS.spreadsheetId) : SpreadsheetApp.getActiveSpreadsheet();
}

function getBookingsSheet_() {
  const ss = ss_();
  let sheet = ss.getSheetByName('Bookings');
  if (!sheet) { sheet = ss.insertSheet('Bookings'); formatBookingsSheet_(sheet); return sheet; }
  const S = schema_();
  const have = sheet.getRange(1, 1, 1, S.headers.length).getValues()[0].map(String);
  if (have.join('|') !== S.headers.join('|')) {
    if (sheet.getLastRow() < 2) formatBookingsSheet_(sheet);
    else throw new Error('The ticket types in Settings no longer match the Bookings sheet, which already has bookings. Put the ticket names back, or start a new copy of the sheet for the new event.');
  }
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
  sheet.getRange(1, 1, 1, sheet.getMaxColumns()).clearContent();
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
  try { useSettings_(); } catch (err) { /* menu still appears */ }
  SpreadsheetApp.getUi().createMenu(CONFIG.organiser + ' tickets')
    .addItem('1. Match bank payments', 'matchBankPayments')
    .addItem('2. Email "payment received" to newly paid', 'sendReceipts')
    .addItem('3. Email reminders to unpaid', 'sendReminders')
    .addItem('Refresh summary', 'refreshSummary')
    .addSeparator()
    .addItem('Check settings', 'checkSettings')
    .addItem('First-time setup', 'setup')
    .addToUi();
}

function requireGoodSettings_() {
  const ui = SpreadsheetApp.getUi();
  useSettings_();
  if (CONFIG.problems.length) {
    ui.alert('Please fix these in the Settings tab first', '- ' + CONFIG.problems.join('\n- '), ui.ButtonSet.OK);
    return false;
  }
  return true;
}

function guard_(fn) {
  try {
    if (requireGoodSettings_()) fn();
  } catch (err) {
    const ui = SpreadsheetApp.getUi();
    ui.alert('Problem', String(err && err.message ? err.message : err), ui.ButtonSet.OK);
  }
}

function checkSettings() {
  const ui = SpreadsheetApp.getUi();
  useSettings_();
  if (CONFIG.problems.length) ui.alert('Please fix these in the Settings tab', '- ' + CONFIG.problems.join('\n- '), ui.ButtonSet.OK);
  else ui.alert('Settings look good', CONFIG.eventName + '\n' + CONFIG.tickets.length + ' ticket types. Bookings are ' + (CONFIG.bookingsOpen ? 'OPEN' : 'CLOSED') + '.', ui.ButtonSet.OK);
}

function setup() {
  const ui = SpreadsheetApp.getUi();
  const ss = ss_();
  if (!ss.getSheetByName('Settings')) {
    seedSettings_(ss.insertSheet('Settings', 0));
    ui.alert('Settings sheet created', 'Fill in the Settings tab (your event, bank details and ticket types), then choose First-time setup again.', ui.ButtonSet.OK);
    return;
  }
  guard_(function () {
    getBookingsSheet_();
    getBankSheet_();
    refreshSummary_();
    ui.alert('Setup done', 'Sheets ready: Bookings, Bank and Summary. Next, deploy the web app (see README).', ui.ButtonSet.OK);
  });
}

function matchBankPayments() { guard_(matchBankPayments_); }

function matchBankPayments_() {
  const ui = SpreadsheetApp.getUi();
  const S = schema_();
  const sheet = getBookingsSheet_();
  const bank = getBankSheet_();
  const bookings = readBookings_(sheet);
  const last = bank.getLastRow();
  const rows = last >= 2 ? bank.getRange(2, 1, last - 1, 3).getValues().map(function (r) {
    return { desc: String(r[1] || ''), amount: parseAmount_(r[2]) };
  }) : [];

  const m = matchPayments_(bookings, rows);

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
  refreshSummary_();

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
  guard_(function () { sendReceipts_(); });
}

function sendReceipts_() {
  sendMailBatch_('Payment received emails', function (b) { return b.status === 'Paid' || b.status === 'Overpaid'; }, buildReceiptEmail_, 'receiptSent');
}

function sendReminders() {
  guard_(function () { sendReminders_(); });
}

function sendReminders_() {
  const cutoff = Date.now() - CONFIG.payWithinDays * 24 * 60 * 60 * 1000;
  sendMailBatch_('Payment reminders', function (b) {
    return (b.status === 'Pending' || b.status === 'Part paid') && new Date(b.bookedAt).getTime() < cutoff;
  }, buildReminderEmail_, 'reminderSent');
}

function refreshSummary() { guard_(refreshSummary_); }

function refreshSummary_() {
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
