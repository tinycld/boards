import { DocumentTitle } from '@tinycld/core/components/DocumentTitle'
import { LoadingState } from '@tinycld/core/components/LoadingState'
import { ShareLinkSignIn } from '@tinycld/core/components/share/ShareLinkSignIn'
import { useAuth } from '@tinycld/core/lib/auth'
import { installRealtimeGuard, setRealtimeEnabled } from '@tinycld/core/lib/realtime-enabled'
import { setShareToken } from '@tinycld/core/lib/share-token'
import { Redirect, useLocalSearchParams } from 'expo-router'
import { useEffect, useState } from 'react'
import { Pressable, Text, View } from 'react-native'
import { BoardCanvas } from '../components/BoardCanvas'
import { CardPeek } from '../components/CardPeek'
import { useBoardContent } from '../hooks/useActiveBoard'
import { useProjectRole } from '../hooks/useProjectRole'
import { type ShareLinkSignInRole, useShareLinkMeta } from '../hooks/useShareLinkMeta'
import { paramString } from '../lib/board-route'
import { decidePublicBoardRoute, type PublicBoardGoneReason } from '../lib/public-board-routing'

/**
 * A board opened by share link, at `/p/boards/<token>`.
 *
 * The whole screen is a thin shell: it installs the token, resolves which board
 * the token names, and then renders the ORDINARY board. There is no parallel
 * read-only renderer, because there does not need to be — the access rules let
 * the token satisfy list/view, so `useBoardContent` runs the same six queries a
 * member's board runs and `BoardCanvas` derives capabilities from
 * `useProjectRole`, which correctly finds no membership and denies everything.
 *
 * That is the payoff of authorizing in the rules rather than in an endpoint:
 * one board implementation, and a visitor's view cannot drift from a member's.
 *
 * `?embed=1` renders the same board for framing inside a third-party page. It
 * is a presentation flag and NOT a permission: what a visitor may read is
 * decided by the token in the access rules either way, and the origins allowed
 * to frame the page are enforced by the browser from a header the server
 * writes (boards/server/embed.go). All this parameter does is drop the chrome
 * that belongs to our app rather than to the board, and honour the link's
 * `embed_live` choice about holding a socket open on someone else's page.
 */
export default function PublicBoardScreen() {
    const { token = '', embed } = useLocalSearchParams<{ token: string; embed: string }>()
    // Through paramString because a repeated `?embed=1&embed=1` arrives as an
    // array. Go's Query().Get() takes the first value, so the server would read
    // that URL as an embed — a bare `embed === '1'` here would not, and the two
    // sides deciding differently is how a page loses its chrome or keeps it
    // against the grant it was given.
    const isEmbed = paramString(embed) === '1'

    // Install before anything queries. An effect would run AFTER the first
    // render's queries have already gone out unauthenticated, and those come
    // back empty rather than retrying — the board would sit empty until
    // something unrelated invalidated it.
    useInstalledShareToken(token)

    const auth = useAuth({ throwIfAnon: false })
    // The metadata endpoint is the ONLY authority on which board a token names.
    // It is public by design precisely because boards_share_links is owner-only,
    // so no client-side query can answer this for the caller who needs it.
    const meta = useShareLinkMeta(token)

    // Realtime is on by default, so an embed must opt OUT rather than in — the
    // same shape as the token install above, and for the same reason: by the
    // time an effect ran, a collection could already have subscribed.
    // `meta.embedLive` is false until the metadata resolves, so a socket is
    // withheld until the link asks for one, never the other way round.
    useEmbedRealtime(isEmbed, meta.embedLive)

    const { project, isLoading } = useBoardContent(meta.projectId)
    const { role, isReady: roleReady } = useProjectRole(meta.projectId)

    const route = decidePublicBoardRoute({
        isAuthLoading: auth.isInitializing,
        isSignedIn: auth.isLoggedIn,
        projectId: project?.id,
        // A signed-in visitor who already holds a membership gets the live
        // board instead of this read-only rendering of it.
        isMember: !!role,
        isBoardResolved: meta.isResolved && !isLoading && roleReady,
        // A revoked, expired or fabricated token is rejected by the SERVER —
        // an empty string is only the degenerate case of a malformed URL. The
        // endpoint distinguishes them, so `gone.reason` can too.
        isTokenRejected: !token || meta.isRejected,
        rejectionReason: meta.rejectionReason,
        isEmbed,
    })

    if (route.kind === 'wait') {
        return (
            <View className="flex-1 bg-background">
                <DocumentTitle pkg="Boards" title="Shared board" />
                <LoadingState />
            </View>
        )
    }

    if (route.kind === 'redirect') return <Redirect href={route.href} />

    if (route.kind === 'gone') {
        return <LinkGone reason={route.reason} />
    }

    if (!project) return <LinkGone reason="missing" />

    return (
        <View className="flex-1 bg-background">
            <DocumentTitle pkg="Boards" title={project.name} />
            <PublicBoardHeader
                // Hidden in an embed: the title bar, the "Read only" pill and
                // the sign-in button are OUR chrome, and on someone else's page
                // they read as a widget advertising itself. The board is what
                // was embedded.
                isVisible={!isEmbed}
                name={project.name}
                token={token}
                signInRole={meta.signInRole}
                onSignedIn={() => setShareToken(null)}
            />
            <BoardCanvas project={project} />
            <CardPeek project={project} />
        </View>
    )
}

