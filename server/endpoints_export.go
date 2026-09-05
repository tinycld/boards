package boards

import (
	"encoding/csv"
	"encoding/json"
	"fmt"
	"net/http"
	"regexp"
	"strconv"
	"strings"

	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"
)

// Exporting a whole board as a FILE, in two formats for two different jobs.
//
// CSV is the flat projection — one row per card, multi-values joined — which is
// what a spreadsheet, a report or a status meeting wants. JSON is the complete
// board, including the children a CSV row cannot hold (checklist items,
// comments, links), and is the format endpoints_import.go reads back. The split
// is the CLI's own, at cli/card.go's writeCardResult: "JSON gets the whole card
// with its children nested; table and CSV get the field list, which is what a
// CSV consumer can actually parse."
//
// SECURITY: this is a RAW route. PocketBase evaluates collection rules for
// /api/collections/... and for NOTHING bound on e.Router, so the shipped boards
// rules — the membership resolution through boards_project_members, and the
// `@request.auth.disabled != true` clause every one of them carries — do not
// run here. Both are restated below by hand:
//
//   - membership via loadReadableProject, which also keeps the 404-vs-403
//     discipline the other boards endpoints use
//   - the suspension check via requireEnabledAuth, NOT the package's own
//     requireAuth, which tests only for the presence of an auth record
//
// Drop either and a token reads a board it has no membership on.
//
// The whole board goes out, deliberately unfiltered. The board filter is
// session-only client state with no wire format (stores/boards-ui-store.ts keeps
// it out of `partialize` on purpose), so honouring it here would mean a second
// implementation of lib/board-filter.ts's predicate in Go — a copy that can
// drift silently, which is the failure mode the three rank implementations are
// documented to guard against.

const (
	exportFormatCSV  = "csv"
	exportFormatJSON = "json"
)

// The JSON shapes. Field names are the PocketBase column names rather than the
// client's camelCase view model, so the file reads as what it is — a dump of
// the board's rows — and the importer needs no second vocabulary.
type exportedBoard struct {
	Name            string             `json:"name"`
	Slug            string             `json:"slug"`
	Color           string             `json:"color"`
	AutoArchiveDays int                `json:"auto_archive_days,omitempty"`
	Labels          []exportedLabel    `json:"labels"`
	Epics           []exportedEpic     `json:"epics,omitempty"`
	Lists           []exportedList     `json:"lists"`
	Cards           []exportedCard     `json:"cards"`
	Links           []exportedCardLink `json:"links,omitempty"`
}

type exportedLabel struct {
	ID    string `json:"id"`
	Name  string `json:"name"`
	Color string `json:"color"`
}

type exportedEpic struct {
	ID          string `json:"id"`
	Title       string `json:"title"`
	Description string `json:"description,omitempty"`
	Color       string `json:"color,omitempty"`
	Position    string `json:"position,omitempty"`
	Archived    bool   `json:"archived,omitempty"`
}

type exportedList struct {
	ID       string `json:"id"`
	Name     string `json:"name"`
	Position string `json:"position"`
	Category string `json:"category"`
}

type exportedCard struct {
	ID          string `json:"id"`
	Key         string `json:"key,omitempty"`
	Number      int    `json:"number,omitempty"`
	List        string `json:"list"`
	Position    string `json:"position"`
	Title       string `json:"title"`
	Description string `json:"description,omitempty"`
	// Both dates are self-describing, per activity.go's dueText: a day-only
	// deadline is a bare YYYY-MM-DD, a timed one an RFC 3339 instant. A reader
	// tells them apart by shape and never needs the flag beside them — which
	// is also what makes a re-import safe when due_has_time is absent.
	Start     string                  `json:"start,omitempty"`
	Due       string                  `json:"due,omitempty"`
	Priority  string                  `json:"priority,omitempty"`
	Estimate  int                     `json:"estimate,omitempty"`
	Labels    []string                `json:"labels,omitempty"`
	Assignees []string                `json:"assignees,omitempty"`
	Reporter  string                  `json:"reporter,omitempty"`
	Epic      string                  `json:"epic,omitempty"`
	Parent    string                  `json:"parent,omitempty"`
	Archived  bool                    `json:"archived,omitempty"`
	Checklist []exportedChecklistItem `json:"checklist,omitempty"`
	Comments  []exportedComment       `json:"comments,omitempty"`
}

