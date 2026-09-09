package cli

import (
	"context"
	"fmt"
	"sort"
	"strings"
	"unicode"

	"github.com/spf13/cobra"

	"tinycld.org/cli/client"
	"tinycld.org/cli/output"
)

// Comment reactions on the command line: react, unreact, and the counts shown
// beside each comment in `card view`.
//
// Any emoji the deployment stores is allowed — the app's picker offers ~1650.
// This file does NOT carry that vocabulary: it belongs to
// @tinycld/core/lib/emoji, the server enforces it (server/reaction_emoji.go),
// and a second copy here would be one more thing to drift. The CLI sends what
// the caller typed and reports what the server says.
//
// What IS here is a short list of ASCII names, because a terminal is exactly
// where pasting an emoji is awkward. It is a convenience, not the vocabulary.
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

// reactionNames are typeable shorthands for the emoji people reach for most.
// The six that used to be the whole palette are kept verbatim so existing
// muscle memory and scripts keep working; the rest are the obvious additions.
// Anything not listed can still be used by pasting the emoji itself.
var reactionNames = map[string]string{
	"thumbs_up":   "👍",
	"thumbs_down": "👎",
	"heart":       "❤️",
	"laugh":       "😄",
	"party":       "🎉",
	"eyes":        "👀",
	"rocket":      "🚀",
	"fire":        "🔥",
	"clap":        "👏",
	"thinking":    "🤔",
	"check":       "✅",
	"cross":       "❌",
}

// shorthandList renders the names in a stable order for help and error text.
func shorthandList() string {
	names := make([]string, 0, len(reactionNames))
	for name := range reactionNames {
		names = append(names, name)
	}
	sort.Strings(names)
	return strings.Join(names, ", ")
}

// resolveEmoji expands a shorthand, or passes an emoji through untouched.
//
// It does NOT validate: the server owns the vocabulary, and listing ~1650
// emoji is not an error message. A shorthand that is not in the map is
// therefore assumed to BE an emoji and sent as-is — if it is not one, the
// server says so, which is the honest place for that answer. The one thing
// worth catching here is plain ASCII, which is never an emoji and is almost
// certainly a misremembered shorthand.
func resolveEmoji(raw string) (string, error) {
	if emoji, ok := reactionNames[strings.ToLower(raw)]; ok {
		return emoji, nil
	}
	if isPlainASCII(raw) {
		return "", fmt.Errorf(
			"unknown reaction %q; use an emoji, or one of: %s", raw, shorthandList())
	}
	return raw, nil
}

// isPlainASCII reports whether s is entirely printable ASCII — a word, not an
// emoji. Used only to give a better error than the server's.
func isPlainASCII(s string) bool {
	for _, r := range s {
		if r > unicode.MaxASCII {
			return false
		}
	}
	return true
}

// emojiName is the reverse of reactionNames, for error text and rendering.
// An emoji with no shorthand renders as itself.
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
			"<emoji> is the emoji itself, or one of these shorthands:\n" +
			shorthandList() + ".\n\n" +
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
// Count descending, then the emoji itself for ties — the same rule
// groupReactions uses for the bar in the app, so the CLI and the UI order a
// given set identically. There is no palette order to use any more, and
// map iteration order would differ between runs. A comment with none yields
// "", and the caller omits the cell rather than printing an empty one.
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

	emojis := make([]string, 0, len(counts))
	for emoji := range counts {
		emojis = append(emojis, emoji)
	}
	sort.Slice(emojis, func(i, j int) bool {
		if counts[emojis[i]] != counts[emojis[j]] {
			return counts[emojis[i]] > counts[emojis[j]]
		}
		return emojis[i] < emojis[j]
	})

	parts := make([]string, 0, len(emojis))
	for _, emoji := range emojis {
		parts = append(parts, fmt.Sprintf("%s %d", emoji, counts[emoji]))
	}
	return strings.Join(parts, "  ")
}
