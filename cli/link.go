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

// Card links on the command line: file one, remove one, and render the set on
// `card view`.
//
// A link is stored ONCE and read from both ends (pb-migrations/1980000016), so
// `A blocks B` is the same row whether you ask A or B. What differs is the
// label — "Blocks" from the source, "Blocked by" from the target. This mirrors
// lib/card-links.ts, which owns the same vocabulary for the app; the two must
// agree, so the labels here are the same strings.
//
// THE REDACTION RULE is the reason this file is careful. Links MAY cross
// boards, and read is either end — so a caller can hold a link row whose far
// card sits on a board they cannot read. That far card must render AS
// REDACTED, never omitted: a blocked card that prints as unblocked is exactly
// the failure the anonymous-assignee doctrine exists to prevent.

const linksCollection = "boards_card_links"

// cardLink is one stored row. Source and target are card ids; which of them is
// "the other card" depends on which end you are reading from.
type cardLink struct {
	ID     string `json:"id"`
	Source string `json:"source"`
	Target string `json:"target"`
	Type   string `json:"type"`
}

// linkLabels mirrors LINK_LABELS in lib/card-links.ts. `blocks` is the only
// directional type, and it is why a row is stored once rather than mirrored:
// "blocked by" is not a fourth type, it is `blocks` seen from the other side.
var linkLabels = map[string]struct{ fromSource, fromTarget string }{
	"blocks":     {"Blocks", "Blocked by"},
	"related":    {"Related to", "Related to"},
	"duplicates": {"Duplicates", "Duplicated by"},
}

// linkTypes is the stored vocabulary, in the order `card view` groups by.
var linkTypes = []string{"blocks", "related", "duplicates"}

func newCardLinkCmd(c *client.Client) *cobra.Command {
	var asBlocks, asRelated, asDuplicates bool
	cmd := &cobra.Command{
		Use:   "link <id> <other>",
		Short: "Link two cards (--blocks, --related or --duplicates)",
		Long: "Link two cards.\n\n" +
			"<id> and <other> are card ids or keys (see `tinycld boards view`).\n" +
			"The link is stored once and reads from both ends: `A --blocks B`\n" +
			"shows as \"Blocks\" on A and \"Blocked by\" on B.\n\n" +
			"Cards MAY be on different boards. Filing one needs write access to\n" +
			"<id>'s board and membership of <other>'s.",
		Args: cobra.ExactArgs(2),
		RunE: func(cmd *cobra.Command, args []string) error {
			o, _, err := output.FromCommand(cmd)
			if err != nil {
				return err
			}
			linkType, err := chosenLinkType(asBlocks, asRelated, asDuplicates)
			if err != nil {
				return err
			}
			ctx := cmd.Context()
			source, err := getCard(ctx, c, args[0])
			if err != nil {
				return err
			}
			// Resolved the same way, so either end may be given as a key. A
			// far card on a board the caller cannot READ fails here, which is
			// the right error: they cannot link to what they cannot see, and
			// the server would refuse the write anyway.
			target, err := getCard(ctx, c, args[1])
			if err != nil {
				return err
			}

			created, err := client.CreateRecord[cardLink](ctx, c, linksCollection, map[string]any{
				"source": source.ID,
				"target": target.ID,
				"type":   linkType,
			})
			if err != nil {
				return err
			}
			o.Info(cmd.ErrOrStderr(), "%s %q %s %q",
				"linked", source.Title, linkLabels[linkType].fromSource, target.Title)
			return o.Write(cmd.OutOrStdout(),
				[]string{"ID", "Source", "Target", "Type"},
				[][]string{{created.ID, created.Source, created.Target, created.Type}},
				created)
		},
	}
	cmd.Flags().BoolVar(&asBlocks, "blocks", false, "<id> blocks <other>")
	cmd.Flags().BoolVar(&asRelated, "related", false, "the two are related")
	cmd.Flags().BoolVar(&asDuplicates, "duplicates", false, "<id> duplicates <other>")
	return cmd
}

