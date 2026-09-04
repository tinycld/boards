---
title: Board rules
summary: React automatically when cards are created, moved, completed, canceled, assigned, estimated, rescheduled, archived, parented, or reacted to
tags: [rules, automation, workflow, boards]
order: 50
---

Boards take part in [automation rules](help://core:rules) through ten
triggers and five actions.

## What starts a rule

| Trigger | Fires when |
|---|---|
| **A card is created** | a new card is added to any board you're a member of |
| **A card moves to another list** | a card changes list — not when it's just reordered |
| **A card is completed** | a card moves into a list whose status is Done |
| **A card is canceled** | a card moves into a list whose status is Canceled |
| **A card is assigned** | a card's assignees change |
| **A card's priority changes** | a card is set to a different priority, including back to none |
| **A card's estimate changes** | a card is sized, resized, or its estimate cleared |
| **A card's dates change** | a start date or due date is set, moved or cleared, or a time is added to or taken off a deadline |
| **A card is archived** | a card is archived, by a person or by the board's auto-archive — not when it is restored |
| **A card's parent changes** | a card becomes a sub-task of another, or stops being one |
| **Someone reacts to a comment** | an emoji reaction is added to a comment on a card |

All eleven cover every card on a board you belong to, not only cards you
created — so a rule fires when a colleague moves your card, which is usually
the point.

**Completed and canceled are their own events.** You could imagine expressing
either as "moved, if the destination is the Done list", but you can't: a
condition can only look at the card's own fields, and a list's status is a
property of the list. So each is a separate trigger. See
[List status](help://cards:working-with-cards) for how a list gets its status.

Reordering a card within a list is not a move. Only a change of list counts.

## What a rule can do

**Move the card to a list** files the card that started the rule into a list
you pick. It only ever moves that card — a rule can't reach out and move a
different one.

**Set the card priority** gives the card that started the rule the priority
you pick — including **No priority**, so a rule can lower a card as well as
raise it.

**Set the card estimate** sizes the card that started the rule in points; `0`
clears the estimate.

**Make the card a sub-task** files the card that started the rule under another
card. The parent has to be on the same board, and cannot itself be a sub-task —
the rule fails with a message saying so rather than filing the card somewhere
you cannot see it.

## Recipes

**Auto-file bugs.** When a card is created, if the title contains `bug`, move
it to the Triage list.

**Tell the team when something ships.** When a card is completed, send a
notification — or an email, if you'd rather not rely on people watching the
board.

**Size new bugs by default.** When a card is created, if the title contains
`bug`, set the estimate to 3.

**Hear about archived work.** When a card is archived, send a notification —
the board's auto-archive counts, so this also tells you what it tidied away.

**Say why something was dropped.** When a card is canceled, send a
notification to the team so nobody keeps waiting on it.

**Follow up on assignment.** When a card is assigned, create a calendar
reminder titled after the card. Needs the calendar package installed.

## What rules can't do yet

- **Creating cards, adding assignees or labels, setting a due date.** These
  need capabilities the rules system doesn't have yet — appending to a list of
  people or labels without replacing what's there, and doing date arithmetic.
  They're planned.
- **Overdue cards.** "Tell me when a card passes its due date" isn't
  expressible: rules react to something happening, not to time passing. A card
  sitting still is not an event.
- **Acting on a different card.** Move the card applies to the card that
  started the rule.
