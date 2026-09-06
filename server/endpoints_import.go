package boards

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"

	"github.com/pocketbase/pocketbase/core"
)

// Importing a board from a file.
//
// Two formats in, one writer. A Trello export is parsed into the same shape
// endpoints_export.go emits (import_trello.go), so the writing half below never
// learns what a Trello board looks like — which is what will let a second
// source be added without touching it.
//
// An import always CREATES a board, owned by the caller. Importing into an
// existing board would have to answer questions this has no way to ask — merge
// or replace, what happens to a list that exists in both — and a fresh board is
// what someone migrating actually wants. Deleting an unwanted import is one
// action; unpicking a bad merge is not.
//
// SECURITY: like the export, this is a RAW route, so the collection rules do
// not run. The authorization it restates is smaller than the export's, because
// the board does not exist yet: any enabled, non-guest user may create one. The
// guest half is the part that matters — boards_projects' create rule carries
// notGuest precisely so a share-link visitor cannot mint a board, and a raw
// route that skipped it would hand them the whole package.

// maxImportBytes caps an uploaded export. A Trello board with years of comments
// runs to a few megabytes; the cap exists so a hostile upload cannot be
// streamed into memory unbounded. Larger than contacts' 10 MiB because a board
// carries its whole action log.
const maxImportBytes = 25 << 20 // 25 MiB

type importResult struct {
	Project        string `json:"project"`
	Name           string `json:"name"`
	Lists          int    `json:"lists"`
	Cards          int    `json:"cards"`
	Labels         int    `json:"labels"`
	ChecklistItems int    `json:"checklist_items"`
	Comments       int    `json:"comments"`
	// ArchivedCards is how many of Cards arrived already archived, so a count
	// that does not match what the source board looked like is explained.
	ArchivedCards int `json:"archived_cards"`
	// DroppedAssignees names the people whose assignments could not travel —
	// the "say what it did" contract endpoints_move_card.go set.
	DroppedAssignees []string `json:"dropped_assignees,omitempty"`
	// GuessedCategories names each list whose status was inferred from what it
	// is called, so a wrong guess is visible rather than silent.
	GuessedCategories map[string]string `json:"guessed_categories,omitempty"`
	Failed            int               `json:"failed"`
	Errors            []string          `json:"errors,omitempty"`
}

func bindImportRoutes(e *core.ServeEvent) {
	e.Router.POST("/api/boards/import", func(re *core.RequestEvent) error {
		return handleBoardImport(e.App, re)
	}).BindFunc(requireEnabledAuth)
}

func handleBoardImport(app core.App, re *core.RequestEvent) error {
	// A guest reaches the app only through a share link. boards_projects'
	// create rule refuses them a board; this route bypasses that rule, so it
	// refuses them here.
	if re.Auth.GetString("role") == "guest" {
		return re.ForbiddenError("a guest cannot create a board", nil)
	}

	body, opts, err := readImportBody(re)
	if err != nil {
		return re.BadRequestError(err.Error(), nil)
	}

	board, report, err := parseImportFile(body)
	if err != nil {
		return re.BadRequestError(err.Error(), nil)
	}
	if opts.Name != "" {
		board.Name = opts.Name
	}

	result, err := writeImportedBoard(app, re.Auth.Id, board, report, opts)
	if err != nil {
		return re.InternalServerError(err.Error(), err)
	}
	return re.JSON(http.StatusOK, result)
}

// parseImportFile sniffs which format arrived.
//
// Trello's export is identified by a `lists` array whose entries carry an
// `idBoard`/`pos` — but the cheaper and more honest test is our own format's
// shape: a board this server exported names its lists with a `category` and its
// cards with a `list`. Anything else is tried as Trello, whose parser reports
// its own failure if it is neither.
func parseImportFile(raw []byte) (exportedBoard, importReport, error) {
	var probe struct {
		Lists []struct {
			Category *string `json:"category"`
		} `json:"lists"`
	}
	if err := json.Unmarshal(raw, &probe); err != nil {
		return exportedBoard{}, importReport{}, errors.New("this file is not valid JSON")
	}
	for _, l := range probe.Lists {
		if l.Category != nil {
			var board exportedBoard
			if err := json.Unmarshal(raw, &board); err != nil {
				return exportedBoard{}, importReport{}, fmt.Errorf("not a readable board export: %w", err)
			}
			return board, importReport{GuessedCategories: map[string]string{}}, nil
		}
	}
	return parseTrelloBoard(raw)
}

type importOptions struct {
	// Name overrides the board's own name, so two imports of the same export
	// do not produce two boards called the same thing.
	Name string
	// Hooks asks for the per-card history and notifications an ordinary create
	// would fire. Off by default: a 500-card import would otherwise write 500
	// activity rows and evaluate 500 notifications, which is noise in both
	// directions. See import_quiet.go.
	Hooks bool
}

// readImportBody pulls the file out of either a multipart upload (the CLI and
// the browser both post a file) or a raw request body, and reads the options
// that ride alongside it.
//
// Multipart values are read from re.Request.MultipartForm.Value rather than
// FormValue, following calendar's ics_endpoints.go: on a multipart request
// FormValue also consults the URL query and can disturb the body reader that
// FormFile is about to use, which corrupted the uploaded document there.
func readImportBody(re *core.RequestEvent) ([]byte, importOptions, error) {
	opts := importOptions{
		Name:  strings.TrimSpace(re.Request.URL.Query().Get("name")),
		Hooks: re.Request.URL.Query().Get("hooks") == "true",
	}
	limited := http.MaxBytesReader(re.Response, re.Request.Body, maxImportBytes)

	if strings.HasPrefix(re.Request.Header.Get("Content-Type"), "multipart/form-data") {
		if err := re.Request.ParseMultipartForm(maxImportBytes); err != nil {
			return nil, opts, fmt.Errorf("invalid multipart upload: %w", err)
		}
		if values := re.Request.MultipartForm.Value["name"]; len(values) > 0 {
			opts.Name = strings.TrimSpace(values[0])
		}
		if values := re.Request.MultipartForm.Value["hooks"]; len(values) > 0 {
			opts.Hooks = values[0] == "true"
		}
		file, _, err := re.Request.FormFile("file")
		if err != nil {
			return nil, opts, errors.New("missing 'file' upload field")
		}
		defer file.Close()

		body, err := io.ReadAll(io.LimitReader(file, maxImportBytes))
		if err != nil {
			return nil, opts, fmt.Errorf("failed to read upload: %w", err)
		}
		return body, opts, nil
	}

	body, err := io.ReadAll(limited)
	if err != nil {
		return nil, opts, fmt.Errorf("failed to read request body: %w", err)
	}
	if len(body) == 0 {
		return nil, opts, errors.New("empty request body")
	}
	return body, opts, nil
}
