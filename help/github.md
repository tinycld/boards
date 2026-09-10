---
title: GitHub pull requests
summary: Attaching a repository so pull requests show up on cards
tags: [github, pull request, pr, integration, repository, webhook]
order: 40
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

You can also link a pull request to a card manually from the card itself if
it was not picked up automatically.

## Setting up the webhook

The settings screen shows this deployment's webhook URL:
`{{server-host}}/api/webhooks/github`. An administrator adds this URL to the
GitHub App's webhook settings so pull request activity reaches this
deployment.
