---
title: Boards from the command line
summary: List boards, add and move cards, and script your kanban from a terminal with the tinycld CLI.
tags: [cli, terminal, automation, board, card, list]
order: 130
---

The `tinycld` command line tool includes a `boards` command group when the Boards
package is installed. To download the tool and log in, see
[Command line tool](help://core:command-line). Everything below assumes you are
logged in.

## Naming a board, a list, and a card

A **board** and a **list** can be named either by their id or by their name, so
you rarely need to look an id up:

```
tinycld boards view "Product launch"
tinycld boards column show --board "Product launch"
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
tinycld boards list                   # the boards you are a member of
tinycld boards view "Product launch"  # every column, with its cards
tinycld boards card view OTTER-12     # one card, in full
```

`list` and `view` hide archived boards and cards; add `--all` to
include them. `card view` shows the description, checklist and comments that
the board view leaves out.

## Reacting to comments

```
tinycld boards card react <comment-id> thumbs_up    # or the emoji itself
tinycld boards card unreact <comment-id> thumbs_up
```

The six reactions are `thumbs_up`, `heart`, `laugh`, `party`, `eyes` and
`rocket`. You can paste the emoji instead if you have it to hand; the name is
easier to type in a terminal.

Comment ids come from `card view --json`. `card view` shows the counts under
each comment. `unreact` removes only your own reaction — no one can take back
anyone else's.

## Linking cards

```
tinycld boards card link OTTER-12 OTTER-40 --blocks       # 12 blocks 40
tinycld boards card link OTTER-12 HOME-3 --related        # any two cards
tinycld boards card link OTTER-12 OTTER-40 --duplicates
tinycld boards card unlink OTTER-12 OTTER-40
```

A link is stored once and reads from both ends, so the same link shows as
**Blocks** on one card and **Blocked by** on the other. `--related` and
`--duplicates` work the same way; only blocking has a direction that matters.

The two cards do not have to be on the same board. Filing a link needs
permission to edit the first card's board and membership of the second's.

`card view` lists a card's links. If one points at a card on a board you
cannot open, the link still appears — shown as *(a card on another board)* —
because a blocked card that looked unblocked would tell you something false
about whether the work can go ahead.

`unlink` does not care which order you name the two cards, and removes every
link between them.

## Archiving and deleting a board

```
tinycld boards archive "Product launch"            # out of the way, reversibly
tinycld boards archive "Product launch" --unset    # bring it back
tinycld boards remove "Product launch" --yes       # delete it for good
```

`remove` deletes every list, card, comment and attachment on the board along
with its members and share links, and tells you how many before it asks for
`--yes`. Only a board's owner can archive or remove it.

## Adding and editing cards

```
tinycld boards card add "Write the press release" \
    --board "Product launch" --list "To do"

tinycld boards card add "Book the venue" \
    --board "Product launch" --list "To do" --due 2026-09-01 --index 0
```

New cards go to the bottom of the column. `--index 0` puts one at the top, and
any other number places it at that position, counting from zero.

```
tinycld boards card edit <card> --title "Write the launch post"
tinycld boards card edit <card> --due 2026-09-15
tinycld boards card edit <card> --due "2026-09-15 14:30"
tinycld boards card edit <card> --clear-due
tinycld boards card edit <card> --start 2026-09-10
tinycld boards card edit <card> --clear-start
tinycld boards card edit <card> --reporter <user id>
tinycld boards card edit <card> --clear-reporter
tinycld boards card edit <card> --priority high
tinycld boards card edit <card> --estimate 5
tinycld boards card edit <card> --parent OTTER-4
tinycld boards card edit <card> --clear-parent
```

`edit` only changes what you name. Editing the title leaves the description
alone, so you cannot blank a field by not mentioning it. Dates are written as
`YYYY-MM-DD`; a due date may add a time as `"YYYY-MM-DD HH:MM"`, read in your
terminal's local time zone. `--start` takes a day only.

`--priority` takes `urgent`, `high`, `medium`, `low` or `none`, on `add` as
well as `edit`. A new card has no priority; `--priority none` clears one.

`--estimate` takes a whole number of points, on `add` as well as `edit`. A new
card has no estimate; `--estimate 0` clears one.

`--parent` makes the card a sub-task of another, on `add` as well as `edit`. It
takes a card id or a key, and the parent must be on the **same board**. Since a
relation has no "empty" value to write, `--clear-parent` is what stops a card
being a sub-task. A sub-task cannot have sub-tasks of its own.

A new card reports to you. Pass `--reporter` on `add` or `edit` to point it at
someone else — useful when a script or a shared account files cards that a real
person should be asked about. `--clear-reporter` hands it back to whoever
created the card. Both flags take a **user id**, not an email address.

## Moving cards

```
tinycld boards card move <card> --list Doing        # to another column
tinycld boards card move <card> --index 0           # to the top of its column
tinycld boards card move <card> --list Done --index 0
```

Moving to another column with no `--index` puts the card at the bottom, which
is where a dragged card lands when you do not aim at a particular slot.

```
tinycld boards card move <card> --board "Roadmap"               # to another board's first list
tinycld boards card move <card> --board "Roadmap" --list Backlog
tinycld boards card move <card> --board "Roadmap" --family move # bring sub-tasks
tinycld boards card copy <card>                                 # "Copy of …", same list
tinycld boards card copy <card> --title "Second attempt"
```

A move to another board keeps the checklist, comments and attachments,
matches labels by name (dropping the rest, which the command reports), and
gives the card a new key. `copy` duplicates a card with its checklist;
attachments are not copied.

Moving a card that has sub-tasks — or is one — needs `--family`, because a card
and its parent always live on the same board: `--family move` brings the
sub-tasks along, `--family unlink` leaves them behind as top-level cards. The
command refuses rather than guessing, and says what it did. A card that is
itself a sub-task always stops being one when it moves.

## Reacting to comments

```
tinycld boards card react <comment-id> thumbs_up    # or the emoji itself
tinycld boards card unreact <comment-id> thumbs_up
```

The six reactions are `thumbs_up`, `heart`, `laugh`, `party`, `eyes` and
`rocket`. You can paste the emoji instead if you have it to hand; the name is
easier to type in a terminal.

Comment ids come from `card view --json`. `card view` shows the counts under
each comment. `unreact` removes only your own reaction — no one can take back
anyone else's.

## Linking cards

```
tinycld boards card link OTTER-12 OTTER-40 --blocks       # 12 blocks 40
tinycld boards card link OTTER-12 HOME-3 --related        # any two cards
tinycld boards card link OTTER-12 OTTER-40 --duplicates
tinycld boards card unlink OTTER-12 OTTER-40
```

A link is stored once and reads from both ends, so the same link shows as
**Blocks** on one card and **Blocked by** on the other. `--related` and
`--duplicates` work the same way; only blocking has a direction that matters.

The two cards do not have to be on the same board. Filing a link needs
permission to edit the first card's board and membership of the second's.

`card view` lists a card's links. If one points at a card on a board you
cannot open, the link still appears — shown as *(a card on another board)* —
because a blocked card that looked unblocked would tell you something false
about whether the work can go ahead.

`unlink` does not care which order you name the two cards, and removes every
link between them.

## Archiving and deleting

```
tinycld boards card archive <card>            # hide it, reversibly
tinycld boards card archive <card> --unset    # bring it back
tinycld boards card remove <card> --yes       # delete it for good
```

Archiving is the reversible option and is almost always what you want.
`remove` deletes the card's checklist, comments and attachments along with it,
and asks for `--yes` before doing so.

## Columns

```
tinycld boards column show --board "Product launch"
tinycld boards column add Blocked --board "Product launch"
tinycld boards column rename "To do" Backlog --board "Product launch"
tinycld boards column move Blocked 1 --board "Product launch"
tinycld boards column category Blocked in_progress --board "Product launch"
tinycld boards column done Shipped --board "Product launch"
```

`column move` takes the position the column should end up in, counting from zero.
`column category` sets what a column means: `backlog`, `todo`, `in_progress`,
`done` or `canceled`. Cards in a done or canceled column show as finished and
get no reminders. `column done` is shorthand for `category done`; add `--unset`
to make it an ordinary `todo` column again.

Deleting a column **also deletes every card in it**, which cannot be undone:

```
tinycld boards column remove Blocked --board "Product launch"
```

The command refuses and tells you how many cards would go with it. Re-run with
`--yes` once you are sure. An empty column is removed without asking. If you
want to keep the cards, move them to another column first.

## Sharing stays in the app

There are no commands for adding people to a board or creating share links.
The command line tool is authorized to read and change your cards, but not to
give other people access to them — so sharing is done in the app, where the
Share dialog shows exactly who gains access. See
[Sharing boards](help://boards:sharing-boards).

## Scripting

Every command accepts `--json` for stable, machine-readable output. Status
messages go to the error stream, so what you pipe stays clean:

```
tinycld boards list --json | jq '.[].name'
tinycld boards view "Product launch" --json | jq '.[].cards[].title'
```

`--output csv` is there too, for a spreadsheet or `cut`. Commands that change
something print the row they wrote, so you can capture a new card's id:

```
tinycld boards list --output csv > boards.csv
tinycld boards card add "Ship it" --board "Product launch" --list "To do" --output csv
```

Positions count from zero and are never negative — a negative index is refused
rather than read as "the top", because it is almost always a slip in the
arithmetic that produced it. An index past the end of a column simply puts the
card last.
