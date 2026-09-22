// ONE organisation: paste its Google Apps Script "Web app URL" between the quotes.
// While this is empty the page runs in DEMO mode and saves nothing.
window.BOOKING_BACKEND_URL = 'https://script.google.com/macros/s/AKfycbwn4Vd1JVmrx2ycYFkuOGGYgwoRuSlhYrbhoI6jlzU21VtmlwPWXU62JmqK5z2lVgLhnw/exec';

// SEVERAL organisations on one page: booking.html?org=name opens the booking for that name.
// Add one line per organisation (delete the // at the start of the line).
window.BOOKING_BACKENDS = {
  // aortan: 'https://script.google.com/macros/s/XXXX/exec',
  // keralasamajam: 'https://script.google.com/macros/s/YYYY/exec',
};
