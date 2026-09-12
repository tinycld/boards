import { PB_SERVER_ADDR } from '@tinycld/core/lib/pocketbase'
import { useThemeColor } from '@tinycld/core/lib/use-app-theme'
import { Menu } from '@tinycld/core/ui/menu'
import * as Clipboard from 'expo-clipboard'
import { Check, ChevronDown, Code, Copy, Globe, Lock, Pencil } from 'lucide-react-native'
import { useState } from 'react'
import { Platform, Pressable, Switch, Text, TextInput, View } from 'react-native'
import { useCopiedFlag } from '../../hooks/useCopiedFlag'
import {
    DEFAULT_SHARE_LINK_EXPIRY_DAYS,
    SHARE_LINK_EXPIRY_OPTIONS,
    type ShareLinkExpiryDays,
    type ShareLinkRow,
    useCreateShareLink,
    useRevokeShareLink,
    useShareLinks,
    useUpdateShareLink,
} from '../../hooks/useShareLinks'
import type { BoardsShareLinkRole } from '../../types'
import { SHARE_LINK_ROLE_OPTIONS } from './roles'

interface ShareLinkSectionProps {
    projectId: string
    /** Owner-only, matching the collection's rules and the endpoints. */
    isVisible: boolean
}

/**
 * General access: mint a link that opens the board without an invitation, see
 * the live one, and revoke it.
 *
 * Owner-only, because the collection's rules are owner-only in all five
 * directions and the endpoints re-check. Hidden rather than disabled for
 * everyone else — an affordance that always refuses is the Filter-button
 * mistake this package already made once.
 */
export function ShareLinkSection({ projectId, isVisible }: ShareLinkSectionProps) {
    const { activeLink } = useShareLinks(projectId)
    const [role, setRole] = useState<BoardsShareLinkRole>('viewer')
    const [expiry, setExpiry] = useState<ShareLinkExpiryDays>(DEFAULT_SHARE_LINK_EXPIRY_DAYS)
    const [embedDomains, setEmbedDomains] = useState('')
    const [embedLive, setEmbedLive] = useState(false)
    const [copied, markCopied] = useCopiedFlag()
    const [embedCopied, markEmbedCopied] = useCopiedFlag()
    const [error, setError] = useState<string | null>(null)

    const createLink = useCreateShareLink(projectId)
    const revokeLink = useRevokeShareLink(projectId)
    const mutedColor = useThemeColor('muted')

    if (!isVisible) return null

    const onCreate = () => {
        setError(null)
        createLink.mutate(
            { role, expiresInDays: expiry, embedDomains, embedLive },
            { onError: err => setError(err.message) }
        )
    }

    const onRevoke = () => {
        setError(null)
        if (!activeLink) return
        revokeLink.mutate(activeLink.id, { onError: err => setError(err.message) })
    }

    const onCopy = async () => {
        if (!activeLink) return
        await Clipboard.setStringAsync(shareLinkURL(activeLink.token))
        markCopied()
    }

    const onCopyEmbed = async () => {
        if (!activeLink) return
        await Clipboard.setStringAsync(embedSnippet(activeLink.token))
        markEmbedCopied()
    }

    return (
        <View className="mt-4 rounded-xl border border-border overflow-hidden">
            <View className="px-3 py-2 border-b border-border">
                <Text className="text-[13px] font-semibold text-foreground">General access</Text>
            </View>

            <View className="px-3 py-3 gap-3">
                <AccessSummary link={activeLink} />

                {activeLink ? (
                    <LiveLink
                        projectId={projectId}
                        link={activeLink}
                        copied={copied}
                        onCopy={onCopy}
                        embedCopied={embedCopied}
                        onCopyEmbed={onCopyEmbed}
                        onRevoke={onRevoke}
                        isRevoking={revokeLink.isPending}
                    />
                ) : (
                    <MintControls
                        role={role}
                        expiry={expiry}
                        onRoleChange={setRole}
                        onExpiryChange={setExpiry}
                        embedDomains={embedDomains}
                        onEmbedDomainsChange={setEmbedDomains}
                        embedLive={embedLive}
                        onEmbedLiveChange={setEmbedLive}
                        onCreate={onCreate}
                        isCreating={createLink.isPending}
                        mutedColor={mutedColor}
                    />
                )}

                <ErrorNote message={error} />
            </View>
        </View>
    )
}

