# Ticket booking: setup, yearly use, and other organisations

How it works: a person fills in the booking page, gets a unique 5-letter payment reference (like `RAKIM`) and the exact
amount, and pays by bank transfer using that reference. The reference is also emailed to them. Every booking is a row in
a Google Sheet. The treasurer pastes the bank statement into the sheet and clicks one menu item: payments are matched to
bookings automatically.

**Everything is a cell in the Sheet's Settings tab.** Nobody edits code, and changes apply straight away with no redeploy.

## What you can change in the Settings tab

| Setting | What it does |
|---|---|
| Organisation name, Event name, Date and time, Venue | Shown on the page and in the emails |
| Contact email | Replies to booking emails go here |
| Bank account name, sort code, account number | Shown to the buyer after booking |
| Days to pay, Maximum people | Reminder timing; bookings stop when full (0 = no limit) |
| Bookings open? | Yes / No. No closes bookings immediately |
| Ask about vegetarian food? | Yes / No. No hides the food question |
| Message when closed | Shown when bookings are closed |
| Page look (all optional) | A line under the name, a second line, a logo link (https://), a website link, header colour, button colour |
| **Ticket table** (right of the settings) | Up to 8 ticket types: name, price (0 = free), max per booking |

Type "Check settings" from the sheet menu at any time: it lists anything that needs fixing in plain English.
Header and button colours are hex codes like `#0d5c68`; dark colours work best because the header text is white.

## This year's prices (or any change)

1. Open the Sheet, go to the **Settings** tab.
2. Change the numbers in the **Price** column of the ticket table (or rename or add a ticket type).
3. That's it. The booking page shows the new prices immediately, and the total each person pays is worked out from them.

Change ticket *names* only before bookings start: the Bookings sheet columns follow the ticket names, and the script
stops and tells you if they no longer match. For a new event, start from a fresh copy of the sheet (below).

## One-time setup (about 15 minutes)

Use the Google account that should send the emails (for example aortanbirmingham@gmail.com).

1. Go to https://sheets.google.com and create a blank sheet called **Tickets**.
2. Click **Extensions > Apps Script**. Delete everything in the editor and paste in all of `backend/Code.gs`. Save.
3. In the toolbar choose the function **setup** and click **Run**. Approve the permissions when asked
   (Google shows a "not verified" warning for your own script: click Advanced, then Go to project).
4. A **Settings** tab appears with example values. Fill in every row and the ticket table.
5. Back in Apps Script, run **setup** again. It checks the settings and tells you what to fix. When it says setup is
   done, the `Bookings`, `Bank` and `Summary` tabs exist.
6. Click **Deploy > New deployment**, gear icon > **Web app**. Set **Execute as: Me** and **Who has access: Anyone**.
   Click Deploy and copy the **Web app URL**.
7. Put that URL in `booking-config.js` in this repo (edit on github.com, same as the yearly programme):
   `window.BOOKING_BACKEND_URL = 'https://script.google.com/macros/s/.../exec';`
8. Make a test booking on `booking.html`. Check that a row appears in `Bookings` and the email arrives. Delete the test row.
9. When you are happy, remove the line `<meta name="robots" content="noindex">` from `booking.html`, and link to
   `booking.html` from the programme block on the home page.

The sheet also gets a menu, **[Organisation] tickets**, each time it is opened.

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
5. The **Summary** sheet has the counts for the caterer (if food is asked) and the money totals.

You can paste the whole statement again at any time: the match recalculates from scratch and never double counts.

## A new event next year

**File > Make a copy** of the sheet (the script is copied with it), clear the rows on `Bookings` and `Bank`, change the
**Settings** tab, then deploy the copy as a new web app (setup steps 6 and 7).

## Letting another organisation use it

Each organisation has its **own Google Sheet** (so its bookings and bank details are private to it). They need:

1. A copy of the sheet (send them the Sheet with `Code.gs` already inside; File > Make a copy carries the script).
2. 15 minutes for setup steps 3 to 6: fill in **their** Settings tab (name, bank details, tickets, look) and deploy it.
3. A booking page. Two options:
   - **They host their own copy** of `booking.html`, `booking.js`, `booking-config.js` and `style.css` on any free
     host (GitHub Pages works) and paste their Web app URL into `booking-config.js`. Their name, logo and colours
     come from their Settings tab, so the files need no changes.
   - **You host it for them.** Add one line to `BOOKING_BACKENDS` in `booking-config.js`, for example
     `keralasamajam: 'https://script.google.com/macros/s/.../exec',` and give them the link
     `https://your-site/booking.html?org=keralasamajam`. Only organisations you list can be opened this way.

## Notes

- Prices and totals are calculated on the server. Changing the page in a browser cannot change what someone owes.
- Gmail lets a script send roughly 100 emails a day. That is enough for a community event, but spread out reminders.
- Details people enter (name, email, mobile) are stored only in the organiser's Google Sheet. Share it only with the committee.
- References are name-shaped letters such as RAKIM. Words that are rude or that appear on bank statements (SAVER,
  DEBIT, TOTAL...) are never issued.
- Run `node backend/test.js` to run the automatic checks after any change to `Code.gs`.
