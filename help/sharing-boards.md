---
title: Sharing boards
summary: Adding people to a board, sharing it with a link, and what each role can do
tags: [cards, sharing, members, roles, permissions, "share link"]
order: 30
---

## Who can see a board

A board is visible only to its members. Each member has a role that decides
what they can do:

- **Owner** — full control: everything an editor can do, plus renaming or
  archiving the board and managing its members.
- **Editor** — add, edit, move and delete lists and cards, and comment.
- **Commentor** — read everything and join the discussion (including editing
  their own comments), but not change cards.
- **Viewer** — read everything, change nothing.

Controls you don't have simply aren't shown: a viewer sees no card composer or
drag handles, and a commentor keeps only the comment box. On boards you can't
edit, a small badge next to the board name shows your role, so a board without
those controls is labeled rather than looking broken.

## Opening the member list

Click the row of member avatars in the board header. Every member can open it
to see who is on the board; owners also get the management controls below.

## Adding people

To share a board, open the member list and choose **Add people** (owners
only). Search for a person by name or email, pick the role they should have,
and press **Add**. They see the board immediately.

## Changing a role or removing someone

In the member list, an owner can change any member's role with the dropdown
beside their name, or remove them with the **✕** at the end of the row.
Removing someone takes effect immediately, and they can always be added back.

## Leaving a board

Your own row in the member list has a **Leave** action. Leaving removes your
access — someone on the board has to add you again if you change your mind.

## Sharing a board with a link

Adding people works when they already have an account here. To share a board
with someone who doesn't, an owner can create a link.

Open the member list and find **General access** at the bottom. Choose what
the link should allow and when it should expire, then press **Create link**
and copy the URL. It looks like this:

    {{server-host}}/p/cards/board/1f4c…

What each kind of link allows:

- **Viewer** — anyone with the link reads the board straight away. No account,
  nothing to fill in, and they can't change anything.
- **Commentor** — the board opens read-only with a **Sign in to comment**
  button.
- **Editor** — the same, with **Sign in to edit**.

Signing in asks for an email address and sends back a six-digit code — there's
no password to create. Once the code is accepted, that person joins the board
at the link's role and it opens normally, with everything that role can do.

## What someone who joins by link can see

They see the board: its lists, cards, descriptions, comments, labels and
attachments. **Anyone with the link can download the files attached to the
board**, so treat a link the way you'd treat the files themselves.

They do **not** see the member list, and they never see anyone's email
address. Cards assigned to people show a plain avatar rather than a name. They
can't create boards of their own, and they can't reach any other board here.

## Expiring and revoking a link

A new link expires after **7 days** unless you choose 30 days, 90 days or
never when you create it. **General access** shows the expiry date, and
**Revoke** switches the link off.

Revoking takes effect immediately — the next person to open the link is told
it's no longer available, and whether that's because it was switched off or
because it reached its expiry date.

**Revoking does not remove people who already signed in.** Once someone has
joined, they hold a real place on the board's member list, and the link has
nothing more to do with their access. Remove them there, the same way you'd
remove anyone else.

## A board always keeps at least one owner

The last owner of a board cannot be demoted or removed — not even by
themselves. To hand a board off, first make another member an owner, then
change or remove your own row.