/** The board's current state, in the terms a reader cares about. */
function AccessSummary({ link }: { link: ShareLinkRow | undefined }) {
    const mutedColor = useThemeColor('muted')

    if (!link) {
        return (
            <View className="flex-row items-center gap-2">
                <Lock size={15} color={mutedColor} strokeWidth={2} />
                <Text className="text-[13px] text-muted">
                    Restricted — only people added above can open this board
                </Text>
            </View>
        )
    }

    return (
        <View className="flex-row items-center gap-2">
            <Globe size={15} color={mutedColor} strokeWidth={2} />
            <Text className="text-[13px] text-foreground">
                Anyone with the link can {linkVerb(link.role)}
            </Text>
        </View>
    )
}

function LiveLink({
    projectId,
    link,
    copied,
    onCopy,
    embedCopied,
    onCopyEmbed,
    onRevoke,
    isRevoking,
}: {
    projectId: string
    link: ShareLinkRow
    copied: boolean
    onCopy: () => void
    embedCopied: boolean
    onCopyEmbed: () => void
    onRevoke: () => void
    isRevoking: boolean
}) {
    const mutedColor = useThemeColor('muted')
    const url = shareLinkURL(link.token)

    return (
        <View className="gap-2">
            <View className="flex-row items-center gap-2">
                <Text
                    numberOfLines={1}
                    className="flex-1 text-[12px] text-muted font-mono"
                    // The URL is long and the row must not push the buttons
                    // out of the panel; shrink the text, never the controls.
                    style={{ flexShrink: 1, minWidth: 0 }}
                >
                    {url}
                </Text>
                {/* Clipboard is a no-op on some native targets, so the button
                    only renders where it can actually do something. */}
                {Platform.OS === 'web' ? (
                    <Pressable
                        accessibilityRole="button"
                        accessibilityLabel="Copy share link"
                        onPress={onCopy}
                        className="shrink-0 flex-row items-center gap-1 px-2.5 py-1 rounded-md border border-border bg-background"
                    >
                        {copied ? (
                            <Check size={14} color={mutedColor} strokeWidth={2.2} />
                        ) : (
                            <Copy size={14} color={mutedColor} strokeWidth={2.2} />
                        )}
                        <Text className="text-[12px] font-medium text-foreground">
                            {copied ? 'Copied' : 'Copy'}
                        </Text>
                    </Pressable>
                ) : null}
            </View>

            <View className="flex-row items-center gap-2">
                <Text className="flex-1 text-[12px] text-muted">{expiryNote(link.expiresAt)}</Text>
                <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Revoke share link"
                    disabled={isRevoking}
                    onPress={onRevoke}
                    className="shrink-0 px-2.5 py-1 rounded-md border border-border bg-background"
                >
                    <Text className="text-[12px] font-medium text-danger">Revoke</Text>
                </Pressable>
            </View>

            <EmbedPanel
                projectId={projectId}
                link={link}
                copied={embedCopied}
                onCopySnippet={onCopyEmbed}
            />

            {/* Revoking means two different things depending on when it
                happens, and the difference surprises people. */}
            <Text className="text-[11px] text-muted">
                Revoking stops new people joining. Anyone who already signed in keeps their place on
                the board — remove them above.
            </Text>
        </View>
    )
}

function MintControls({
    role,
    expiry,
    onRoleChange,
    onExpiryChange,
    embedDomains,
    onEmbedDomainsChange,
    embedLive,
    onEmbedLiveChange,
    onCreate,
    isCreating,
    mutedColor,
}: {
    role: BoardsShareLinkRole
    expiry: ShareLinkExpiryDays
    onRoleChange: (role: BoardsShareLinkRole) => void
    onExpiryChange: (days: ShareLinkExpiryDays) => void
    embedDomains: string
    onEmbedDomainsChange: (value: string) => void
    embedLive: boolean
    onEmbedLiveChange: (value: boolean) => void
    onCreate: () => void
    isCreating: boolean
    mutedColor: string
}) {
    return (
        <View className="gap-2">
            <View className="flex-row items-center gap-2">
                <PickerMenu
                    label={roleOptionLabel(role)}
                    title="Link allows"
                    accessibilityLabel="Change what the link allows"
                    mutedColor={mutedColor}
                >
                    {SHARE_LINK_ROLE_OPTIONS.map(option => (
                        <Menu.Item
                            key={option.value}
                            label={option.label}
                            isSelected={option.value === role}
                            onSelect={() => onRoleChange(option.value as BoardsShareLinkRole)}
                        />
                    ))}
                </PickerMenu>

                <PickerMenu
                    label={expiryOptionLabel(expiry)}
                    title="Link expires"
                    accessibilityLabel="Change when the link expires"
                    mutedColor={mutedColor}
                >
                    {SHARE_LINK_EXPIRY_OPTIONS.map(option => (
                        <Menu.Item
                            key={option.value}
                            label={option.label}
                            isSelected={option.value === expiry}
                            onSelect={() => onExpiryChange(option.value)}
                        />
                    ))}
                </PickerMenu>

                <View className="flex-1" />

                <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Create share link"
                    disabled={isCreating}
                    onPress={onCreate}
                    className="shrink-0 px-3 py-1.5 rounded-md bg-primary"
                >
                    <Text className="text-[12px] font-medium text-primary-foreground">
                        Create link
                    </Text>
                </Pressable>
            </View>

            <EditorWarning isVisible={role === 'editor'} />

            <EmbedControls
                domains={embedDomains}
                onDomainsChange={onEmbedDomainsChange}
                isLive={embedLive}
                onLiveChange={onEmbedLiveChange}
            />
        </View>
    )
}

