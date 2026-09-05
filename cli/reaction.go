package cli

import (
	"context"
	"fmt"
	"sort"
	"strings"

	"github.com/spf13/cobra"

	"tinycld.org/cli/client"
	"tinycld.org/cli/output"
)

// Comment reactions on the command line: react, unreact, and the counts shown
// beside each comment in `card view`.
//
// The palette is FIXED by the schema (pb-migrations/1980000013), which stores
// `emoji` as a select rather than free text — partly for the reason priority
// is, and partly because the unique index compares BYTES, so two spellings of
// the same emoji (with and without the variation selector) would defeat it.
// This file mirrors lib/reactions.ts, which owns the same palette and order
// for the app; the two must agree.
//
// A row is (comment, user, emoji) and is toggled by insert and delete, never
// edited — so `unreact` deletes rather than patching, and re-reacting the same
// way is a no-op the unique index enforces.

const reactionsCollection = "boards_comment_reactions"

// reaction is one stored row.
type reaction struct {
	ID      string `json:"id"`
	Project string `json:"project"`
	Card    string `json:"card"`
	Comment string `json:"comment"`
	User    string `json:"user"`
	Emoji   string `json:"emoji"`
}

// reactionPalette is the stored vocabulary, in the order the bar renders.
// Mirrors REACTION_PALETTE in lib/reactions.ts.
var reactionPalette = []string{"👍", "❤️", "😄", "🎉", "👀", "🚀"}

// reactionNames are the ASCII names a terminal caller types, so the commands
// work without pasting an emoji into a shell. Mirrors REACTION_KEYS.
var reactionNames = map[string]string{
	"thumbs_up": "👍",
	"heart":     "❤️",
	"laugh":     "😄",
	"party":     "🎉",
	"eyes":      "👀",
	"rocket":    "🚀",
}

// resolveEmoji accepts either the emoji itself or its ASCII name.
//
// Both, because a terminal is exactly where pasting an emoji is awkward — but
// someone copying from the app will paste one, and refusing that would be
// gratuitous. An unknown value lists the palette rather than saying only "no":
// the set is closed and short, so showing it is the whole answer.
func resolveEmoji(raw string) (string, error) {
	if emoji, ok := reactionNames[strings.ToLower(raw)]; ok {
		return emoji, nil
	}
	for _, emoji := range reactionPalette {
		if raw == emoji {
			return emoji, nil
		}
	}
	names := make([]string, 0, len(reactionPalette))
	for _, emoji := range reactionPalette {
		names = append(names, fmt.Sprintf("%s %s", emoji, emojiName(emoji)))
	}
	return "", fmt.Errorf("unknown reaction %q; choose one of: %s",
		raw, strings.Join(names, ", "))
}

// emojiName is the reverse of reactionNames, for error text and rendering.
func emojiName(emoji string) string {
	for name, e := range reactionNames {
		if e == emoji {
			return name
		}
	}
	return emoji
}

func newCommentReactCmd(c *client.Client) *cobra.Command {
	cmd := &cobra.Command{
		Use:   "react <comment-id> <emoji>",
		Short: "React to a comment",
		Long: "React to a comment.\n\n" +
			"<emoji> is one of the six the board allows, given either as the\n" +
			"emoji itself or by name: thumbs_up, heart, laugh, party, eyes,\n" +
			"rocket.\n\n" +
			"Comment ids come from `tinycld boards card view --json`.",
		Args: cobra.ExactArgs(2),
		RunE: func(cmd *cobra.Command, args []string) error {
			o, _, err := output.FromCommand(cmd)
			if err != nil {
				return err
			}
			emoji, err := resolveEmoji(args[1])
			if err != nil {
				return err
			}
			ctx := cmd.Context()
			userID, err := c.UserID(ctx)
			if err != nil {
				return err
			}
			// The reaction row denormalizes card and project so the open card
			// reads its reactions in one query (see the migration). Both come
			// from the comment, which is the only thing the caller named.
			cm, err := client.GetRecord[comment](ctx, c, commentsCollection, args[0])
			if err != nil {
				return err
			}
			cd, err := client.GetRecord[card](ctx, c, cardsCollection, cm.Card)
			if err != nil {
				return err
			}

			created, err := client.CreateRecord[reaction](ctx, c, reactionsCollection,
				map[string]any{
					"project": cd.Project,
					"card":    cd.ID,
					"comment": cm.ID,
					"user":    userID,
					"emoji":   emoji,
				})
			if err != nil {
				return err
			}
			o.Info(cmd.ErrOrStderr(), "reacted %s to %q", emoji, firstLine(cm.Body))
			return o.Write(cmd.OutOrStdout(),
				[]string{"ID", "Comment", "Emoji"},
				[][]string{{created.ID, created.Comment, created.Emoji}},
				created)
		},
	}
	return cmd
}

