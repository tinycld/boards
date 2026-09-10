/**
 * `https://github.com/o/r/pull/42` → `{ repo: 'o/r', number: 42 }`.
 *
 * The escape hatch for a PR no automatic rule matched — a repo whose branch
 * convention we do not control, or a PR opened before the card existed.
 *
 * Parsed with `URL` rather than a regex so the host check is a real host
 * check: a pattern loose enough to accept the real URL also accepts
 * `https://evil.example/github.com/o/r/pull/1`, and a regex anchored on
 * `github\.com` in the string would accept that too, or a lookalike
 * subdomain like `github.com.evil.example`. `URL.hostname` cannot be fooled
 * either way.
 */
export function parsePrUrl(raw: string): { repo: string; number: number } | null {
    let parsed: URL
    try {
        parsed = new URL(raw.trim())
    } catch {
        return null
    }
    if (parsed.hostname !== 'github.com' && parsed.hostname !== 'www.github.com') {
        return null
    }
    const parts = parsed.pathname.split('/').filter(Boolean)
    // owner / repo / "pull" / number, plus an optional sub-path (/files, /commits, …).
    if (parts.length < 4 || parts[2] !== 'pull') {
        return null
    }
    if (!/^[1-9][0-9]*$/.test(parts[3])) {
        return null
    }
    return { repo: `${parts[0]}/${parts[1]}`, number: Number.parseInt(parts[3], 10) }
}
