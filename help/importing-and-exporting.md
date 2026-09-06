---
title: Importing and exporting boards
summary: Bring a board in from Trello, or save one out as a spreadsheet or backup
tags: [export, import, trello, csv, json, backup, spreadsheet, download, migrating]
order: 32
---

Exporting writes a board out to a file you keep — for a status report, a
spreadsheet you want to pivot, or a backup taken before a big reorganisation.

To export a board, open it, press the **⋯** button beside its name, and choose
**Export…**. Pick a format and press **Export**. The file downloads on the web,
and on a phone or tablet it opens the share sheet so you can save it to Files,
send it on, or open it in another app.

## Which format to pick

**Spreadsheet (CSV)** gives one row per card, with a column for each of its
fields — the key, title, list, status, priority, estimate, labels, assignees,
reporter, epic, parent, start and due dates. Labels and assignees are joined
into one cell, separated by a semicolon. Open it in Excel, Numbers or Google
Sheets to sort, filter, chart or pivot.

CSV is a flat table, so it cannot hold the things that hang off a card. A card's
checklist, its comments and its links are not in the file.

**Full backup (JSON)** gives the whole board: every list, label and epic, every
card, and the checklists, comments and links a CSV row has no room for. It is
harder to read by eye, and it is the format to keep if what you want is a copy
of the board rather than a table to work with.

## What travels

Both formats carry **every card on the board, including archived ones**, each
marked so you can tell them apart. An export doubles as a backup, and one that
quietly dropped your archive would not be one.

People are named rather than numbered, so a column of assignees reads as names
you recognise. Cards on a board with a key export with theirs — `OTTER-14` —
and a card whose parent is another card names that parent by its key too.

## Importing a board

To bring a board in, press **+ New board** in the sidebar and switch to the
**Import** tab. Choose the file and press **Import**. An import always creates a
**new** board that you own — it never merges into one you already have.

Two kinds of file work:

- **A Trello board export.** In Trello, open the board's menu and choose *Print,
  export and share* → *Export as JSON*.
- **A board exported from here** as a full backup (JSON).

### What comes across from Trello

Lists, cards, labels, checklists and comments all come across, along with due
and start dates, and which cards were archived. Trello lets a card carry several
checklists where a card here has one, so they are joined together in order.

Three things cannot come across as they were, and the import tells you about
each one when it finishes:

- **Assignments.** Trello identifies people by ids that mean nothing here, so
  every card arrives unassigned. The import names everyone who *was* assigned so
  you can put them back deliberately.
- **Column statuses.** Trello has no notion of a column being "in progress" or
  "done", so each column's status is guessed from its name — a column called
  Done becomes a done column. The import lists every guess it made, and changing
  one is a single menu click on the column.
- **Who wrote a comment.** Comments are attributed to you, since the original
  author has no account here, and the original name is written into the comment
  itself so nothing is lost.

Card keys are not carried over either: keys are unique across every board, so an
imported board starts without one. Give it a key from **Board settings** if you
want `OTTER-14`-style card numbers.

By default an import writes no card history and sends no notifications — a few
hundred cards arriving at once is not news, and the history would bury the work
that follows. The `--hooks` flag on the command line turns that off.

## Exporting from the command line

The `tinycld` command exports the same two formats, which is the way to script a
regular backup:

```
tinycld boards export OTTER --out board.csv
tinycld boards export OTTER --format json --out backup.json
```

Leave off `--out` to write to standard output and pipe it somewhere else.

Importing works the same way:

```
tinycld boards import trello.json --name "Product launch"
```

See [the command line](help://boards:command-line) for setting the tool up.

## What export does not do

The export always covers the whole board. A filter you have applied on screen
does not narrow the file — export the board and filter it in your spreadsheet,
which is where that work is easier anyway.

Attachments are not included. The file records that a card has them and how
many, but the files themselves stay on the card.
