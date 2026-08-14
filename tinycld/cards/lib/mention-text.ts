// Rendering `[[@<userId>]]` tokens as readable names.
//
// The token is the WIRE format — it is what `parseMentions` reads on both
// sides (the client when writing comment_mentions rows, cards' Go flush hook
// when deriving description mentions), and it survives a display name changing
// or a person being removed. It is not what anyone should have to read.
//
// Substitution happens BEFORE markdown parsing rather than as a renderer node,
// because the body is rendered by core's shared MarkdownRenderer and a custom
// node type would have to be threaded through it on both platforms. Rewriting
// the source keeps this a pure string transform — trivially testable, and
// identical on web and native.
//
// Consequence worth knowing: a token inside a fenced code block is rewritten
// too. Accepted deliberately — someone pasting `[[@id]]` into a code fence in a
// card description is vanishingly rare next to the everyday case, and the
// alternative (a markdown-aware walk) buys correctness nobody will observe at a
// cost everybody pays. If that ever stops being true, the fix is a renderer
// node, not a smarter regex.

// The brackets may arrive BACKSLASH-ESCAPED. The rich editor serializes to
// markdown, where `[` is syntax, so a token typed by the mention picker is
// stored as `\[\[@id\]\]` rather than `[[@id]]`. Both spellings mean the same
// mention and both must parse — matching only the bare form left raw tokens
// visible in every posted comment (caught by card-mentions.spec.ts).
const TOKEN = /\\?\[\\?\[@([A-Za-z0-9_-]+)(?:\|([^\]|]*))?\\?\]\\?\]/g

/** Minimal shape needed to render a mention. */
export interface MentionName {
    userId: string
    label: string
}

/**
 * Replace every `[[@id]]` / `[[@id|Name]]` with `@Name`.
 *
 * The roster wins when it knows the id — it is live, so a rename shows up
 * without rewriting stored text. The name carried by the token is the fallback,
 * which is what keeps a mention readable after someone leaves the board:
 * leaving does not un-say the sentence that named them. `@someone` remains only
 * for a legacy token that carries no name and names nobody on the roster.
 */
export function renderMentionTokens(body: string, names: MentionName[]): string {
    // Guard on `[@` rather than `[[@`: the escaped spelling puts a backslash
    // BETWEEN the brackets (`\[\[@id\]\]`), so a `[[@` fast-path skips every
    // escaped token and returns the body untouched — which is exactly how raw
    // tokens reached the screen before card-mentions.spec.ts caught it.
    if (!body || body.indexOf('[@') === -1) return body
    const byId = new Map(names.map(n => [n.userId, n.label]))
    return body.replace(TOKEN, (_match, userId: string, storedName?: string) => {
        const label = byId.get(userId) || decodeMentionName(storedName)
        return label ? `@${label}` : '@someone'
    })
}

/**
 * Decode the name half of a token.
 *
 * `]` and `|` are percent-encoded by the writer (they would end the token
 * early); `%25` is decoded last so a literal `%5D` someone typed into their own
 * name cannot turn into a bracket. Mirrors unescapeMentionName in core's
 * mention-node.ts.
 */
function decodeMentionName(raw: string | undefined): string {
    if (!raw) return ''
    return raw.replace(/%5D/gi, ']').replace(/%7C/gi, '|').replace(/%25/gi, '%')
}

/** A `comment_mentions` row, as cards writes it. */
export interface CardMentionRow {
    comment_collection: string
    comment_record: string
    drive_item: string
    mentioned_user: string
    target_collection: string
    target_record: string
}

/**
 * The mention rows a new comment should write.
 *
 * Pure so the rules that matter are testable without a store: who gets a row,
 * who does not, and what each row points at.
 *
 * The target is the CARD, not the comment — a mention is about the card you are
 * being called to, and that is what the deep-link opens. `drive_item` is '',
 * which is exactly what core's generalization (migration 1985000002) made
 * representable.
 */
export function buildCommentMentionRows(args: {
    body: string
    commentId: string
    cardId: string
    /** Skipped: notifying yourself is noise. */
    authorId: string
}): CardMentionRow[] {
    return mentionedUserIds(args.body)
        .filter(userId => userId !== args.authorId)
        .map(userId => ({
            comment_collection: 'cards_comments',
            comment_record: args.commentId,
            drive_item: '',
            mentioned_user: userId,
            target_collection: 'cards_cards',
            target_record: args.cardId,
        }))
}

/** The user ids mentioned in a body, deduped, in order of first appearance. */
export function mentionedUserIds(body: string): string[] {
    const seen = new Set<string>()
    const out: string[] = []
    for (const match of body.matchAll(TOKEN)) {
        const id = match[1]
        if (!id || seen.has(id)) continue
        seen.add(id)
        out.push(id)
    }
    return out
}
