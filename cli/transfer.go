package cli

import (
	"fmt"
	"io"
	"net/url"
	"os"

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
