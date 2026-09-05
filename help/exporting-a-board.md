---
title: Exporting a board
summary: Save a board as a spreadsheet or a full backup file
tags: [export, csv, json, backup, spreadsheet, download, reporting]
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

## Exporting from the command line

The `tinycld` command exports the same two formats, which is the way to script a
regular backup:

```
tinycld boards export OTTER --out board.csv
tinycld boards export OTTER --format json --out backup.json
```

Leave off `--out` to write to standard output and pipe it somewhere else. See
[the command line](help://boards:command-line) for setting the tool up.

## What export does not do

The export always covers the whole board. A filter you have applied on screen
does not narrow the file — export the board and filter it in your spreadsheet,
which is where that work is easier anyway.

Attachments are not included. The file records that a card has them and how
many, but the files themselves stay on the card.