/**
 * Installs the token for the lifetime of this screen and clears it on the way
 * out, so navigating into the workspace does not keep presenting a credential
 * that is no longer the basis for access.
 *
 * Set during the first render rather than in the effect body: the queries below
 * run before effects flush, and a query that goes out without the header comes
 * back empty and stays empty.
 */
function useInstalledShareToken(token: string) {
    const [installed] = useState(() => {
        setShareToken(token)
        return token
    })

    useEffect(() => {
        if (installed !== token) setShareToken(token)
        return () => setShareToken(null)
    }, [installed, token])
}

/**
 * Hold realtime open only when an embed's link asked for it.
 *
 * A non-embed share page is unchanged: realtime stays on, exactly as it is
 * everywhere else in the app. Only an embed can turn it off, and only because
 * the socket would then be held on a page whose traffic the board's owner
 * neither sees nor controls.
 *
 * The guard is installed on the first render for the reason the file's other
 * install does: a collection read during that render can subscribe before any
 * effect runs, and a subscription that slipped through would keep the socket
 * open for the life of the page.
 */
function useEmbedRealtime(isEmbed: boolean, embedLive: boolean) {
    const enabled = !isEmbed || embedLive

    useState(() => {
        installRealtimeGuard()
        setRealtimeEnabled(enabled)
        return enabled
    })

    // Two effects rather than one, because they have different lifetimes and
    // folding them together gets the teardown wrong: a single effect keyed on
    // `enabled` would run its cleanup every time the value CHANGED — so the
    // moment `embedLive` resolved, the cleanup would re-enable realtime on its
    // way to disabling it, which is the opposite of what the link asked for.
    useEffect(() => {
        setRealtimeEnabled(enabled)
    }, [enabled])

    // Unmount only. Restored so leaving an embed does not leave the app
    // permanently without realtime — reachable in a top-level tab, where the
    // embed URL is the whole page rather than a frame.
    useEffect(() => () => setRealtimeEnabled(true), [])
}

function PublicBoardHeader({
    isVisible,
    name,
    token,
    signInRole,
    onSignedIn,
}: {
    isVisible: boolean
    name: string
    token: string
    /** The role a sign-in would grant, or null when the link offers none. */
    signInRole: ShareLinkSignInRole | null
    onSignedIn: () => void
}) {
    const [isSigningIn, setIsSigningIn] = useState(false)

    if (!isVisible) return null

    return (
        <View className="border-b border-border">
            <View className="flex-row items-center gap-3 px-4 py-3">
                <Text className="text-[15px] font-semibold text-foreground" numberOfLines={1}>
                    {name}
                </Text>
                <View className="px-2 py-0.5 rounded-md bg-muted/15">
                    <Text className="text-[11px] font-medium text-muted">Read only</Text>
                </View>
                <View className="flex-1" />
                {signInRole && !isSigningIn ? (
                    <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={
                            signInRole === 'editor'
                                ? 'Sign in to edit this board'
                                : 'Sign in to comment on this board'
                        }
                        onPress={() => setIsSigningIn(true)}
                        className="shrink-0 px-3 py-1.5 rounded-md bg-primary"
                    >
                        <Text className="text-[12px] font-medium text-primary-foreground">
                            {signInRole === 'editor' ? 'Sign in to edit' : 'Sign in to comment'}
                        </Text>
                    </Pressable>
                ) : null}
            </View>

            {signInRole && isSigningIn ? (
                <View className="px-4 pb-4">
                    <ShareLinkSignIn
                        slug="boards"
                        token={token}
                        role={signInRole}
                        subject="board"
                        onSuccess={() => {
                            setIsSigningIn(false)
                            // Stop presenting the token: the visitor now holds
                            // a real membership, and the OTHER half of the rule
                            // disjunct is what authorizes them from here. The
                            // routing decision re-runs and sends them to the
                            // live board.
                            onSignedIn()
                        }}
                    />
                </View>
            ) : null}
        </View>
    )
}

const GONE_MESSAGE: Record<PublicBoardGoneReason, string> = {
    revoked: 'It has been switched off by whoever shared the board. Ask them for a new link.',
    expired: 'It reached its expiry date. Ask whoever shared the board for a new link.',
    missing: 'The board it pointed at could not be found.',
}

function LinkGone({ reason }: { reason: PublicBoardGoneReason }) {
    return (
        <View className="flex-1 items-center justify-center bg-background px-6">
            <DocumentTitle pkg="Boards" title="Link unavailable" />
            <Text className="text-[17px] font-semibold text-foreground">
                This link is no longer available
            </Text>
            <Text className="mt-2 text-[13px] text-muted text-center">{GONE_MESSAGE[reason]}</Text>
        </View>
    )
}
