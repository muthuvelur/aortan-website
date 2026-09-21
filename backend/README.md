# Ticket booking: setup and yearly use

How it works: a person fills in `booking.html`, gets a unique payment reference (like `AOR7K3QP`) and the exact amount,
and pays by bank transfer using that reference. Every booking is a row in a Google Sheet. The treasurer pastes the bank
statement into the sheet and clicks one menu item: payments are matched to bookings automatically.

## One-time setup (about 15 minutes)

Use the Google account that should send the emails (for example aortanbirmingham@gmail.com).

1. Go to https://sheets.google.com and create a blank sheet called **AORTAN Tickets**.
2. Click **Extensions > Apps Script**. Delete everything in the editor and paste in all of `backend/Code.gs`.
3. At the top, edit the `CONFIG` block: event name, date, venue, ticket prices, and the real **bank details**
   (account name, sort code, account number). Save (Ctrl+S).
4. In the toolbar choose the function **setup** and click **Run**. Approve the permissions when asked
   (Google shows a "not verified" warning for your own script: click Advanced, then Go to project).
   This creates the sheets `Bookings`, `Bank` and `Summary`.
5. Click **Deploy > New deployment**, choose the gear icon > **Web app**.
   Set **Execute as: Me** and **Who has access: Anyone**. Click Deploy and copy the **Web app URL**.
6. Put that URL in `booking-config.js` in this repo (edit on github.com, same as the yearly programme):
   `window.BOOKING_BACKEND_URL = 'https://script.google.com/macros/s/.../exec';`
7. Make a test booking on `booking.html`. Check that a row appears in `Bookings` and the email arrives. Delete the test row.
8. When you are happy, remove the line `<meta name="robots" content="noindex">` from `booking.html`, and add a
   "Book tickets" link to `booking.html` inside the programme block on the home page.

## Treasurer routine

1. Open the bank statement (online banking, or export the CSV). Copy three columns for the new payments into the
   **Bank** sheet: Date, Description (this is where the reference appears), Amount paid in. Start at row 2, columns A to C.
2. Menu **AORTAN tickets > 1. Match bank payments**.
   - Column D on the Bank sheet says what happened to each payment. "NOT MATCHED" rows need a human look.
   - On `Bookings`, the Paid by bank, Status (Pending / Part paid / Paid / Overpaid) and Balance columns update themselves.
   - Cash or other payments: type the amount in **Paid manually**, then run the match again.
   - Duplicate or unwanted booking: change Status to **Cancelled** (it frees the places).
3. Menu **2. Email "payment received"** sends a confirmation to everyone newly paid (asks you first).
4. Menu **3. Email reminders** nudges people who booked more than the allowed days ago and have not paid (asks you first).
5. The **Summary** sheet has the counts for the caterer (vegetarian / non-vegetarian) and the money totals.

You can paste the whole statement again at any time: the match recalculates from scratch and never double counts.

## Each year

Edit `CONFIG` (event name, date, prices, capacity), then **Deploy > Manage deployments > pencil icon > Version: New version > Deploy**.
Start a fresh copy of the sheet for each event (File > Make a copy), or clear the Bookings and Bank rows.

## Notes

- The prices and totals are calculated on the server. Changing the page in a browser cannot change what someone owes.
- Gmail lets a script send roughly 100 emails a day. That is enough for a community event, but spread out reminders.
- Details people enter (name, email, mobile) are stored only in your Google Sheet. Share the sheet only with the committee.
- Run `node backend/test.js` to run the automatic checks after any change to `Code.gs`.
