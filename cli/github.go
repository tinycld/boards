package cli

import (
	"context"
	"fmt"
	"net/url"
	"regexp"
	"strconv"

	"github.com/spf13/cobra"

	"tinycld.org/cli/client"
	"tinycld.org/cli/output"
)

// GitHub linkage on the command line: which repositories a board watches
// (read-only), and which pull requests a card carries (read/write by URL).
//
// boards_project_repos is registered READ-ONLY for OAuth callers in
// server/oauth_scopes.go — deliberately, and not because the access rules are
// weak. A row there points a GitHub credential at source code, which is
// categorically larger than editing cards, and "boards:write" reads on a
// consent screen as "change my cards", not "connect my repositories". So
// there is deliberately no `github attach` or `github detach` command here —
// adding one means widening that grant first, which is a security decision
// rather than a CLI one. Attaching stays in the app, where the Board settings
// screen shows exactly which board a credential is being pointed at.

const projectReposCollection = "boards_project_repos"

// projectRepo is one row of boards_project_repos — a repository a board
// watches for PR activity.
type projectRepo struct {
	ID             string `json:"id"`
	Project        string `json:"project"`
	Repo           string `json:"repo"`
	InstallationID string `json:"installation_id"`
	Created        string `json:"created"`
}

func newGitHubCmd(c *client.Client) *cobra.Command {
	cmd := &cobra.Command{
		Use:   "github",
		Short: "GitHub repositories attached to a board",
	}
	cmd.AddCommand(newGitHubListCmd(c))
	return cmd
}

// newGitHubListCmd lists the repositories a board watches. Read-only, the
// same as the underlying collection's OAuth grant — see the file header.
func newGitHubListCmd(c *client.Client) *cobra.Command {
	cmd := &cobra.Command{
		Use:   "list <board>",
		Short: "List the repositories attached to a board",
		Args:  cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			o, _, err := output.FromCommand(cmd)
			if err != nil {
				return err
			}
			ctx := cmd.Context()
			p, err := resolveProject(ctx, c, args[0])
			if err != nil {
				return err
			}
			repos, err := client.ListAll[projectRepo](ctx, c, projectReposCollection,
				client.Filter("project = {:p}", map[string]any{"p": p.ID}), "repo")
			if err != nil {
				return err
			}
			rows := make([][]string, 0, len(repos))
			for _, r := range repos {
				rows = append(rows, []string{r.Repo, r.ID})
			}
			return o.Write(cmd.OutOrStdout(), []string{"REPO", "ID"}, rows, repos)
		},
	}
	return cmd
}

// prLinksCollection is boards_pr_links — a PR's association with a card.
const prLinksCollection = "boards_pr_links"

// prLink is one stored row.
type prLink struct {
	ID          string `json:"id"`
	Card        string `json:"card"`
	Project     string `json:"project"`
	Repo        string `json:"repo"`
	Number      int    `json:"number"`
	URL         string `json:"url"`
	Title       string `json:"title"`
	Author      string `json:"author"`
	State       string `json:"state"`
	ReviewState string `json:"review_state"`
	// How the link was made — see unlinkPr below for why this decides
	// delete-vs-tombstone.
	LinkSource string `json:"link_source"`
	Unlinked   bool   `json:"unlinked"`
}

// githubHost is the ONLY hostname a PR URL may carry, matched exactly against
// url.URL.Hostname() — never a regex or substring test on the raw string. A
// pattern loose enough to accept the real URL also accepts a path-prefix
// spoof (https://evil.example/github.com/o/r/pull/1) or a lookalike
// subdomain (https://github.com.evil.example/o/r/pull/1); Hostname() cannot
// be fooled either way. Mirrors tinycld/boards/lib/parse-pr-url.ts exactly.
const githubHost = "github.com"
const githubWWWHost = "www.github.com"

var prNumberPattern = regexp.MustCompile(`^[1-9][0-9]*$`)

// parsePrURL mirrors lib/parse-pr-url.ts's parsePrUrl. See that file's
// comment for the spoofing shapes this guards against.
func parsePrURL(raw string) (repo string, number int, ok bool) {
	u, err := url.Parse(raw)
	if err != nil {
		return "", 0, false
	}
	if u.Hostname() != githubHost && u.Hostname() != githubWWWHost {
		return "", 0, false
	}
	parts := pathSegments(u.Path)
	// owner / repo / "pull" / number, plus an optional sub-path (/files,
	// /commits, …).
	if len(parts) < 4 || parts[2] != "pull" {
		return "", 0, false
	}
	if !prNumberPattern.MatchString(parts[3]) {
		return "", 0, false
	}
	n, err := strconv.Atoi(parts[3])
	if err != nil {
		return "", 0, false
	}
	return parts[0] + "/" + parts[1], n, true
}

// pathSegments splits a URL path the way parsed.pathname.split('/').filter
// (Boolean) does in the TS twin: empty segments (a leading, trailing or
// doubled slash) are dropped rather than counted.
func pathSegments(path string) []string {
	var out []string
	start := 0
	for i := 0; i <= len(path); i++ {
		if i == len(path) || path[i] == '/' {
			if i > start {
				out = append(out, path[start:i])
			}
			start = i + 1
		}
	}
	return out
}

