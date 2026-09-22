(function () {
  'use strict';

  // ---- which organisation's booking is this? ----
  var params = new URLSearchParams(window.location.search);
  var orgKey = (params.get('org') || '').toLowerCase().replace(/[^a-z0-9_-]/g, '');
  var BACKENDS = window.BOOKING_BACKENDS || {};
  var BACKEND = orgKey
    ? (Object.prototype.hasOwnProperty.call(BACKENDS, orgKey) ? String(BACKENDS[orgKey]).trim() : '')
    : String(window.BOOKING_BACKEND_URL || '').trim();
  var UNKNOWN_ORG = !!orgKey && !BACKEND;
  var DEMO = !BACKEND && !UNKNOWN_ORG;

  var CONSONANTS = 'BDGKLMNPRSTV';
  var VOWELS = 'AEIOU';

  var DEMO_CONFIG = {
    ok: true,
    organiser: 'AORTAN',
    tagline: 'Association of Overseas Residents of Tamil Nadu',
    tagline2: 'அயல்நாடு வாழ் தமிழ் நாட்டினர் சங்கம்',
    logoUrl: 'images/logo-cutout.png',
    websiteUrl: 'https://aortan.org.uk',
    headerColour: '',
    buttonColour: '',
    contactEmail: 'aortanbirmingham@gmail.com',
    eventName: 'Thamizhar Thirunal – Pongal 2027',
    dateText: 'Saturday, date to be confirmed, 2027 from 4 PM',
    venue: 'Walsall Football Club, Jimmy Walker Suite, Bescot Crescent, Walsall, WS1 4SA',
    open: true,
    askFood: true,
    payWithinDays: 3,
    tickets: [
      { key: 'adult', label: 'Adult (25 and over)', price: 40, max: 10 },
      { key: 'youth', label: 'Ages 16 to 24', price: 30, max: 10 },
      { key: 'child', label: 'Ages 6 to 15', price: 20, max: 10 },
      { key: 'infant', label: 'Children under 5', price: 0, max: 10 }
    ]
  };

  var $ = function (id) { return document.getElementById(id); };
  var config = null;
  var busy = false;
  var copyValues = {};

  function money(n) { return '£' + (Number.isInteger(n) ? n : n.toFixed(2)); }
  function isHttps(u) { return typeof u === 'string' && /^https:\/\/[^\s"'<>]+$/i.test(u); }
  function isHex(c) { return typeof c === 'string' && /^#[0-9a-fA-F]{6}$/.test(c); }
  function darken(hex, amount) {
    var n = parseInt(hex.slice(1), 16), out = '#';
    [n >> 16, (n >> 8) & 255, n & 255].forEach(function (v) {
      var d = Math.round(v * (1 - amount)).toString(16);
      out += (d.length < 2 ? '0' : '') + d;
    });
    return out;
  }

  // ---- branding comes from the organiser's Settings sheet ----
  function applyBranding(cfg) {
    var org = cfg.organiser || 'Tickets';
    document.title = 'Book tickets | ' + org;
    $('brandName').textContent = org;
    $('brandTag').textContent = cfg.tagline || '';
    $('brandTag').hidden = !cfg.tagline;
    $('brandTag2').textContent = cfg.tagline2 || '';
    $('brandTag2').hidden = !cfg.tagline2;

    var logo = $('brandLogo');
    var logoOk = cfg.logoUrl && (isHttps(cfg.logoUrl) || (DEMO && /^images\//.test(cfg.logoUrl)));
    if (logoOk) {
      logo.alt = org + ' logo';
      logo.onerror = function () { logo.hidden = true; };
      logo.src = cfg.logoUrl;
      logo.hidden = false;
      var icon = document.querySelector('link[rel="icon"]') || document.head.appendChild(document.createElement('link'));
      icon.rel = 'icon';
      icon.href = cfg.logoUrl;
    } else {
      logo.hidden = true;
    }

    var root = document.documentElement.style;
    if (isHex(cfg.headerColour)) { root.setProperty('--teal', cfg.headerColour); root.setProperty('--teal-dark', darken(cfg.headerColour, 0.35)); }
    if (isHex(cfg.buttonColour)) root.setProperty('--maroon', cfg.buttonColour);

    var back = $('backLink');
    if (isHttps(cfg.websiteUrl)) {
      back.href = cfg.websiteUrl;
      back.textContent = '← Back to the ' + org + ' website';
      back.hidden = false;
    }

    $('consentText').textContent = 'I agree that ' + org + ' may use these details to manage my booking and contact me about it.';

    var foot = $('siteFooter');
    foot.textContent = '© ' + new Date().getFullYear() + ' ' + org;
    if (cfg.contactEmail && /^[^\s@"<>]+@[^\s@"<>]+\.[^\s@"<>]+$/.test(cfg.contactEmail)) {
      foot.appendChild(document.createTextNode(' | '));
      var a = document.createElement('a');
      a.href = 'mailto:' + cfg.contactEmail;
      a.textContent = cfg.contactEmail;
      foot.appendChild(a);
    }
  }

  function askFood() { return !config || config.askFood !== false; }

  function fillSelect(sel, max, keep) {
    var current = keep ? Number(sel.value) || 0 : 0;
    sel.innerHTML = '';
    for (var i = 0; i <= max; i++) {
      var o = document.createElement('option');
      o.value = String(i);
      o.textContent = String(i);
      sel.appendChild(o);
    }
    sel.value = String(Math.min(current, max));
  }

  function counts() {
    var c = {};
    config.tickets.forEach(function (t) { c[t.key] = Number($('t_' + t.key).value) || 0; });
    return c;
  }

  function totals() {
    var c = counts(), people = 0, total = 0, paying = 0;
    config.tickets.forEach(function (t) {
      people += c[t.key];
      total += c[t.key] * t.price;
      if (t.price > 0) paying += c[t.key];
    });
    return { counts: c, people: people, total: Math.round(total * 100) / 100, paying: paying };
  }

  function refresh() {
    var t = totals();
    if (askFood()) {
      fillSelect($('veg'), t.people, true);
      $('nonVeg').textContent = String(t.people - Number($('veg').value));
    }
    $('totalPeople').textContent = String(t.people);
    $('totalAmount').textContent = money(t.total);
  }

  function buildForm() {
    var box = $('ticketRows');
    box.innerHTML = '';
    config.tickets.forEach(function (t) {
      var row = document.createElement('div');
      row.className = 'ticket-row';
      var label = document.createElement('label');
      label.setAttribute('for', 't_' + t.key);
      label.textContent = t.label + ' - ' + (t.price > 0 ? money(t.price) + ' each' : 'Free');
      var sel = document.createElement('select');
      sel.id = 't_' + t.key;
      fillSelect(sel, t.max, false);
      sel.addEventListener('change', refresh);
      row.appendChild(label);
      row.appendChild(sel);
      box.appendChild(row);
    });
    $('foodSection').hidden = !askFood();
    refresh();
  }

  function showError(msg) {
    var el = $('formError');
    el.textContent = msg;
    el.hidden = !msg;
  }

  function collect() {
    var t = totals();
    return {
      name: $('name').value.trim(),
      email: $('email').value.trim(),
      mobile: $('mobile').value.trim(),
      counts: t.counts,
      veg: askFood() ? (Number($('veg').value) || 0) : 0,
      consent: $('consent').checked,
      website: $('website').value
    };
  }

  function validate(d) {
    var t = totals();
    if (d.name.length < 2) return 'Please enter your full name.';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(d.email)) return 'Please enter a valid email address.';
    if (d.mobile.replace(/\D/g, '').length < 10) return 'Please enter a valid mobile number.';
    if (t.paying < 1) return 'Please choose at least one paid ticket.';
    if (!d.consent) return 'Please tick the box to agree to us using your details for this booking.';
    return '';
  }

  function demoBook(d) {
    var pick = function (set) { return set.charAt(Math.floor(Math.random() * set.length)); };
    var ref = pick(CONSONANTS) + pick(VOWELS) + pick(CONSONANTS) + pick(VOWELS) + pick(CONSONANTS);
    var t = totals();
    return Promise.resolve({
      ok: true, reference: ref, total: t.total, email: d.email, people: t.people, payWithinDays: config.payWithinDays,
      bank: { accountName: 'AORTAN (demo)', sortCode: '00-00-00', accountNumber: '00000000' }, emailSent: false
    });
  }

  function post(d) {
    return fetch(BACKEND, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(d)
    }).then(function (r) { return r.json(); });
  }

  function showResult(r) {
    $('refValue').textContent = r.reference;
    $('refValue2').textContent = r.reference;
    $('resAmount').textContent = money(r.total);
    $('bankName').textContent = r.bank.accountName;
    $('bankSort').textContent = r.bank.sortCode;
    $('bankAcc').textContent = r.bank.accountNumber;
    $('payDays').textContent = String(r.payWithinDays);
    copyValues = {
      amount: Number(r.total).toFixed(2),
      name: r.bank.accountName,
      sort: String(r.bank.sortCode).replace(/\D/g, ''),
      account: String(r.bank.accountNumber).replace(/\D/g, ''),
      ref: r.reference
    };
    $('dupNote').hidden = !r.duplicate;
    $('emailNote').textContent = DEMO
      ? 'In a real booking, this reference and the payment details are also emailed to you, so you can find them in your inbox any time.'
      : (r.emailSent === false
        ? 'We could not send the confirmation email, so please keep a note of this reference (a screenshot is fine).'
        : 'We have also emailed this reference and the payment details to ' + r.email + '. You can find them in your email any time. Check your spam folder if it does not arrive.');
    $('bookingForm').hidden = true;
    $('resultPanel').hidden = false;
    $('resultPanel').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function userError(message) { var e = new Error(message); e.userMessage = message; return e; }

  function onSubmit(ev) {
    ev.preventDefault();
    if (busy) return;
    showError('');
    var d = collect();
    var err = validate(d);
    if (err) { showError(err); return; }
    busy = true;
    $('submitBtn').disabled = true;
    $('submitBtn').textContent = 'Please wait...';
    (DEMO ? demoBook(d) : post(d)).then(function (r) {
      if (!r || !r.ok) throw userError('' + ((r && r.error) || 'Something went wrong. Please try again.'));
      if (typeof r.reference !== 'string' || typeof r.total !== 'number' || !r.bank) {
        throw userError('We received an unexpected reply from the booking system. Please try again, or contact the organiser before paying anything.');
      }
      showResult(r);
    }).catch(function (e) {
      showError(e && e.userMessage ? e.userMessage
        : 'We could not reach the booking system to complete your booking. This is sometimes caused by an ad blocker or privacy extension. Please try turning that off, or use a different browser or private/incognito mode, then click the button again — it is safe to try again.');
    }).then(function () {
      busy = false;
      $('submitBtn').disabled = false;
      $('submitBtn').textContent = 'Get my payment reference';
    });
  }

  function copyText(text, btn) {
    var label = btn.textContent;
    var done = function () { btn.textContent = 'Copied'; setTimeout(function () { btn.textContent = label; }, 1800); };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done, function () {});
    } else {
      var ta = document.createElement('textarea');
      ta.value = text; document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); done(); } catch (e) { /* ignore */ }
      document.body.removeChild(ta);
    }
  }

  function showClosed(message) {
    $('eventTitle').textContent = 'Book tickets';
    $('closedMsg').textContent = message;
    $('closedMsg').hidden = false;
  }

  function start(cfg) {
    config = cfg;
    applyBranding(cfg);
    $('eventTitle').textContent = cfg.eventName || 'Book tickets';
    $('eventMeta').textContent = [cfg.dateText, cfg.venue].filter(Boolean).join(' - ');
    $('demoBanner').hidden = !DEMO;
    if (!cfg.open) {
      showClosed(cfg.closedMessage || 'Bookings are closed.');
      $('eventTitle').textContent = cfg.eventName || 'Book tickets';
      return;
    }
    buildForm();
    $('bookingForm').hidden = false;
    $('veg').addEventListener('change', function () {
      $('nonVeg').textContent = String(totals().people - Number($('veg').value));
    });
    $('bookingForm').addEventListener('submit', onSubmit);
    $('copyBtn').addEventListener('click', function () { copyText($('refValue').textContent, $('copyBtn')); });
    Array.prototype.forEach.call(document.querySelectorAll('.copy-mini'), function (btn) {
      btn.addEventListener('click', function () { copyText(copyValues[btn.getAttribute('data-copy')] || '', btn); });
    });
    $('newBtn').addEventListener('click', function () {
      $('resultPanel').hidden = true;
      $('bookingForm').hidden = false;
      $('bookingForm').reset();
      buildForm();
      window.scrollTo(0, 0);
    });
  }

  function loadConfig() {
    $('connError').hidden = true;
    $('eventTitle').textContent = 'Loading...';
    fetch(BACKEND + '?action=config').then(function (r) { return r.json(); }).then(start).catch(function () {
      $('eventTitle').textContent = 'Book tickets';
      $('connError').hidden = false;
    });
  }

  if (UNKNOWN_ORG) {
    document.title = 'Book tickets';
    showClosed('This booking link is not recognised. Please check the link you were given.');
  } else if (DEMO) {
    start(DEMO_CONFIG);
  } else {
    $('retryBtn').addEventListener('click', loadConfig);
    loadConfig();
  }
})();
