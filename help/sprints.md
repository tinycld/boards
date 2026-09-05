---
title: Sprints
summary: Plan work in timeboxed sprints from a backlog, run one at a time, and roll unfinished cards forward
tags: [sprints, backlog, planning, iterations, cycles, velocity, burndown, scrum]
order: 29
---

A **sprint** is a short, fixed stretch of time — usually one to four weeks —
with a set of cards the team commits to finishing in it. Cards wait in the
**backlog** until they are planned into a sprint; one sprint runs at a time;
when it ends, what was finished stays with it as its record and what was not
rolls forward.

A sprint groups by **when** work happens. A list says what stage a card is at,
an [epic](help://boards:epics) says what larger piece of work it belongs to,
and a sub-task belongs to another card. A card can have all four at once.

Sprints are off by default. Boards that never plan in timeboxes — a Trello-style
board, a personal to-do board — see none of this.

## Turning sprints on

Open the board menu (the **⋯** beside the board name), choose **Board
settings…**, and turn on **Plan work in sprints**. The same group sets:

- **Sprint length**, in days. New sprints are suggested this long; 14 is the
  default.
- **Start sprints automatically** — a planned sprint starts on its first day
  without anyone pressing Start.
- **Complete sprints automatically** — the running sprint completes the day
  after its last day.
- **Unfinished cards go to** the next sprint or the backlog, when a sprint is
  completed automatically. The Complete dialog preselects this too.

Only the board's owner changes these.

## The backlog view

With sprints on, the view toggle gains a **Backlog** view (`g` then `p`). It
lists every card as a row, grouped into sections: the running sprint first,
then each planned sprint, then the **Backlog** of cards in no sprint, and at
the bottom the completed sprints, folded.

Drag a row from one section to another to plan or unplan it, or drag within a
section to rank it. The backlog and the board share **one order**: ranking a
card above another here moves it above that card in its column too, and the
other way round.

There are other ways to file a card, all of which work outside the backlog:

- The **Sprint** row in a card's details.
- `s` on a focused card opens the sprint picker.
- Select several cards and use the **Sprint** button on the bulk bar.

Cards in a **Done** or **Canceled** list that are in no sprint are left out of
the Backlog section — finished work is not planning material — but they still
count in the sprint they finished in.

## Planning a sprint

Press **+ New sprint** on the Backlog section's header. A sprint has a name
(blank shows as "Sprint 4", numbered per board), a goal, and dates. The dates
are optional while it is planned; the duration chips fill them in from the
board's sprint length.

Each sprint section's header shows its dates, its goal, and its progress:

    12 / 30 pts · 6 days left

Progress is in **points** when the cards carry estimates and in cards when
they do not. Points count as done when the card reaches a Done or Canceled
list; archived cards are left out of both halves.

**Edit** renames or re-dates a planned sprint; the **⋯** menu moves it among
the planned ones or deletes it. Deleting a sprint sends its cards back to the
backlog — they are never deleted with it.

## Starting a sprint

Press **Start sprint** on a planned sprint's header, or pick **Start…** from
the scope pill on the board. The dialog confirms the name, goal and dates —
required from here on — and states the commitment: how many cards and points
the sprint starts with. That commitment is remembered, so a sprint that grew
mid-flight still reports what the team originally signed up for.

Only one sprint runs at a time; Start is offered only while none is running.

## The board during a sprint

While a sprint runs, the board shows **only its cards** — the way Jira's
active-sprint board does — and a pill in the header names it:

    Sprint 3 · 6 days left · 12/30 pts

Open the pill to see **All cards** instead, the **Backlog** alone, or any
planned sprint. The board remembers "active" or "all" between visits; a
specific sprint or the backlog is for the moment. The table, timeline and
calendar follow the same scope, and the timeline draws each sprint as a band
over its dates.

A board with sprints on but none running shows every card.

## Completing a sprint

Press **Complete sprint** on the running sprint's header, or **Complete…**
from the pill. The dialog counts what is done and what is not, and asks where
the unfinished cards go:

- **The next sprint** — the first planned one.
- **A new sprint** — planned for you, dated from the day after this one ends.
- **The backlog** — unfiled, to be planned again later.

Finished cards stay in the sprint they finished in; that is its record. Each
rolled card's history reads "moved this from Sprint 3 to Sprint 4", once,
attributed to whoever completed the sprint.

A sprint with nothing unfinished asks no question.

## Notifications and rules

Every member of the board is told when a sprint **starts** or **completes**,
by whoever did it — or plainly "Sprint 3 started" when it started on its own.
Turn these off under **Sprint starts and completes** in your notification
settings.

[Rules](help://boards:rules) can react to sprints:

- **A card's sprint changes** fires when a card joins or leaves a sprint — pair
  it with **Move the card** to pull work into your first column the moment it
  is planned.
- **A sprint starts** and **A sprint completes** fire on the sprint itself.
- The actions **Move the card to a sprint**, **Move the card to the backlog**
  and **Move the card into the active sprint** file cards for you. The last
  does nothing between sprints rather than failing.

## Reports

Press the chart button on a started sprint's header to open its report. It
draws from a snapshot the server takes every day the sprint runs (and one
at its start and its completion):

- **Burndown** — what was left each day, against the straight line from the
  commitment to zero on the last day. A day with no snapshot leaves a gap
  rather than a guess.
- **Progress** — the sprint's scope and its finished work over the same
  days, so scope that grew mid-sprint is visible as the line it moved.

The **Completed** block at the bottom of the backlog opens with a
**velocity** chart: for each of the last six completed sprints, what it
committed to beside what it finished, and the average finished as a line —
the number to plan the next sprint against. Both charts read in points when
the sprint had estimates and in cards otherwise.

## Finding sprint work elsewhere

- The board filter has a **Sprints** section: the active sprint, any sprint by
  name, or **No sprint**.
- Sort by **Sprint** puts the active sprint first, then the planned ones, then
  cards in none.
- [My cards](help://boards:my-cards) can group by sprint: active, planned, no
  sprint, closed.
- The calendar's **Sprint dates** source marks each sprint's first and last day.

## Command line

```
tinycld boards sprint list "Product launch"
tinycld boards sprint create --board "Product launch" --name "Hardening" --start 2026-10-01 --end 2026-10-14
tinycld boards sprint start next --board "Product launch"
tinycld boards sprint complete active --board "Product launch" --unfinished next
tinycld boards card edit PL-12 --sprint active
tinycld boards view "Product launch" --sprint active
```

A sprint is named by its number within a board, by `active` or `next`, or by
id — never by name. See [Command line](help://boards:command-line).

## Shortcuts

| Key | Does |
|---|---|
| `g` `p` | Open the backlog view |
| `s` | Set the focused card's sprint |