type exportedChecklistItem struct {
	Title    string `json:"title"`
	IsDone   bool   `json:"is_done"`
	Position string `json:"position"`
}

type exportedComment struct {
	Author  string `json:"author"`
	Body    string `json:"body"`
	Created string `json:"created"`
	Parent  string `json:"parent,omitempty"`
}

type exportedCardLink struct {
	Source string `json:"source"`
	Target string `json:"target"`
	Type   string `json:"type"`
}

func bindExportRoutes(e *core.ServeEvent) {
	e.Router.GET("/api/boards/export", func(re *core.RequestEvent) error {
		return handleBoardExport(e.App, re)
	}).BindFunc(requireEnabledAuth)
}

// requireEnabledAuth rejects an anonymous caller and a suspended one.
//
// The package's own requireAuth (register.go) checks only for an auth record,
// which is enough for the routes that go on to re-authorize against a board.
// The suspension half is the part that is easy to miss: coreserver's guard
// blocks token ISSUANCE, not use, so a token minted before an account was
// disabled keeps working until it expires. For REST the collection rules close
// that (every boards rule carries `@request.auth.disabled != true`); a raw
// route has no rule engine, so it re-checks the flag on the live record here.
//
// Lifted verbatim from contacts/server/vcard_endpoints.go, which documents the
// same reasoning for the same shape of route.
func requireEnabledAuth(re *core.RequestEvent) error {
	if re.Auth == nil {
		return re.UnauthorizedError("Authentication required", nil)
	}
	if re.Auth.GetBool("disabled") {
		return re.ForbiddenError("Account is disabled", nil)
	}
	return re.Next()
}

// loadReadableProject answers the authorization an export makes: the caller is
// a MEMBER of the board. Any role may export — a viewer reads every card
// through the ordinary REST already, so refusing them a file would protect
// nothing.
//
// Keeps the 404-vs-403 discipline of endpoints_sprints.go, with one
// simplification: since every role passes, there is no 403 case at all. A
// non-member cannot tell a board id from a fictional one.
func loadReadableProject(app core.App, re *core.RequestEvent, projectID string) (*core.Record, error) {
	project, err := app.FindRecordById("boards_projects", projectID)
	if err != nil {
		return nil, re.NotFoundError("board not found", nil)
	}
	if re.Auth.IsSuperuser() {
		return project, nil
	}
	member, err := app.CountRecords("boards_project_members",
		dbx.HashExp{"project": project.Id, "user": re.Auth.Id})
	if err != nil || member == 0 {
		return nil, re.NotFoundError("board not found", nil)
	}
	return project, nil
}

func handleBoardExport(app core.App, re *core.RequestEvent) error {
	projectID := strings.TrimSpace(re.Request.URL.Query().Get("project"))
	if projectID == "" {
		return re.BadRequestError("a board id is required (?project=<id>)", nil)
	}
	format := strings.TrimSpace(re.Request.URL.Query().Get("format"))
	if format == "" {
		format = exportFormatCSV
	}
	if format != exportFormatCSV && format != exportFormatJSON {
		return re.BadRequestError("format must be csv or json", nil)
	}

	project, err := loadReadableProject(app, re, projectID)
	if err != nil {
		return err
	}

	board, err := collectBoard(app, project)
	if err != nil {
		return re.InternalServerError("failed to read the board", err)
	}

	filename := exportFilename(project, format)
	re.Response.Header().Set("Content-Disposition",
		fmt.Sprintf(`attachment; filename=%q`, filename))

	if format == exportFormatJSON {
		re.Response.Header().Set("Content-Type", "application/json; charset=utf-8")
		body, err := json.MarshalIndent(board, "", "  ")
		if err != nil {
			return re.InternalServerError("failed to encode the board", err)
		}
		return re.String(http.StatusOK, string(body))
	}

	re.Response.Header().Set("Content-Type", "text/csv; charset=utf-8")
	body, err := boardToCSV(board)
	if err != nil {
		return re.InternalServerError("failed to encode the board", err)
	}
	return re.String(http.StatusOK, body)
}

