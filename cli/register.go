package cli

import (
	"github.com/spf13/cobra"

	"tinycld.org/cli/client"
)

// Register mounts the `tinycld boards` group. Board-level verbs (list, view,
// archive, remove) sit directly on the group; columns and cards are nested
// under `column` and `card` so `boards list` unambiguously lists boards.
func Register(root *cobra.Command, c *client.Client) {
	boards := &cobra.Command{
		Use:   "boards",
		Short: "Kanban boards: track work across columns",
	}
	boards.AddCommand(
		newBoardListCmd(c),
		newBoardViewCmd(c),
		newBoardArchiveCmd(c),
		newBoardRemoveCmd(c),
		newBoardExportCmd(c),
		newBoardImportCmd(c),
		newColumnCmd(c),
		newCardCmd(c),
		newSprintCmd(c),
	)
	root.AddCommand(boards)
}
