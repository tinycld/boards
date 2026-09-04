---
title: Archiving and deleting
summary: Put cards and boards out of the way, bring them back, or delete a board for good
tags: [archive, restore, delete, cards, boards]
order: 45
---

## Archiving a card

Archiving takes a card off the board without losing anything: its checklist,
comments and attachments all stay with it. Open the card, click **More
actions**, and choose **Archive card** — or select the card on the board and
press `x`. Nothing asks for confirmation, because nothing is destroyed.

## Finding and restoring archived cards

Click the archive icon in the board's top bar to open **Archived cards**. The
list shows every archived card on the board, newest first, with its key, the
list it came from, and when it was archived. Anyone on the board can look;
editors and owners can act.

To bring a card back, click **Restore** — it returns to the list it left, in
its old position. To delete a card for good, click the trash icon on its row
and confirm. That removes the card's checklist, comments and attachments too.

## Archiving finished cards automatically

A board can tidy itself: open the board menu, choose **Board settings…**, and
set how many days a card may sit in a **Done** or **Canceled** list before it
is archived for you. `0`, the default, turns this off. The count starts when
the card enters the list, so a card moved back into progress starts over.

Cards archived this way land in **Archived cards** like any other, with
"Automatically" as who archived them in the card's history, and restore the
same way. Only a board's owner can change the setting.

## Archiving a board

To put a whole board away, open its menu (the `…` at the top right) and choose
**Archive board**. The board leaves the **Projects** list in the sidebar and
appears under **Archived**, which stays folded until you click it. Nothing on
the board changes. Only a board's owner can archive it.

To bring one back, open it from the **Archived** section and click **Restore
board** in the banner at the top, or choose **Restore board** from the board
menu.

## Deleting a board

Deleting a board is permanent and takes everything with it: every list, card,
comment, checklist and attachment, along with the board's members and any
share links. To do it, open the board menu, choose **Delete board…**, and type
the board's name to confirm. The dialog tells you how many lists, cards and
members are about to go. Only an owner can delete a board.

If you are not sure, archive instead — it is reversible, and an archived board
costs nothing to keep.

From the command line, `tinycld cards board archive` and `tinycld cards board
remove` do the same; see [Cards from the command line](help://cards:command-line).