func newCardLinkPrCmd(c *client.Client) *cobra.Command {
	cmd := &cobra.Command{
		Use:   "link-pr <key> <url>",
		Short: "Link a pull request to a card by URL",
		Long: "Link a pull request to a card by URL.\n\n" +
			"<key> is a card id or key (see `tinycld boards view`). <url> is a\n" +
			"GitHub pull request URL, e.g. https://github.com/owner/repo/pull/42.",
		Args: cobra.ExactArgs(2),
		RunE: func(cmd *cobra.Command, args []string) error {
			o, _, err := output.FromCommand(cmd)
			if err != nil {
				return err
			}
			repo, number, ok := parsePrURL(args[1])
			if !ok {
				return fmt.Errorf("%q is not a GitHub pull request URL "+
					"(expected https://github.com/<owner>/<repo>/pull/<number>)", args[1])
			}
			ctx := cmd.Context()
			cd, err := getCard(ctx, c, args[0])
			if err != nil {
				return err
			}

			created, err := client.CreateRecord[prLink](ctx, c, prLinksCollection, map[string]any{
				"card":    cd.ID,
				"project": cd.Project,
				"repo":    repo,
				"number":  number,
				"url":     args[1],
				// Unknown until the next webhook delivery resolves them from
				// GitHub — the same zero-value convention useLinkPr uses.
				"title":       "",
				"author":      "",
				"state":       "open",
				"link_source": "manual",
				"unlinked":    false,
			})
			if err != nil {
				return err
			}
			o.Info(cmd.ErrOrStderr(), "linked %s#%d to %q", repo, number, cd.Title)
			return o.Write(cmd.OutOrStdout(),
				[]string{"ID", "Repo", "Number", "URL"},
				[][]string{{created.ID, created.Repo, strconv.Itoa(created.Number), created.URL}},
				created)
		},
	}
	return cmd
}

func newCardUnlinkPrCmd(c *client.Client) *cobra.Command {
	cmd := &cobra.Command{
		Use:   "unlink-pr <key> <url>",
		Short: "Remove a pull request link from a card",
		Long: "Remove a pull request link from a card.\n\n" +
			"<key> is a card id or key. <url> identifies the link the same way\n" +
			"`link-pr` matched it: by repo and PR number, not the literal string.",
		Args: cobra.ExactArgs(2),
		RunE: func(cmd *cobra.Command, args []string) error {
			o, _, err := output.FromCommand(cmd)
			if err != nil {
				return err
			}
			repo, number, ok := parsePrURL(args[1])
			if !ok {
				return fmt.Errorf("%q is not a GitHub pull request URL "+
					"(expected https://github.com/<owner>/<repo>/pull/<number>)", args[1])
			}
			ctx := cmd.Context()
			cd, err := getCard(ctx, c, args[0])
			if err != nil {
				return err
			}

			link, err := findPrLink(ctx, c, cd.ID, repo, number)
			if err != nil {
				return err
			}
			if err := unlinkPr(ctx, c, link); err != nil {
				return err
			}
			o.Info(cmd.ErrOrStderr(), "unlinked %s#%d from %q", repo, number, cd.Title)
			return nil
		},
	}
	return cmd
}

// findPrLink locates the (repo, number, card) row link-pr created — the
// collection's own unique index (pb-migrations/1980000021), so there is at
// most one. A tombstoned row (unlinked = true) still counts as found: the
// caller asked to unlink this PR, and reporting "not linked" for a link that
// is merely tombstoned would be confusing, not helpful.
func findPrLink(ctx context.Context, c *client.Client, cardID, repo string, number int) (prLink, error) {
	links, err := client.ListAll[prLink](ctx, c, prLinksCollection,
		client.Filter("card = {:c} && repo = {:r} && number = {:n}",
			map[string]any{"c": cardID, "r": repo, "n": number}), "")
	if err != nil {
		return prLink{}, err
	}
	if len(links) == 0 {
		return prLink{}, fmt.Errorf("%s#%d is not linked to that card", repo, number)
	}
	return links[0], nil
}

// unlinkPr applies the same delete-vs-tombstone rule the app follows
// (usePrLinkMutations.ts's useUnlinkPr): a MANUAL link is deleted outright — a
// person added it, a person removes it, nothing recreates it. A DERIVED link
// (branch/title/body) is tombstoned instead, because branch-name linkage is
// re-derived from immutable branch state on every webhook delivery — deleting
// it would only bring it back on the next push. The row's own link_source
// decides which, so the CLI and the UI can never disagree about one link.
func unlinkPr(ctx context.Context, c *client.Client, link prLink) error {
	if link.LinkSource == "manual" {
		return client.DeleteRecord(ctx, c, prLinksCollection, link.ID)
	}
	_, err := client.UpdateRecord[prLink](ctx, c, prLinksCollection, link.ID,
		map[string]any{"unlinked": true})
	return err
}
