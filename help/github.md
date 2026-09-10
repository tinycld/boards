---
title: GitHub pull requests
summary: Attaching a repository so pull requests show up on cards
tags: [github, pull request, pr, integration, repository, webhook]
order: 42
---

## Attaching a repository

Open **Settings → Boards → GitHub** and add the repository's owner and name
(for example `octocat` / `hello-world`). Only a board's owner can attach or
remove a repository — everyone else sees the list read-only.

There is no separate on/off switch. A board's GitHub integration is active as
soon as one repository is attached, and turns itself off again once every
repository has been removed.

## How pull requests get linked to cards

Once a repository is attached, a pull request links to a card automatically
when its branch name, title, or description contains the card's key (for
example `OTTER-123`). The card then shows the pull request's state — open,
merged, or closed — and its review status.

A card can have more than one linked pull request, and it only moves once
**every** open one has merged — not the first. A card whose work spans two
repositories is not finished when just one of them lands, so the card stays
put until the last linked pull request merges too.

Writing `skip OTTER-123` or `ignore OTTER-123` in a pull request's
**description** stops that key from linking, even if the same key appears in
the branch name or title. A branch name is usually fixed once it's pushed, so
the description is the only place left to say "not this card" — useful when a
branch happens to contain a key by accident.

### Linking a pull request by hand

Open a card and choose **Link pull request…**, then paste its GitHub URL
(`https://github.com/owner/repo/pull/42`). This covers a pull request whose
branch was named before the card existed, or whose repository doesn't follow
a key-in-the-branch convention.

### Unlinking a pull request

Remove the link from the card at any time. What happens next depends on how
the link was made: a link you added by hand is simply gone. A link that was
found automatically from the branch name, title, or description will **not**
come back on the next push — removing it is permanent, even though the branch
still names the card. To relink it, add it back by hand or use `skip`/`ignore`
to prevent the wrong link from recurring in the first place.

## Automating with rules

Four triggers become available once a repository is attached: a linked pull
request opens, all linked pull requests merge, a linked pull request is up
for review, and a linked pull request is approved. Pair any of them with
**Move the card to a list** to, for example, move a card to Done the moment
its last pull request merges. See [Board rules](help://boards:rules) for
every trigger and action.

## The command line

`tinycld boards github list` shows the repositories attached to a board, and
`tinycld boards card link-pr` / `unlink-pr` link and unlink a pull request by
URL. There is no command to attach or remove a repository — that stays in the
app deliberately: attaching a repository points a credential at source code,
which is a bigger grant than editing cards, so it's kept in Board settings
where it's visible rather than handed to a token. See
[Boards from the command line](help://boards:command-line).

## Setting up the webhook

The settings screen shows this deployment's webhook URL:
`{{server-host}}/api/webhooks/github`. An administrator adds this URL to the
GitHub App's webhook settings so pull request activity reaches this
deployment.