// csvHeaders is the flat projection, in the order a reader scans: what the card
// IS, then where it sits, then who and when.
//
// `archived` is here because the export doubles as a backup, and a file that
// silently dropped the archive would misrepresent the board to anyone reading
// it as one.
var csvHeaders = []string{
	"key", "title", "description", "list", "status",
	"priority", "estimate", "labels", "assignees", "reporter",
	"epic", "parent", "start", "due", "archived",
}

func boardToCSV(board exportedBoard) (string, error) {
	listNames := make(map[string]string, len(board.Lists))
	listCategories := make(map[string]string, len(board.Lists))
	for _, l := range board.Lists {
		listNames[l.ID] = l.Name
		listCategories[l.ID] = l.Category
	}
	labelNames := make(map[string]string, len(board.Labels))
	for _, l := range board.Labels {
		labelNames[l.ID] = l.Name
	}
	epicTitles := make(map[string]string, len(board.Epics))
	for _, e := range board.Epics {
		epicTitles[e.ID] = e.Title
	}
	// A parent is quoted by its KEY, the way a person refers to it. A card on a
	// board with no slug has no key, so it falls back to the raw id rather than
	// exporting an empty cell that reads as "no parent".
	cardKeys := make(map[string]string, len(board.Cards))
	for _, c := range board.Cards {
		if c.Key != "" {
			cardKeys[c.ID] = c.Key
		} else {
			cardKeys[c.ID] = c.ID
		}
	}

	var out strings.Builder
	w := csv.NewWriter(&out)
	if err := w.Write(csvHeaders); err != nil {
		return "", err
	}
	for _, c := range board.Cards {
		estimate := ""
		if c.Estimate > 0 {
			estimate = strconv.Itoa(c.Estimate)
		}
		parent := ""
		if c.Parent != "" {
			parent = cardKeys[c.Parent]
		}
		row := []string{
			c.Key,
			c.Title,
			c.Description,
			listNames[c.List],
			listCategories[c.List],
			c.Priority,
			estimate,
			joinCell(namesFor(c.Labels, labelNames)),
			joinCell(c.Assignees),
			c.Reporter,
			epicTitles[c.Epic],
			parent,
			c.Start,
			c.Due,
			strconv.FormatBool(c.Archived),
		}
		if err := w.Write(row); err != nil {
			return "", err
		}
	}
	w.Flush()
	if err := w.Error(); err != nil {
		return "", err
	}
	return out.String(), nil
}

// joinCell packs a multi-value column into one CSV cell.
//
// "; " rather than "," so the cell does not have to be quoted to survive, and
// so a reader splitting on commas — which is what someone does to a CSV cell
// before they think about it — does not silently tear one value into two.
func joinCell(values []string) string {
	return strings.Join(values, "; ")
}

func namesFor(ids []string, names map[string]string) []string {
	out := make([]string, 0, len(ids))
	for _, id := range ids {
		if name, ok := names[id]; ok {
			out = append(out, name)
		}
	}
	return out
}

// unsafeFilenameChars is everything that is not plainly safe in a filename on
// the three platforms this lands on. A board is named by a person, so it can
// carry a slash, a quote, or a newline — all of which either break the header
// or escape the directory.
var unsafeFilenameChars = regexp.MustCompile(`[^A-Za-z0-9._-]+`)

func exportFilename(project *core.Record, format string) string {
	stem := project.GetString("slug")
	if stem == "" {
		stem = project.GetString("name")
	}
	// Trimmed of dots as well as dashes: a board named "../../etc/passwd" has
	// no slash left by this point, so there is no traversal to worry about, but
	// it would still land as "..-..-etc-passwd.csv" — and a leading dot makes a
	// file hidden on Unix, which is a poor thing to hand someone as a download.
	stem = strings.Trim(unsafeFilenameChars.ReplaceAllString(stem, "-"), "-.")
	if stem == "" {
		stem = "board"
	}
	return fmt.Sprintf("%s.%s", strings.ToLower(stem), format)
}