func newCommentUnreactCmd(c *client.Client) *cobra.Command {
	cmd := &cobra.Command{
		Use:   "unreact <comment-id> <emoji>",
		Short: "Take back your reaction to a comment",
		Long: "Take back your reaction to a comment.\n\n" +
			"Removes only YOUR reaction — the rules allow no one to remove\n" +
			"anyone else's.",
		Args: cobra.ExactArgs(2),
		RunE: func(cmd *cobra.Command, args []string) error {
			o, _, err := output.FromCommand(cmd)
			if err != nil {
				return err
			}
			emoji, err := resolveEmoji(args[1])
			if err != nil {
				return err
			}
			ctx := cmd.Context()
			userID, err := c.UserID(ctx)
			if err != nil {
				return err
			}
			// Filtered by user as well as comment and emoji. The rules would
			// refuse someone else's row anyway, but asking for it by id and
			// being refused reports a permission error where the truthful
			// answer is "you have not reacted that way".
			rows, err := client.ListAll[reaction](ctx, c, reactionsCollection,
				client.Filter("comment = {:c} && user = {:u} && emoji = {:e}",
					map[string]any{"c": args[0], "u": userID, "e": emoji}), "")
			if err != nil {
				return err
			}
			if len(rows) == 0 {
				return fmt.Errorf("you have not reacted %s to that comment", emoji)
			}
			for _, row := range rows {
				if err := client.DeleteRecord(ctx, c, reactionsCollection, row.ID); err != nil {
					return err
				}
			}
			o.Info(cmd.ErrOrStderr(), "removed %s", emoji)
			return nil
		},
	}
	return cmd
}

// cardReactions reads every reaction on a card, for `card view`.
//
// By CARD rather than per comment: the row carries `card` precisely so one
// query serves the whole thread, which is the same reason the app's card
// detail reads them that way.
func cardReactions(ctx context.Context, c *client.Client, cardID string) ([]reaction, error) {
	return client.ListAll[reaction](ctx, c, reactionsCollection,
		client.Filter("card = {:c}", map[string]any{"c": cardID}), "created")
}

// reactionSummary renders one comment's reactions as "👍 2  🎉 1".
//
// Palette order, not arrival order, so the same set always reads the same way
// — the reason lib/reactions.ts fixes an order at all. A comment with none
// yields "", and the caller omits the cell rather than printing an empty one.
func reactionSummary(rows []reaction, commentID string) string {
	counts := map[string]int{}
	for _, row := range rows {
		if row.Comment == commentID {
			counts[row.Emoji]++
		}
	}
	if len(counts) == 0 {
		return ""
	}
	parts := []string{}
	for _, emoji := range reactionPalette {
		if n := counts[emoji]; n > 0 {
			parts = append(parts, fmt.Sprintf("%s %d", emoji, n))
			delete(counts, emoji)
		}
	}
	// Anything left is outside the palette, which a schema edit is the only
	// way to produce. Rendered rather than dropped — a count that vanishes is
	// worse than one that looks unfamiliar — after the known ones and sorted,
	// so the output stays stable across runs.
	rest := []string{}
	for emoji, n := range counts {
		rest = append(rest, fmt.Sprintf("%s %d", emoji, n))
	}
	sort.Strings(rest)
	return strings.Join(append(parts, rest...), "  ")
}
