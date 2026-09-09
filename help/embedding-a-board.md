---
title: Embedding a board in a website
summary: Show a board inside another page, choose which sites may do it, and decide whether it updates live
tags: [cards, embed, iframe, website, sharing, "share link"]
order: 32
---

## What embedding does

An embedded board appears inside another page — an intranet home page, a team
wiki, a status dashboard — as the board itself rather than a screenshot of one.
It shows the same lists and cards everyone else sees, and it updates when you
choose to let it.

It is always **read-only**. Nobody can move a card, edit a title or leave a
comment from an embedded board, whoever they are and however they signed in.
Embedding shows a board; it never hands out a way to change one.

## Creating an embeddable link

Embedding rides on an ordinary share link, so start there. Open the member list,
find **General access**, and fill in **Embed on a website** before you press
**Create link**.

Type the address of each site allowed to show the board, including the `https://`
part:

    https://intranet.example.com

To allow more than one site, separate them with a space. **Leave the box empty
and the board can't be embedded anywhere** — which is how every link starts, so
a link you already created is not embeddable and never becomes so on its own.

Once the link exists, **Embed code** copies the snippet to paste into your page:

    <iframe src="{{server-host}}/p/boards/1f4c…?embed=1"
            width="100%" height="600" style="border:0" title="Board"></iframe>

Adjust the width and height to suit the page. The `?embed=1` on the end is what
strips our own heading and sign-in button so only the board shows — leave it in
place, or the page it's embedded on will refuse to display it.

## Choosing the sites carefully

The list of sites is the whole protection. A browser is told to show the board
only inside a page served from one of those addresses, and to refuse everywhere
else.

Name the sites you actually intend to use, and no others. Each address covers
exactly that host — `https://example.com` does not cover
`https://intranet.example.com`, so list both if you need both.

## Keeping an embedded board up to date

**Keep an embedded board up to date** decides whether the board changes as
people work on it, or shows how it stood when the page was opened.

It's **off** by default. Leaving it off is the right choice for most pages: the
board is accurate for whoever opens the page and costs nothing to leave sitting
there. Turn it on when people watch the page for a while and expect it to move
— a wallboard, or a dashboard on a screen in the room.

This holds a connection open for every visitor to the page it is embedded on
and will be unstable if used on high-traffic sites. Turn it on for a page a
handful of people keep open, not one that many people pass through.

Card descriptions always show their saved text, whether this is on or off.

## What people see

Anyone who can open the page can see the board, without signing in and without
an account. That is the same reach as the share link itself — see
[Sharing boards](help://boards:sharing-boards) for exactly what a link holder
can and cannot see, including that **attached files can be downloaded**.

Treat embedding a board on a public page as publishing it.

## Turning embedding off

**Revoke** on the link switches off the embed along with the link, immediately.
The next time anyone loads the page, the board is gone from it.

To stop the board appearing on one site while keeping the link working
elsewhere, create a new link with the sites you want and revoke the old one.
The same applies to a link that has reached its expiry date — an expired link
stops being embeddable at the moment it stops working.
