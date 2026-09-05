---
title: Board rules
summary: React automatically when cards are created, moved, completed, canceled, assigned, estimated, rescheduled, archived, parented, reacted to, or when a deadline passes
tags: [rules, automation, workflow, boards]
order: 50
---

Boards take part in [automation rules](help://core:rules) through thirteen
triggers and eight actions.

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
| **A card is due soon** | a card is within two days of its due date |
| **A card becomes overdue** | a card passes its due date |

All thirteen cover every card on a board you belong to, not only cards you
created — so a rule fires when a colleague moves your card, which is usually
the point.

**Completed and canceled are their own events.** You could imagine expressing
either as "moved, if the destination is the Done list", but you can't: a
condition can only look at the card's own fields, and a list's status is a
property of the list. So each is a separate trigger. See
[List status](help://boards:working-with-cards) for how a list gets its status.

Reordering a card within a list is not a move. Only a change of list counts.

**Deadlines fire once each.** A card is checked every minute, and each of the
two deadline triggers fires once per due date — not once a minute while the
card stays late. Changing a card's due date starts that over, so a rescheduled
card can be announced again when the new deadline arrives.

A card in a Done or Canceled list never fires either one: finished work is not
late, whichever way it finished.

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

**Assign the card to someone** adds one person to the card's assignees, keeping
whoever is already there. **Add a label to the card** does the same for labels.

**Create a card** makes a new card at the bottom of a list you pick. The title
can quote the card that started the rule — `Follow up: {{title}}` — and the
list may be on a different board, as long as you can add cards to that board
yourself.

**Move the due date** shifts the card's deadline by a number of days: `7` for a
week later, `-1` for a day earlier. A card with no due date gets one counted
from today, so `7` means "due in a week".

Moving a due date sets it to a whole day and drops any time of day the card
had. A rule runs on the server, which has no way of knowing which time zone
you meant, so it works in whole days rather than guessing an hour.

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

**Chase overdue work.** When a card becomes overdue, if its priority is Urgent,
send a notification — or move it to a Blocked list so it stops reading as in
progress.

**Give slipped work a new date.** When a card becomes overdue, move the due
date by `7` so it comes back next week instead of sitting there late.

**Open the follow-up automatically.** When a card is completed, create a card
titled `QA: {{title}}` in your QA list.

## Sprints

On a board that plans in [sprints](help://boards:sprints), three more triggers
and three more actions appear: **A card's sprint changes**, **A sprint
starts** and **A sprint completes**; **Move the card to a sprint**, **Move the
card to the backlog** and **Move the card into the active sprint**. The two
sprint triggers act on the sprint itself, so card actions are not offered
under them.

## What rules can't do yet

- **An exact time of day.** Due dates a rule sets are whole days, and the two
  deadline triggers work in days. A rule can't run at 9am sharp.
- **Acting on a different card.** Every action except Create a card applies to
  the card that started the rule.
- **Removing an assignee or a label.** The actions add; they don't take away.
