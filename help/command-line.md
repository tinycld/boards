---
title: Cards from the command line
summary: List boards, add and move cards, and script your kanban from a terminal with the tinycld CLI.
tags: [cli, terminal, automation, board, card, list]
order: 130
---

The `tinycld` command line tool includes a `cards` command group when the Cards
package is installed. To download the tool and log in, see
[Command line tool](help://core:command-line). Everything below assumes you are
logged in.

## Naming a board, a list, and a card

A **board** and a **list** can be named either by their id or by their name, so
you rarely need to look an id up:

```
tinycld cards board view "Product launch"
tinycld cards list show --board "Product launch"
```

Names are matched ignoring case. If two boards share a name, the command stops
and shows you both ids rather than guessing which one you meant — pass the id
in that case.

A **card** is named by its key — `OTTER-12` — or by its id. Both appear in
every listing, in the `KEY` and `ID` columns. The key is the one you can read
off a card in the app and type here.

Card titles are never accepted. They are not unique and are the thing most
likely to be edited, so a command that found a card by title would start acting
on a different card after someone renamed it.

## Looking at a board

```
tinycld cards board list                    # the boards you are a member of
tinycld cards board view "Product launch"   # every column, with its cards
tinycld cards card view OTTER-12            # one card, in full
```

`board list` and `board view` hide archived boards and cards; add `--all` to
include them. `card view` shows the description, checklist and comments that
the board view leaves out.

## Adding and editing cards

```
tinycld cards card add "Write the press release" \
    --board "Product launch" --list "To do"

tinycld cards card add "Book the venue" \
    --board "Product launch" --list "To do" --due 2026-09-01 --index 0
```

New cards go to the bottom of the column. `--index 0` puts one at the top, and
any other number places it at that position, counting from zero.

```
tinycld cards card edit <card> --title "Write the launch post"
tinycld cards card edit <card> --due 2026-09-15
tinycld cards card edit <card> --clear-due
```

`edit` only changes what you name. Editing the title leaves the description
alone, so you cannot blank a field by not mentioning it. Due dates are whole
days, written as `YYYY-MM-DD`.

## Moving cards

```
tinycld cards card move <card> --list Doing        # to another column
tinycld cards card move <card> --index 0           # to the top of its column
tinycld cards card move <card> --list Done --index 0
```

Moving to another column with no `--index` puts the card at the bottom, which
is where a dragged card lands when you do not aim at a particular slot.

## Archiving and deleting

```
tinycld cards card archive <card>            # hide it, reversibly
tinycld cards card archive <card> --unset    # bring it back
tinycld cards card remove <card> --yes       # delete it for good
```

Archiving is the reversible option and is almost always what you want.
`remove` deletes the card's checklist, comments and attachments along with it,
and asks for `--yes` before doing so.

## Columns

```
tinycld cards list show --board "Product launch"
tinycld cards list add Blocked --board "Product launch"
tinycld cards list rename "To do" Backlog --board "Product launch"
tinycld cards list move Blocked 1 --board "Product launch"
tinycld cards list done Shipped --board "Product launch"
```

`list move` takes the position the column should end up in, counting from zero.
`list done` marks a column as the one that means finished — cards there show as
complete. Add `--unset` to clear it.

Deleting a column **also deletes every card in it**, which cannot be undone:

```
tinycld cards list remove Blocked --board "Product launch"
```

The command refuses and tells you how many cards would go with it. Re-run with
`--yes` once you are sure. An empty column is removed without asking. If you
want to keep the cards, move them to another column first.

## Sharing stays in the app

There are no commands for adding people to a board or creating share links.
The command line tool is authorized to read and change your cards, but not to
give other people access to them — so sharing is done in the app, where the
Share dialog shows exactly who gains access. See
[Sharing boards](help://cards:sharing-boards).

## Scripting

Every command accepts `--json` for stable, machine-readable output. Status
messages go to the error stream, so what you pipe stays clean:

```
tinycld cards board list --json | jq '.[].name'
tinycld cards board view "Product launch" --json | jq '.[].cards[].title'
```

`--output csv` is there too, for a spreadsheet or `cut`. Commands that change
something print the row they wrote, so you can capture a new card's id:

```
tinycld cards board list --output csv > boards.csv
tinycld cards card add "Ship it" --board "Product launch" --list "To do" --output csv
```

Positions count from zero and are never negative — a negative index is refused
rather than read as "the top", because it is almost always a slip in the
arithmetic that produced it. An index past the end of a column simply puts the
card last.
