# Expense Tracker

A personal expense tracker that runs in the browser and installs to the iPhone home screen.
Everything stays on the device. Nothing is sent anywhere (except a request for exchange rates if you set a home currency).

## What it does
- Add a bank statement (Excel, CSV, PDF or pasted text). A small helper on the phone reads it, checks it against the
  bank's running balance, groups it by payee, learns the names you teach it, skips rows you already have, and can
  undo a whole import in one tap.
- Add by typing: write or dictate "250 chai" or "paid 1,200 electricity", or paste a bank SMS ("debited by ... to ...").
  The app works out the amount, name, date and category on the phone, shows you what it understood, and adds it when you tap.
  No internet and no outside service is used.
- Who owes me: "lent Ravi 500", "split dinner 1200 with Ravi and Meena" or "Ravi paid back 300". The app keeps a list of who
  still owes you, marks it off when they pay (also partly), spots a matching payment in your list, and can draft a reminder.
- Budgets with optional rollover, recurring entries, written insights, month forecast and safe-to-spend,
  alerts for unusual spending, repeating-payment detection, savings goals, upcoming bills.
- Accounts with transfers, split transactions, tags, receipt photos, one home currency with daily rates,
  year in review, monthly PDF reports, Excel/CSV export, full backup/restore, PIN lock, light and dark looks.

## Use it on an iPhone
1. Open the site in Safari.
2. Tap Share, then **Add to Home Screen**.
3. Open it from the home screen. Tap the tray icon at the top, or More, then *Add a bank statement*.

Back up regularly: More, then *Your data*, then *Save full backup* (keep the file in iCloud Drive).

## Files
Everything sits in one flat folder, so it can be uploaded to GitHub with "Add file, Upload files".
`pdf.min.mjs` and `pdf.worker.min.mjs` are pdf.js 6.2.108 by Mozilla, used only to read text PDFs on the device
(Apache License 2.0, https://github.com/mozilla/pdf.js). Everything else is original to this project.
`quick.js` (reads typed sentences and SMS), `entry.js` (the Home card) and `owed.js` (the ledger helpers) are the newest files.