/**
 * Whether this link may be framed by another site, and by whom.
 *
 * The domain list is the grant: empty means not embeddable, so a link is
 * private to frame unless its owner names somewhere. That is the opposite of
 * how the copyable URL works — anyone may OPEN it — and deliberately so: a
 * board that renders inside a page the owner never named is a surprise, and
 * `frame-ancestors` is the one control that can prevent it.
 *
 * Shared by the mint form and the edit panel so the two cannot describe the
 * same setting differently — the wording below IS the explanation of what
 * embedding costs, and it has to be the same in both places.
 *
 * Web-only. A phone has nowhere to paste an iframe, and the field would be a
 * control that does nothing on the platform showing it.
 */
function EmbedFields({
    domains,
    onDomainsChange,
    isLive,
    onLiveChange,
}: {
    domains: string
    onDomainsChange: (value: string) => void
    isLive: boolean
    onLiveChange: (value: boolean) => void
}) {
    return (
        <>
            <TextInput
                accessibilityLabel="Websites allowed to embed this board"
                value={domains}
                onChangeText={onDomainsChange}
                autoCapitalize="none"
                autoCorrect={false}
                placeholder="https://example.com"
                placeholderTextColor="#9ca3af"
                className="px-2.5 py-1.5 rounded-md border border-border bg-background text-[12px] text-foreground web:outline-none web:focus-visible:ring-2 web:focus-visible:ring-ring"
            />

            <Text className="text-[11px] text-muted">
                Leave empty to stop this board being embedded anywhere. Include the scheme, and
                separate several sites with a space.
            </Text>

            <View className="flex-row items-center gap-2">
                <Switch
                    accessibilityLabel="Keep an embedded board up to date"
                    value={isLive}
                    onValueChange={onLiveChange}
                />
                <Text className="flex-1 text-[11px] text-muted">
                    Keep an embedded board up to date as the board changes. This holds a connection
                    open for every visitor to the page it is embedded on and will be unstable if
                    used on high-traffic sites.
                </Text>
            </View>
        </>
    )
}

/** The embed fields as they appear on the mint form, before a link exists. */
function EmbedControls({
    domains,
    onDomainsChange,
    isLive,
    onLiveChange,
}: {
    domains: string
    onDomainsChange: (value: string) => void
    isLive: boolean
    onLiveChange: (value: boolean) => void
}) {
    if (Platform.OS !== 'web') return null

    return (
        <View className="gap-2 pt-2 border-t border-border">
            <Text className="text-[12px] font-medium text-foreground">Embed on a website</Text>
            <EmbedFields
                domains={domains}
                onDomainsChange={onDomainsChange}
                isLive={isLive}
                onLiveChange={onLiveChange}
            />
        </View>
    )
}

/**
 * The embed policy of a link that already exists, and the form to change it.
 *
 * This is the whole point of the edit path: the right origin is rarely known
 * when a link is minted. Someone pastes the snippet, the frame stays blank
 * because the origin was wrong, and before this the only repair was to revoke
 * and re-mint — which changes the token and so breaks every page already
 * carrying the snippet, to fix a typo.
 *
 * Deliberately edits ONLY the embed policy. Role and expiry are not offered
 * here: everyone already holding the URL would silently inherit a changed role,
 * whereas changing where a board may be framed re-grants nothing to anyone who
 * already has the link.
 */