// chosenLinkType turns the three mutually-exclusive flags into one value.
//
// Exactly one is required rather than defaulting to `related`: the type is the
// whole meaning of the link, and quietly picking one for a caller who forgot
// the flag would file a relationship they did not ask for.
func chosenLinkType(asBlocks, asRelated, asDuplicates bool) (string, error) {
	chosen := []string{}
	if asBlocks {
		chosen = append(chosen, "blocks")
	}
	if asRelated {
		chosen = append(chosen, "related")
	}
	if asDuplicates {
		chosen = append(chosen, "duplicates")
	}
	switch len(chosen) {
	case 1:
		return chosen[0], nil
	case 0:
		return "", fmt.Errorf("choose a link type: --blocks, --related or --duplicates")
	default:
		return "", fmt.Errorf("choose ONE link type, got --%s", strings.Join(chosen, " --"))
	}
}

func newCardUnlinkCmd(c *client.Client) *cobra.Command {
	cmd := &cobra.Command{
		Use:   "unlink <id> <other>",
		Short: "Remove the link between two cards",
		Long: "Remove the link between two cards.\n\n" +
			"Direction does not matter: a link is one row read from both ends,\n" +
			"so `unlink A B` and `unlink B A` remove the same one.",
		Args: cobra.ExactArgs(2),
		RunE: func(cmd *cobra.Command, args []string) error {
			o, _, err := output.FromCommand(cmd)
			if err != nil {
				return err
			}
			ctx := cmd.Context()
			first, err := getCard(ctx, c, args[0])
			if err != nil {
				return err
			}
			second, err := getCard(ctx, c, args[1])
			if err != nil {
				return err
			}

			links, err := linksBetween(ctx, c, first.ID, second.ID)
			if err != nil {
				return err
			}
			if len(links) == 0 {
				return fmt.Errorf("%q and %q are not linked", first.Title, second.Title)
			}
			// Both orientations are fetched and all matches removed. Two cards
			// can carry more than one link — `related` and `duplicates` are
			// symmetric and may legitimately coexist — and leaving one behind
			// after "unlink" reads as the command having failed.
			for _, link := range links {
				if err := client.DeleteRecord(ctx, c, linksCollection, link.ID); err != nil {
					return err
				}
			}
			o.Info(cmd.ErrOrStderr(), "unlinked %q and %q (%d)",
				first.Title, second.Title, len(links))
			return nil
		},
	}
	return cmd
}

// linksBetween finds every link joining two cards, in either direction.
func linksBetween(ctx context.Context, c *client.Client, a, b string) ([]cardLink, error) {
	return client.ListAll[cardLink](ctx, c, linksCollection,
		client.Filter(
			"(source = {:a} && target = {:b}) || (source = {:b} && target = {:a})",
			map[string]any{"a": a, "b": b}),
		"created")
}

// cardLinks reads every link with `cardID` at either end.
//
// Either end, because that is how the rules read: a card is linked whether it
// is the source or the target, and asking only for one direction would hide
// half of them — including every "Blocked by", which is the direction that
// matters most.
func cardLinks(ctx context.Context, c *client.Client, cardID string) ([]cardLink, error) {
	return client.ListAll[cardLink](ctx, c, linksCollection,
		client.Filter("source = {:c} || target = {:c}", map[string]any{"c": cardID}),
		"created")
}

