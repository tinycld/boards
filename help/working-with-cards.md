---
title: Working with cards
summary: Opening a card, editing its details, and moving it between lists
tags: [cards, board, kanban, detail, shortcuts, formatting, "drag and drop"]
order: 20
---

## Opening a card

Click any card on the board to open it in a panel on the right. The board stays
visible behind the panel — click a different card to switch to it without
closing anything.

To give a card the whole screen, click the expand button (the arrows in the
panel's top corner). Your browser's back button returns you to the board.

## Moving cards by drag and drop

To move a card, drag it anywhere you like — within its list to reorder, or
into another list. On a computer, click and drag; on a touch screen, press and
hold a card for a moment, then drag. While you drag, a gap opens at the exact
spot the card will land, and the list under your pointer is outlined. Drop the
card outside every list to cancel — it glides back to where it started.

Dragging a card toward the left or right edge of the window scrolls the board,
so you can reach lists that are off screen.

## Rearranging lists

To move a whole list, drag it by its name in the list header. A colored bar
shows which side of the neighboring list it will land on. The list menu's
**Move left** and **Move right** do the same thing one step at a time.

## Making room on a busy board

Two controls change how much of the board you see at once. Both are yours
alone — they change nothing for anyone else on the board, and they stay set
the next time you open it.

To fold a list you're not working in down to a narrow strip, open its menu and
choose **Collapse list**, or double-click the list's name. The strip shows the
number of cards at the top and the list's name down its side, so a row of
collapsed lists still tells you where the work is piling up. Click the strip to
open it again.

Collapsed lists are still lists: you can drag a card onto one, and it lands
there.

To fit more cards on screen, click the rows button in the board's top bar to
**Hide card details**. Cards shrink to a single line, keeping the title, who
it's assigned to, and its due date — labels stay as colored dots. Click the
button again to bring the full cards back.

## Reordering a checklist

In an open card, drag a checklist item by the grip at the start of its row.
On a computer the grip appears when you point at the row.

## The list stepper

The row of small segments at the top of an open card shows where the card sits
on the board: one segment per list, filled up to the card's current list. To
move the card, click the segment for the list you want — the board updates
immediately.

## Card details

An open card shows its assignees, labels, and due date, followed by the
description, attachments, checklist, and comments. A due date turns amber when
it's less than two days away and red once it has passed — the same colors the
board shows on the card itself.

To add a file, see [Attaching files to cards](help://cards:attaching-files).

## Writing a description

Click a description and start typing — it formats as you go. Type `## ` for a
heading, `- ` for a bullet, `- [ ] ` for a checkbox, `**bold**`, `` `code` ``
or `~~strikethrough~~`, and each turns into the real thing as you finish it.
Tables and images you paste in are kept too. Everything is stored as Markdown,
so a description written here reads the same anywhere else.

If you would rather click than remember the syntax, a row of formatting buttons
appears above the description as soon as you start writing: bold, italic and
underline, three heading sizes, bullet and numbered lists, a quote, code, a
link, and an image. They act on whatever you have selected. The usual shortcuts
work too — ⌘B for bold, ⌘I for italic. The buttons are there only while you are
writing, so a description you are only reading stays clean.

To put a picture in a description, press the image button and choose one of the
card's image attachments — or upload a new one from the same dialog. On a
computer you can also drop an image file straight onto the description, and it
lands where you dropped it. Either way the picture is stored as a card
attachment, so it also appears in the Attachments section and follows the same
rules described in [Attaching files to cards](help://cards:attaching-files).

There is no save button: every change is kept as you type. Esc leaves the
description without discarding anything, and plain Enter starts a new line,
since a description is prose.

## Writing a description together

Several people can write the same description at once. Edits appear as they are
typed, each person's cursor shows where they are working, and changes merge
without anyone overwriting anyone else.

This works in the phone and tablet apps as well as the browser, and between
them: someone typing on their phone and someone typing on a laptop are writing
in the same description.

If your connection drops mid-sentence, keep typing — your words are held on
your machine and sent as soon as you are back. A short note under the
description says when that is happening.

People with **View** access can read a description but not change it, so the
formatting buttons never appear for them.

## Comments

Click the box at the bottom of an open card to write a comment. It works the
same way as the description: the text formats as you type — `**bold**`,
`` `code` ``, `- ` lists, links — and the same row of formatting buttons sits
above it while you write, including the image button, which stores the picture
as a card attachment.

Press ⌘↩ or the Send button to post. Plain Enter starts a new line, so a
longer comment does not send itself half-written. Reply to a comment to keep a
thread together.

To fix or expand one of your own comments, click it — it opens for editing
with the same formatting buttons. Save (⌘↩, or clicking elsewhere) keeps the
change; Esc closes without keeping it. Comments changed after posting show a
small *(edited)* mark next to their time, and only you can edit yours — other
people's comments are read-only, however a project owner may delete them.

## Who else is here

When someone else has the same board open, their initials appear beside the
member avatars at the top. Open a card they're looking at and you'll see them
on the card face too, so you can tell at a glance if a teammate is already
working on something.

These appear and disappear as people come and go — nothing is recorded, and
you'll never see yourself.

## Finding a card

Press `/` anywhere to open the search palette and start typing. Opened from a
board it is already scoped to cards, so you are searching your cards straight
away; choosing a result opens that card on its board. Press ⌫ with an empty box
to drop the scope and search every app at once. See
[Searching across packages](help://core:search) for the full grammar.

Archived cards are left out on purpose — search shows active work. To find one,
open its board and look through the archive.

## Keyboard shortcuts

You can work a board without touching the mouse. Press **J** to start — the
first press highlights a card, and from there:

- **J** / **↓** — next card
- **K** / **↑** — previous card
- **←** / **→** — the card beside it in the next column over
- **Enter** or **O** — open the highlighted card
- **Esc** — clear the highlight

J and K walk the board in order, list by list, so you can review a whole board
a card at a time. The arrow keys move across columns instead, keeping your place
in the column — handy when a board is laid out as stages.

To move a card, hold **⇧** with an arrow key:

- **⇧←** / **⇧→** — send it to the column beside it
- **⇧↑** / **⇧↓** — move it up or down its own column
- **X** — archive it

To add something:

- **N** — add a card to the highlighted column. If nothing is highlighted the
  first column takes it, and a collapsed column opens first.
- **⇧N** — add a list

The composer stays open after you press Enter, so you can type several cards in
a row without reaching for the mouse.

Moving, archiving and adding need permission to edit the board; if you're a
viewer or commentor, the navigation keys still work.

With a card open:

- **J** — next card
- **K** — previous card
- **E** — edit the title
- **Esc** — close the card (or return to the board from the full-screen view)

Press **⇧?** anywhere to see every shortcut the app knows, including the ones
for jumping between apps.

## Working from a terminal

Boards, lists and cards are all reachable from the `tinycld` command line, which
is the quicker path for bulk edits and for scripting a board from another tool —
see [Cards from the command line](help://cards:command-line).

## Missing a button?

What you can do on a board depends on your role there. If you can't add or
edit cards, you're likely a viewer or commentor — see
[Sharing boards](help://cards:sharing-boards).
