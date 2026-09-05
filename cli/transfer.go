package cli

import (
	"fmt"
	"io"
	"net/url"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"

	"github.com/spf13/cobra"

	"tinycld.org/cli/client"
	"tinycld.org/cli/output"
	"tinycld.org/cli/ui"
)

// transfer.go holds the commands that move a whole board as a FILE.
//
// Unlike the rest of this package they call a typed route rather than the
// record API, and they have to: an export is a projection over six collections
// with names resolved and ranks ordered, which a client assembling it from
// record reads would have to reimplement — and would get subtly wrong the first
// time a rank tied. The server owns that shape in server/endpoints_export.go
// and these commands only move bytes.
//
// contacts/cli/transfer.go is the same file for the same reason; this follows
// its shape deliberately.

func newBoardExportCmd(c *client.Client) *cobra.Command {
	var format string
	var out string
	cmd := &cobra.Command{
		Use:   "export <board>",
		Short: "Export a board as CSV or JSON",
		Long: "Export a board as CSV or JSON.\n\n" +
			"<board> is a board id or name. Writes to stdout unless --out is given.\n\n" +
			"CSV is one row per card with the multi-value columns joined — what a\n" +
			"spreadsheet wants. JSON is the whole board, including the checklist\n" +
			"items, comments and links a CSV row cannot hold, and is the format\n" +
			"`boards import` reads back.\n\n" +
			"Archived cards are included and flagged, because an export doubles as\n" +
			"a backup.",
		Args: cobra.ExactArgs(1),
		Example: "  tinycld boards export OTTER --out board.csv\n" +
			"  tinycld boards export OTTER --format json > board.json",
		RunE: func(cmd *cobra.Command, args []string) error {
			o, yes, err := output.FromCommand(cmd)
			if err != nil {
				return err
			}
			if format != "csv" && format != "json" {
				return fmt.Errorf("--format supports csv and json, got %q", format)
			}
			ctx := cmd.Context()
			p, err := resolveProject(ctx, c, args[0])
			if err != nil {
				return err
			}

			// Streamed, not buffered: a board is unbounded, and the endpoint
			// already hands back a finished document.
			query := url.Values{"project": {p.ID}, "format": {format}}
			body, _, err := c.Get(ctx, "/api/boards/export?"+query.Encode())
			if err != nil {
				return err
			}
			defer body.Close()

			if out == "" {
				_, err := io.Copy(cmd.OutOrStdout(), body)
				return err
			}

			if err := ui.ConfirmOverwrite(o, yes, cmd.InOrStdin(), cmd.OutOrStdout(), out); err != nil {
				return err
			}
			file, err := os.Create(out)
			if err != nil {
				return err
			}
			// Closed explicitly rather than only deferred: a write error that
			// surfaces at Close would otherwise be swallowed, reporting a
			// truncated export as a success.
			if _, err := io.Copy(file, body); err != nil {
				file.Close()
				return err
			}
			if err := file.Close(); err != nil {
				return err
			}
			o.Info(cmd.ErrOrStderr(), "saved %s", out)
			return nil
		},
	}
	cmd.Flags().StringVar(&format, "format", "csv", "export format (csv or json)")
	cmd.Flags().StringVar(&out, "out", "", "write to this file instead of stdout")
	return cmd
}

// importResult mirrors server/endpoints_import.go's importResult. Duplicated
// because the CLI is a separate module that deliberately does not depend on the
// server's; only the fields this command reports are declared.
type importResult struct {
	Project           string            `json:"project"`
	Name              string            `json:"name"`
	Lists             int               `json:"lists"`
	Cards             int               `json:"cards"`
	Labels            int               `json:"labels"`
	ChecklistItems    int               `json:"checklist_items"`
	Comments          int               `json:"comments"`
	ArchivedCards     int               `json:"archived_cards"`
	DroppedAssignees  []string          `json:"dropped_assignees,omitempty"`
	GuessedCategories map[string]string `json:"guessed_categories,omitempty"`
	Failed            int               `json:"failed"`
	Errors            []string          `json:"errors,omitempty"`
}

