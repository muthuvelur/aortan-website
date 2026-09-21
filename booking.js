(function () {
  'use strict';

  var BACKEND = String(window.BOOKING_BACKEND_URL || '').trim();
  var DEMO = !BACKEND;
  var CONSONANTS = 'BDGKLMNPRSTV';
  var VOWELS = 'AEIOU';

  var DEMO_CONFIG = {
    ok: true,
    organiser: 'AORTAN',
    eventName: 'Thamizhar Thirunal – Pongal 2027',
    dateText: 'Saturday, date to be confirmed, 2027 from 4 PM',
    venue: 'Walsall Football Club, Jimmy Walker Suite, Bescot Crescent, Walsall, WS1 4SA',
    open: true,
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
    fillSelect($('veg'), t.people, true);
    $('nonVeg').textContent = String(t.people - Number($('veg').value));
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
      veg: Number($('veg').value) || 0,
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
      if (!r || !r.ok) throw new Error((r && r.error) || 'Something went wrong. Please try again.');
      showResult(r);
    }).catch(function (e) {
      showError(e.message && e.message !== 'Failed to fetch' ? e.message : 'We could not reach the booking system. Please check your connection and try again.');
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

  function start(cfg) {
    config = cfg;
    $('eventTitle').textContent = cfg.eventName || 'Book tickets';
    $('eventMeta').textContent = [cfg.dateText, cfg.venue].filter(Boolean).join(' - ');
    $('demoBanner').hidden = !DEMO;
    if (!cfg.open) {
      $('closedMsg').textContent = cfg.closedMessage || 'Bookings are closed.';
      $('closedMsg').hidden = false;
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

  if (DEMO) {
    start(DEMO_CONFIG);
  } else {
    fetch(BACKEND + '?action=config').then(function (r) { return r.json(); }).then(start).catch(function () {
      $('closedMsg').textContent = 'The booking system is not available right now. Please try again later or email aortanbirmingham@gmail.com.';
      $('closedMsg').hidden = false;
    });
  }
})();