function EmbedPanel({
    projectId,
    link,
    copied,
    onCopySnippet,
}: {
    projectId: string
    link: ShareLinkRow
    copied: boolean
    onCopySnippet: () => void
}) {
    const {
        isEditing,
        domains,
        isLive,
        setDomains,
        setLive,
        startEditing,
        cancelEditing,
        save,
        isSaving,
        error,
    } = useEmbedEditor(projectId, link)
    const mutedColor = useThemeColor('muted')

    if (Platform.OS !== 'web') return null

    if (!isEditing) {
        return (
            <View className="gap-2 pt-2 border-t border-border">
                <View className="flex-row items-center gap-2">
                    <Text numberOfLines={1} className="flex-1 text-[11px] text-muted">
                        {embedSummary(link)}
                    </Text>
                    <Pressable
                        accessibilityRole="button"
                        accessibilityLabel="Change where this board can be embedded"
                        onPress={startEditing}
                        className="shrink-0 flex-row items-center gap-1 px-2.5 py-1 rounded-md border border-border bg-background"
                    >
                        <Pencil size={14} color={mutedColor} strokeWidth={2.2} />
                        <Text className="text-[12px] font-medium text-foreground">
                            {link.embedDomains ? 'Change' : 'Embed'}
                        </Text>
                    </Pressable>
                </View>

                <EmbedSnippetRow
                    isVisible={!!link.embedDomains}
                    copied={copied}
                    onCopy={onCopySnippet}
                />
            </View>
        )
    }

    return (
        <View className="gap-2 pt-2 border-t border-border">
            <Text className="text-[12px] font-medium text-foreground">Embed on a website</Text>

            <EmbedFields
                domains={domains}
                onDomainsChange={setDomains}
                isLive={isLive}
                onLiveChange={setLive}
            />

            <View className="flex-row items-center gap-2">
                <View className="flex-1" />
                <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Cancel embed changes"
                    onPress={cancelEditing}
                    className="shrink-0 px-2.5 py-1 rounded-md border border-border bg-background"
                >
                    <Text className="text-[12px] font-medium text-foreground">Cancel</Text>
                </Pressable>
                <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Save embed changes"
                    disabled={isSaving}
                    onPress={save}
                    className="shrink-0 px-3 py-1.5 rounded-md bg-primary"
                >
                    <Text className="text-[12px] font-medium text-primary-foreground">Save</Text>
                </Pressable>
            </View>

            <ErrorNote message={error} />
        </View>
    )
}

/** The iframe to paste, offered once a link may actually be framed. */
function EmbedSnippetRow({
    isVisible,
    copied,
    onCopy,
}: {
    isVisible: boolean
    copied: boolean
    onCopy: () => void
}) {
    const mutedColor = useThemeColor('muted')

    if (!isVisible || Platform.OS !== 'web') return null

    // The summary above already says where the board is framable, so this row
    // is the button alone, right-aligned under it.
    return (
        <View className="flex-row items-center justify-end gap-2">
            <Pressable
                accessibilityRole="button"
                accessibilityLabel="Copy embed code"
                onPress={onCopy}
                className="shrink-0 flex-row items-center gap-1 px-2.5 py-1 rounded-md border border-border bg-background"
            >
                {copied ? (
                    <Check size={14} color={mutedColor} strokeWidth={2.2} />
                ) : (
                    <Code size={14} color={mutedColor} strokeWidth={2.2} />
                )}
                <Text className="text-[12px] font-medium text-foreground">
                    {copied ? 'Copied' : 'Embed code'}
                </Text>
            </Pressable>
        </View>
    )
}

/**
 * The edit form's state for one link's embed policy.
 *
 * A hook rather than state in the panel because the JSX stays free of the
 * open/close, seed-from-row and submit handling, per the package's style guide.
 *
 * The draft is seeded from the row when editing STARTS, not on every render: a
 * realtime update landing mid-edit must not overwrite what someone is typing.
 * Cancel discards the draft, so the row remains the only truth once the form
 * is closed.
 */
