import { DocumentTitle } from '@tinycld/core/components/DocumentTitle'
import { LoadingState } from '@tinycld/core/components/LoadingState'
import { ShareLinkSignIn } from '@tinycld/core/components/share/ShareLinkSignIn'
import { useAuth } from '@tinycld/core/lib/auth'
import { setShareToken } from '@tinycld/core/lib/share-token'
import { Redirect, useLocalSearchParams } from 'expo-router'
import { useEffect, useState } from 'react'
import { Pressable, Text, View } from 'react-native'
import { BoardCanvas } from '../components/BoardCanvas'
import { CardPeek } from '../components/CardPeek'
import { useBoardContent } from '../hooks/useActiveBoard'
import { useProjectRole } from '../hooks/useProjectRole'
import { type ShareLinkSignInRole, useShareLinkMeta } from '../hooks/useShareLinkMeta'
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
 */
export default function PublicBoardScreen() {
    const { token = '' } = useLocalSearchParams<{ token: string }>()

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

function PublicBoardHeader({
    name,
    token,
    signInRole,
    onSignedIn,
}: {
    name: string
    token: string
    /** The role a sign-in would grant, or null when the link offers none. */
    signInRole: ShareLinkSignInRole | null
    onSignedIn: () => void
}) {
    const [isSigningIn, setIsSigningIn] = useState(false)

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
