// Package cli contributes the `tinycld cards` command group. Commands are
// pure HTTP clients over the PocketBase record REST API — cards has no bespoke
// CRUD endpoint, and deliberately should not grow one: the access rules are
// the whole authorization for every caller that does not pass through a hook,
// so a Go endpoint could only ADD to what the rules already enforce.
//
// Two things a reader should know before extending this package:
//
//   - RANKS ARE COMPUTED HERE. `position` is a fractional index and there is
//     no endpoint that hands one out, so rank.go ports the same algorithm the
//     app uses. Its golden vectors are the guard against divergence; see the
//     comment there before touching it.
//   - THE SHARING SURFACE IS READ-ONLY. cards_project_members and
//     cards_share_links are registered read-only for OAuth callers in core's
//     scope table, so there are deliberately no `cards share` commands. Adding
//     one means widening that grant first, which is a security decision rather
//     than a CLI one.
package cli

import (
	"github.com/spf13/cobra"

	"tinycld.org/cli/client"
)

func Register(root *cobra.Command, c *client.Client) {
	cards := &cobra.Command{
		Use:   "cards",
		Short: "Kanban boards: track work across lists",
	}
	cards.AddCommand(
		newBoardCmd(c),
		newListCmd(c),
		newCardCmd(c),
	)
	root.AddCommand(cards)
}
