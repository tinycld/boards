---
title: Board rules
summary: React automatically when cards are created, moved, completed, or assigned
tags: [rules, automation, workflow, boards]
order: 50
---

Boards take part in [automation rules](help://core:rules) through five
triggers and four actions.

## What starts a rule

| Trigger | Fires when |
|---|---|
| **A card is created** | a new card is added to any board you're a member of |
| **A card moves to another list** | a card changes list — not when it's just reordered |
| **A card is completed** | a card moves into a list marked as done |
| **A card is assigned** | a card's assignees change |
| **A card's priority changes** | a card is set to a different priority, including back to none |

All five cover every card on a board you belong to, not only cards you
created — so a rule fires when a colleague moves your card, which is usually
the point.

**Completed is its own event.** You could imagine expressing it as "moved, if
the destination is the Done list", but you can't: a condition can only look at
the card's own fields, and whether a list counts as done is a property of the
list. So it's a separate trigger.

Reordering a card within a list is not a move. Only a change of list counts.

## What a rule can do

**Move the card to a list** files the card that started the rule into a list
you pick. It only ever moves that card — a rule can't reach out and move a
different one.

**Set the card priority** gives the card that started the rule the priority
you pick — including **No priority**, so a rule can lower a card as well as
raise it.

## Recipes

**Auto-file bugs.** When a card is created, if the title contains `bug`, move
it to the Triage list.

**Tell the team when something ships.** When a card is completed, send a
notification — or an email, if you'd rather not rely on people watching the
board.

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
