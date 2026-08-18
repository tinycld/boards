import { PB_SERVER_ADDR } from '@tinycld/core/lib/pocketbase'
import { useThemeColor } from '@tinycld/core/lib/use-app-theme'
import { Menu } from '@tinycld/core/ui/menu'
import * as Clipboard from 'expo-clipboard'
import { Check, ChevronDown, Copy, Globe, Lock } from 'lucide-react-native'
import { useState } from 'react'
import { Platform, Pressable, Text, View } from 'react-native'
import { useCopiedFlag } from '../../hooks/useCopiedFlag'
import {
    DEFAULT_SHARE_LINK_EXPIRY_DAYS,
    SHARE_LINK_EXPIRY_OPTIONS,
    type ShareLinkExpiryDays,
    type ShareLinkRow,
    useCreateShareLink,
    useRevokeShareLink,
    useShareLinks,
} from '../../hooks/useShareLinks'
import type { CardsShareLinkRole } from '../../types'
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
    const [role, setRole] = useState<CardsShareLinkRole>('viewer')
    const [expiry, setExpiry] = useState<ShareLinkExpiryDays>(DEFAULT_SHARE_LINK_EXPIRY_DAYS)
    const [copied, markCopied] = useCopiedFlag()
    const [error, setError] = useState<string | null>(null)

    const createLink = useCreateShareLink(projectId)
    const revokeLink = useRevokeShareLink(projectId)
    const mutedColor = useThemeColor('muted')

    if (!isVisible) return null

    const onCreate = () => {
        setError(null)
        createLink.mutate(
            { role, expiresInDays: expiry },
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

    return (
        <View className="mt-4 rounded-xl border border-border overflow-hidden">
            <View className="px-3 py-2 border-b border-border">
                <Text className="text-[13px] font-semibold text-foreground">General access</Text>
            </View>

            <View className="px-3 py-3 gap-3">
                <AccessSummary link={activeLink} />

                {activeLink ? (
                    <LiveLink
                        link={activeLink}
                        copied={copied}
                        onCopy={onCopy}
                        onRevoke={onRevoke}
                        isRevoking={revokeLink.isPending}
                    />
                ) : (
                    <MintControls
                        role={role}
                        expiry={expiry}
                        onRoleChange={setRole}
                        onExpiryChange={setExpiry}
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
    link,
    copied,
    onCopy,
    onRevoke,
    isRevoking,
}: {
    link: ShareLinkRow
    copied: boolean
    onCopy: () => void
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
    onCreate,
    isCreating,
    mutedColor,
}: {
    role: CardsShareLinkRole
    expiry: ShareLinkExpiryDays
    onRoleChange: (role: CardsShareLinkRole) => void
    onExpiryChange: (days: ShareLinkExpiryDays) => void
    onCreate: () => void
    isCreating: boolean
    mutedColor: string
}) {
    return (
        <View className="gap-2">
            <View className="flex-row items-center gap-2">
                <PickerMenu
                    label={roleOptionLabel(role)}
                    accessibilityLabel="Change what the link allows"
                    mutedColor={mutedColor}
                >
                    {SHARE_LINK_ROLE_OPTIONS.map(option => (
                        <Menu.Item
                            key={option.value}
                            onPress={() => onRoleChange(option.value as CardsShareLinkRole)}
                        >
                            <Menu.ItemTitle>{option.label}</Menu.ItemTitle>
                        </Menu.Item>
                    ))}
                </PickerMenu>

                <PickerMenu
                    label={expiryOptionLabel(expiry)}
                    accessibilityLabel="Change when the link expires"
                    mutedColor={mutedColor}
                >
                    {SHARE_LINK_EXPIRY_OPTIONS.map(option => (
                        <Menu.Item key={option.value} onPress={() => onExpiryChange(option.value)}>
                            <Menu.ItemTitle>{option.label}</Menu.ItemTitle>
                        </Menu.Item>
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
        </View>
    )
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
    accessibilityLabel,
    mutedColor,
    children,
}: {
    label: string
    accessibilityLabel: string
    mutedColor: string
    children: React.ReactNode
}) {
    return (
        <Menu>
            <Menu.Trigger>
                <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={accessibilityLabel}
                    className="flex-row items-center gap-1 px-2.5 py-1 rounded-md border border-border bg-background web:outline-none web:focus-visible:ring-2 web:focus-visible:ring-ring"
                >
                    <Text className="text-[12px] font-medium text-foreground">{label}</Text>
                    <ChevronDown size={14} color={mutedColor} strokeWidth={2.2} />
                </Pressable>
            </Menu.Trigger>
            <Menu.Portal>
                <Menu.Overlay />
                <Menu.Content presentation="popover" placement="bottom" align="start">
                    {children}
                </Menu.Content>
            </Menu.Portal>
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
    const path = `/p/cards/board/${token}`
    if (Platform.OS === 'web' && typeof window !== 'undefined') {
        return `${window.location.origin}${path}`
    }
    return `${PB_SERVER_ADDR}${path}`
}

function roleOptionLabel(role: CardsShareLinkRole): string {
    return SHARE_LINK_ROLE_OPTIONS.find(o => o.value === role)?.label ?? role
}

function expiryOptionLabel(days: ShareLinkExpiryDays): string {
    return SHARE_LINK_EXPIRY_OPTIONS.find(o => o.value === days)?.label ?? `${days} days`
}

/** What the summary line says a link holder can do. */
function linkVerb(role: CardsShareLinkRole): string {
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
