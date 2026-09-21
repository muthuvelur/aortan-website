# Ticket booking: setup and yearly use

How it works: a person fills in `booking.html`, gets a unique 5-letter payment reference (like `RAKIM`) and the exact
amount, and pays by bank transfer using that reference. The reference is also emailed to them. Every booking is a row in
a Google Sheet. The treasurer pastes the bank statement into the sheet and clicks one menu item: payments are matched to
bookings automatically.

All the settings (event, date, venue, bank details, ticket types and prices, capacity) are cells in the sheet.
Nobody needs to edit code.

## One-time setup (about 15 minutes)

Use the Google account that should send the emails (for example aortanbirmingham@gmail.com).

1. Go to https://sheets.google.com and create a blank sheet called **Tickets**.
2. Click **Extensions > Apps Script**. Delete everything in the editor and paste in all of `backend/Code.gs`. Save.
3. In the toolbar choose the function **setup** and click **Run**. Approve the permissions when asked
   (Google shows a "not verified" warning for your own script: click Advanced, then Go to project).
4. A **Settings** tab appears. Fill it in: event name, date, venue, contact email, **bank details**, days to pay,
   maximum people, and the ticket types with their prices in the small table on the right (price 0 = free).
5. Back in Apps Script, run **setup** again. It checks the settings and tells you in plain English what to fix.
   When it says setup is done, the `Bookings`, `Bank` and `Summary` tabs exist.
6. Click **Deploy > New deployment**, gear icon > **Web app**. Set **Execute as: Me** and **Who has access: Anyone**.
   Click Deploy and copy the **Web app URL**.
7. Put that URL in `booking-config.js` in this repo (edit on github.com, same as the yearly programme):
   `window.BOOKING_BACKEND_URL = 'https://script.google.com/macros/s/.../exec';`
8. Make a test booking on `booking.html`. Check that a row appears in `Bookings` and the email arrives. Delete the test row.
9. When you are happy, remove the line `<meta name="robots" content="noindex">` from `booking.html`, and add a
   "Book tickets" link to `booking.html` inside the programme block on the home page.

The sheet also gets a menu, **AORTAN tickets** (it uses your organisation name), each time it is opened.

## Treasurer routine

1. Open the bank statement (online banking, or export the CSV). Copy three columns for the new payments into the
   **Bank** sheet: Date, Description (this is where the reference appears), Amount paid in. Start at row 2, columns A to C.
2. Menu **1. Match bank payments**.
   - Column D on the Bank sheet says what happened to each payment. "NOT MATCHED" rows need a human look, and the
     message says why (for example "the reference is there but the amount is not what they owe").
   - On `Bookings`, Paid by bank, Status (Pending / Part paid / Paid / Overpaid) and Balance update themselves.
   - A payment is matched automatically only when it has the booking's reference **and** the amount is what that
     booking owes. That stops a payer's surname or an ordinary word in the bank text from matching by accident.
   - Part payments, cash or anything else: type the amount in **Paid manually** on that booking, then match again.
   - Duplicate or unwanted booking: set Status to **Cancelled** (it frees the places).
3. Menu **2. Email "payment received"** sends a confirmation to everyone newly paid (asks you first).
4. Menu **3. Email reminders** nudges people who booked more than the allowed days ago and have not paid (asks you first).
5. The **Summary** sheet has the counts for the caterer (vegetarian / non-vegetarian) and the money totals.

You can paste the whole statement again at any time: the match recalculates from scratch and never double counts.

## Each year, or for a new event

Easiest: **File > Make a copy** of last year's sheet (the script is copied with it), clear the rows on `Bookings` and
`Bank`, change the **Settings** tab, then deploy the copy as a new web app and put its URL in `booking-config.js`.
If you change the ticket types after bookings exist, the script stops and tells you, so old rows are never mixed up.
Set **Bookings open?** to No to close bookings at any time.

## Handing this to another organisation

They need: (1) a copy of the sheet, (2) 15 minutes for setup steps 3 to 6 above, (3) a copy of `booking.html`,
`booking.js`, `booking-config.js` and `style.css` on any free web host (GitHub Pages works), with their own logo and name
in the page header. Everything else (prices, ticket types, bank details, emails, capacity) is in their Settings tab.

## Notes

- The prices and totals are calculated on the server. Changing the page in a browser cannot change what someone owes.
- Gmail lets a script send roughly 100 emails a day. That is enough for a community event, but spread out reminders.
- Details people enter (name, email, mobile) are stored only in your Google Sheet. Share the sheet only with the committee.
- References are name-shaped letters such as RAKIM. Words that are rude or that appear on bank statements (SAVER,
  DEBIT, TOTAL...) are never issued.
- Run `node backend/test.js` to run the automatic checks after any change to `Code.gs`.