function useEmbedEditor(projectId: string, link: ShareLinkRow) {
    const [isEditing, setIsEditing] = useState(false)
    const [domains, setDomains] = useState('')
    const [isLive, setLive] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const updateLink = useUpdateShareLink(projectId)

    const startEditing = () => {
        setDomains(link.embedDomains)
        setLive(link.embedLive)
        setError(null)
        setIsEditing(true)
    }

    const cancelEditing = () => {
        setError(null)
        setIsEditing(false)
    }

    const save = () => {
        setError(null)
        updateLink.mutate(
            { linkId: link.id, embedDomains: domains, embedLive: isLive },
            {
                onSuccess: () => setIsEditing(false),
                // The server's message names the origin it refused and why, so
                // it is shown verbatim rather than replaced with a generic one.
                onError: err => setError(err.message),
            }
        )
    }

    return {
        isEditing,
        domains,
        isLive,
        setDomains,
        setLive,
        startEditing,
        cancelEditing,
        save,
        isSaving: updateLink.isPending,
        error,
    }
}

/** Where this link may currently be framed, in one line. */
export function embedSummary(link: ShareLinkRow): string {
    if (!link.embedDomains) return 'Not embedded on any website'
    const where = link.embedDomains.split(' ').join(', ')
    return `Embeddable on ${where}${link.embedLive ? ' · live' : ''}`
}

/** An editor link is an unbounded invitation to change the board. Say so. */
function EditorWarning({ isVisible }: { isVisible: boolean }) {
    if (!isVisible) return null
    return (
        <Text className="text-[11px] text-muted">
            Anyone with this link can sign in with an email address and edit this board.
        </Text>
    )
}

function ErrorNote({ message }: { message: string | null }) {
    if (!message) return null
    return (
        <View className="px-3 py-2 rounded-md bg-danger/10">
            <Text className="text-[12px] text-danger">{message}</Text>
        </View>
    )
}

function PickerMenu({
    label,
    title,
    accessibilityLabel,
    mutedColor,
    children,
}: {
    label: string
    /** The sheet's heading on a phone. */
    title: string
    accessibilityLabel: string
    mutedColor: string
    children: React.ReactNode
}) {
    return (
        <Menu
            trigger={
                <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={accessibilityLabel}
                    className="flex-row items-center gap-1 px-2.5 py-1 rounded-md border border-border bg-background web:outline-none web:focus-visible:ring-2 web:focus-visible:ring-ring"
                >
                    <Text className="text-[12px] font-medium text-foreground">{label}</Text>
                    <ChevronDown size={14} color={mutedColor} strokeWidth={2.2} />
                </Pressable>
            }
            placement="bottom-start"
            title={title}
        >
            {children}
        </Menu>
    )
}

/**
 * The public URL for a token.
 *
 * Built here rather than taken from the server so it always matches the route
 * the app actually serves — drive's endpoint returns a `url` built from an app
 * setting that no longer matches its own public route, and its own dialog
 * quietly ignores it for exactly that reason.
 *
 * Deliberately NOT org-scoped: `/p/*` is a pre-auth entry point with no org
 * segment, which is the whole point — a recipient has no org to be in yet. On
 * web the current origin is the truth; elsewhere fall back to the configured
 * server address, since a phone has no window.location to read.
 */
export function shareLinkURL(token: string): string {
    const path = `/p/boards/${token}`
    if (Platform.OS === 'web' && typeof window !== 'undefined') {
        return `${window.location.origin}${path}`
    }
    return `${PB_SERVER_ADDR}${path}`
}

/**
 * The iframe to paste into another page.
 *
 * `?embed=1` is what drops our chrome AND what the server matches when it
 * decides the framing header — a bare share URL stays unframable, so the
 * parameter has to be here for the embed to work at all.
 */
export function embedSnippet(token: string): string {
    const url = `${shareLinkURL(token)}?embed=1`
    return `<iframe src="${url}" width="100%" height="600" style="border:0" title="Board"></iframe>`
}

function roleOptionLabel(role: BoardsShareLinkRole): string {
    return SHARE_LINK_ROLE_OPTIONS.find(o => o.value === role)?.label ?? role
}

function expiryOptionLabel(days: ShareLinkExpiryDays): string {
    return SHARE_LINK_EXPIRY_OPTIONS.find(o => o.value === days)?.label ?? `${days} days`
}

/** What the summary line says a link holder can do. */
function linkVerb(role: BoardsShareLinkRole): string {
    switch (role) {
        case 'editor':
            return 'edit this board after signing in'
        case 'commentor':
            return 'comment after signing in'
        default:
            return 'view this board'
    }
}

function expiryNote(expiresAt: string): string {
    if (!expiresAt) return 'Never expires'
    const parsed = new Date(expiresAt.replace(' ', 'T'))
    if (Number.isNaN(parsed.getTime())) return ''
    return `Expires ${parsed.toLocaleDateString(undefined, {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
    })}`
}
