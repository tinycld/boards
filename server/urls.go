package boards

import (
	"strings"

	"github.com/pocketbase/pocketbase/core"

	"tinycld.org/core/approutes"
)

// The URLs this package's notifications link to.
//
// One file, because the shape is a rule rather than string formatting and it
// had already been written twice with two different answers: a card mention
// linked to "/boards?focused=<id>" and a sprint notice to "/boards" — both
// missing approutes.Prefix, and both relying on the server's legacy-path
// redirect to survive.
//
// The client twin is boards/tinycld/boards/lib/board-route.ts (boardPath,
// peekParams). Keep the two in step; there is no fixture holding them
// together, the same bargain search.go's formatCardKey already makes.

// appBase returns the deployment's origin with any trailing slash removed.
func appBase(app core.App) string {
	return strings.TrimRight(app.Settings().Meta.AppURL, "/")
}

// cardURL deep-links to a card on its board, with the card open in the peek —
// "/a/boards/PL-12". The peek rather than the full page because a notification
// should land the reader on the board, which is the view carrying context.
//
// A card with no key — its board has no slug, or the server has not numbered
// it — is spelled "/a/boards/<board>?focused=<id>", which is also the shape
// core's own mention notifications use. Falls back to the package root rather
// than ever returning a URL that will not resolve.
func cardURL(app core.App, cardID string) string {
	card, err := app.FindRecordById("boards_cards", cardID)
	if err != nil {
		return packageURL(app)
	}
	project, err := app.FindRecordById("boards_projects", card.GetString("project"))
	if err != nil {
		return packageURL(app)
	}
	if key := formatCardKey(project.GetString("slug"), card.GetInt("number")); key != "" {
		return appBase(app) + approutes.Href("boards/"+key)
	}
	return boardURL(app, project) + "?focused=" + card.Id
}

// boardURL links to a board — "/a/boards/PL".
func boardURL(app core.App, project *core.Record) string {
	return appBase(app) + approutes.Href("boards/"+boardSegment(project))
}

// boardSegment is a board's canonical URL segment: its slug, or its record id
// for a board created without one. An id has no hyphen, so the client's
// parseCardKey reads it back as a board rather than a card.
func boardSegment(project *core.Record) string {
	if slug := project.GetString("slug"); slug != "" {
		return slug
	}
	return project.Id
}

// packageURL links to the boards package with no board named. The client's
// index route redirects from there to the reader's last board.
func packageURL(app core.App) string {
	return appBase(app) + approutes.Href("boards")
}

// sprintBoardURL links a sprint notice to the board the sprint belongs to.
//
// There is no per-sprint route to deep-link to, so this is the closest thing —
// and it is closer than it used to be: the URL was the bare package root, which
// landed the reader on whichever board they had open last rather than the one
// the notice was about. The board is in the URL now, so it can say which.
func sprintBoardURL(app core.App, sprint *core.Record) string {
	project, err := app.FindRecordById("boards_projects", sprint.GetString("project"))
	if err != nil {
		return packageURL(app)
	}
	return boardURL(app, project)
}