func newBoardImportCmd(c *client.Client) *cobra.Command {
	var name string
	var hooks bool
	cmd := &cobra.Command{
		Use:   "import <file.json>",
		Short: "Create a board from a Trello export or a board export",
		Long: "Create a board from a Trello export or a board export.\n\n" +
			"The format is detected from the file. An import always creates a NEW\n" +
			"board that you own; it never merges into an existing one.\n\n" +
			"Trello member ids mean nothing here, so cards import unassigned and the\n" +
			"people who were assigned are reported. Trello has no status categories,\n" +
			"so each column's is guessed from its name and the guesses are reported.\n\n" +
			"By default the import writes no card history and sends no notifications:\n" +
			"a few hundred cards arriving at once is not news. Pass --hooks to treat\n" +
			"every imported card as if it had just been created.",
		Args:    cobra.ExactArgs(1),
		Example: "  tinycld boards import trello.json --name \"Product launch\"",
		RunE: func(cmd *cobra.Command, args []string) error {
			o, _, err := output.FromCommand(cmd)
			if err != nil {
				return err
			}
			// Checked before the upload so a typo'd path fails immediately with
			// a filesystem error rather than as a server-side 400.
			if _, err := os.Stat(args[0]); err != nil {
				return err
			}

			query := url.Values{}
			if name != "" {
				query.Set("name", name)
			}
			if hooks {
				query.Set("hooks", "true")
			}
			path := "/api/boards/import"
			if encoded := query.Encode(); encoded != "" {
				path += "?" + encoded
			}

			result, err := client.PostMultipart[importResult](cmd.Context(), c,
				path, "", nil,
				[]client.FilePart{{Field: "file", Name: filepath.Base(args[0]), Path: args[0]}}, nil)
			if err != nil {
				return err
			}

			w := cmd.ErrOrStderr()
			o.Info(w, "imported %q: %d lists, %d cards, %d labels, %d checklist items, %d comments",
				result.Name, result.Lists, result.Cards, result.Labels,
				result.ChecklistItems, result.Comments)
			if result.ArchivedCards > 0 {
				o.Info(w, "%d of those cards arrived archived", result.ArchivedCards)
			}

			// The rest is NOT routed through Info: a partially-applied import,
			// a dropped assignee and a guessed column are exactly what --quiet
			// must not hide. A count alone would let someone believe a file
			// imported cleanly when part of it did not.
			if len(result.DroppedAssignees) > 0 {
				fmt.Fprintf(w, "assignees could not be carried over: %s\n",
					strings.Join(result.DroppedAssignees, ", "))
			}
			if len(result.GuessedCategories) > 0 {
				fmt.Fprintf(w, "column statuses were guessed from their names:\n")
				for _, listName := range sortedKeys(result.GuessedCategories) {
					fmt.Fprintf(w, "  %s → %s\n", listName, result.GuessedCategories[listName])
				}
			}
			if len(result.Errors) > 0 {
				fmt.Fprintf(w, "%d item(s) skipped:\n  %s\n",
					len(result.Errors), strings.Join(result.Errors, "\n  "))
			}
			return writeImportResult(cmd, o, result)
		},
	}
	cmd.Flags().StringVar(&name, "name", "", "name the new board something other than the file's")
	cmd.Flags().BoolVar(&hooks, "hooks", false, "write card history and send notifications for every imported card")
	return cmd
}

// writeImportResult emits the record for a machine format. A table run prints
// nothing — the chatter above already said what happened — but `-o csv` and
// `-o json` must still emit it, the contract writeCardResult documents.
func writeImportResult(cmd *cobra.Command, o output.Options, r importResult) error {
	switch o.Format {
	case output.Table:
		return nil
	case output.CSV:
		return o.Write(cmd.OutOrStdout(),
			[]string{"PROJECT", "NAME", "LISTS", "CARDS", "LABELS", "FAILED"},
			[][]string{{
				r.Project, r.Name,
				strconv.Itoa(r.Lists), strconv.Itoa(r.Cards),
				strconv.Itoa(r.Labels), strconv.Itoa(r.Failed),
			}}, r)
	default:
		return o.Write(cmd.OutOrStdout(), nil, nil, r)
	}
}

func sortedKeys(m map[string]string) []string {
	keys := make([]string, 0, len(m))
	for k := range m {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	return keys
}