// projectSlugs maps board id → slug for every board a link reaches, so a far
// card can render as its KEY (OTTER-12) rather than a record id.
//
// One list call rather than a lookup per link: a card with eight links to the
// same board would otherwise fetch that board eight times. A board the caller
// cannot read is simply absent from the map, and the far card it holds is
// redacted anyway — so the miss never renders.
func projectSlugs(
	ctx context.Context,
	c *client.Client,
	links []cardLink,
	subject card,
) map[string]string {
	slugs := map[string]string{}
	if len(links) == 0 {
		return slugs
	}
	// visibleProjects returns exactly the caller's boards, which is the set
	// whose cards can resolve at all. An error costs the keys, not the view:
	// a far card then renders by title, which is still true and readable.
	projects, err := visibleProjects(ctx, c)
	if err != nil {
		return slugs
	}
	for _, p := range projects {
		if p.Slug != "" {
			slugs[p.ID] = p.Slug
		}
	}
	// The subject's own board may not be in that list on a share-link read,
	// and a same-board link is the common case.
	if _, ok := slugs[subject.Project]; !ok {
		if p, projErr := resolveProject(ctx, c, subject.Project); projErr == nil && p.Slug != "" {
			slugs[p.ID] = p.Slug
		}
	}
	return slugs
}

// linkRow is one link oriented around the card being viewed.
type linkRow struct {
	// The label for THIS card's end — "Blocks" vs "Blocked by".
	Label string `json:"label"`
	Type  string `json:"type"`
	// The far card's key, its title, or the redaction stand-in.
	Far string `json:"far"`
	// The far card's id, which is readable even when the card is not.
	FarCardID string `json:"far_card_id"`
	// Whether the far card is one this caller may not read. JSON carries it
	// as a field so a script can tell a redacted link from a resolved one
	// without parsing the rendered text.
	Redacted bool `json:"redacted"`
}

// redactedFarCard is what a far card the caller cannot read renders as.
//
// Rendered, never omitted — see the file header. The wording matches the app's
// (DetailLinks.tsx), so a person reading both sees the same thing.
const redactedFarCard = "(a card on another board)"

// orientLinks turns stored rows into rows oriented around one card, resolving
// each far card and REDACTING the ones this caller cannot read.
//
// Mirrors orientLinks + resolveFarCard in lib/card-links.ts, with one
// simplification: the CLI fetches on demand, so there is no `pending` state to
// distinguish — a card that does not resolve here is one the rules withheld.
func orientLinks(
	ctx context.Context,
	c *client.Client,
	links []cardLink,
	cardID string,
	slugs map[string]string,
) []linkRow {
	rows := make([]linkRow, 0, len(links))
	for _, link := range links {
		isSource := link.Source == cardID
		farID := link.Target
		if !isSource {
			farID = link.Source
		}
		labels, known := linkLabels[link.Type]
		label := link.Type
		if known {
			label = labels.fromSource
			if !isSource {
				label = labels.fromTarget
			}
		}

		row := linkRow{Label: label, Type: link.Type, FarCardID: farID}
		// A far card the rules withhold fails this fetch, which is exactly how
		// the redaction is detected — there is no separate permission probe.
		far, err := client.GetRecord[card](ctx, c, cardsCollection, farID)
		if err != nil {
			row.Far = redactedFarCard
			row.Redacted = true
			rows = append(rows, row)
			continue
		}
		row.Far = far.Title
		if key := formatCardKey(slugs[far.Project], far.Number); key != "" {
			row.Far = key + " " + far.Title
		}
		rows = append(rows, row)
	}

	// Grouped by the order `card view` renders: blocks, related, duplicates,
	// each with its source end before its target end.
	order := map[string]int{}
	for i, t := range linkTypes {
		order[linkLabels[t].fromSource] = i * 2
		order[linkLabels[t].fromTarget] = i*2 + 1
	}
	sort.SliceStable(rows, func(i, j int) bool {
		return order[rows[i].Label] < order[rows[j].Label]
	})
	return rows
}

// linkTableRows renders links as `card view` table rows.
//
// Appended to the card's own field table rather than printed as a section of
// its own, which is how that command already renders the checklist and
// comments — one table, the label in the field column. A card with no links
// contributes nothing, as a card with no checklist does.
func linkTableRows(rows []linkRow) [][]string {
	table := make([][]string, 0, len(rows))
	for _, row := range rows {
		table = append(table, []string{row.Label, row.Far})
	}
	return table
}
