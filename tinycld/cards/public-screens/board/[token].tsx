import { eq } from '@tanstack/db'
import { useQuery } from '@tanstack/react-query'
import { DocumentTitle } from '@tinycld/core/components/DocumentTitle'
import { LoadingState } from '@tinycld/core/components/LoadingState'
import { ShareLinkSignIn } from '@tinycld/core/components/share/ShareLinkSignIn'
import { useAuth } from '@tinycld/core/lib/auth'
import { PB_SERVER_ADDR, useStore } from '@tinycld/core/lib/pocketbase'
import { setShareToken } from '@tinycld/core/lib/share-token'
import { Redirect, useLocalSearchParams } from 'expo-router'
import { useEffect, useState } from 'react'
import { Pressable, Text, View } from 'react-native'
import { BoardCanvas } from '../../components/BoardCanvas'
import { CardPeek } from '../../components/CardPeek'
import { useBoardContent } from '../../hooks/useActiveBoard'
import { useBoardLiveQuery } from '../../hooks/useBoardLiveQuery'
import { useProjectRole } from '../../hooks/useProjectRole'
import { decidePublicBoardRoute } from '../../lib/public-board-routing'

/**
 * A board opened by share link, at `/p/cards/board/<token>`.
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
    const { projectId, isResolved } = usePublicProjectId(token)
    const { project, isLoading } = useBoardContent(projectId)
    const { role, isReady: roleReady } = useProjectRole(projectId)

    const route = decidePublicBoardRoute({
        isAuthLoading: auth.isInitializing,
        isSignedIn: auth.isLoggedIn,
        projectId: project?.id,
        // A signed-in visitor who already holds a membership gets the live
        // board instead of this read-only rendering of it.
        isMember: !!role,
        isBoardResolved: isResolved && !isLoading && roleReady,
        isTokenRejected: !token,
    })

    if (route.kind === 'wait') {
        return (
            <View className="flex-1 bg-background">
                <DocumentTitle pkg="Cards" title="Shared board" />
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
            <DocumentTitle pkg="Cards" title={project.name} />
            <PublicBoardHeader
                name={project.name}
                token={token}
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
 * The board a token names.
 *
 * There is no id to look up and no endpoint to ask. `cards_projects` syncs
 * eagerly and the access rules scope it to the token's board, so for an
 * anonymous visitor the collection holds EXACTLY ONE row: theirs. Reading it
 * this way keeps the public path on the same queries as the private one —
 * asking the server "which board is this token for?" would be a second read
 * path to keep in step.
 *
 * A signed-in member opening a link sees their own boards here too, so the row
 * is matched against the token's project rather than assumed to be the only
 * one — see the `shareProject` filter below.
 */
function usePublicProjectId(token: string): { projectId: string; isResolved: boolean } {
    const [projectsCollection, linksCollection] = useStore('cards_projects', 'cards_share_links')

    // The link row itself is owner-only by rule, so a visitor reads nothing
    // here and this resolves empty — which is correct. It matters only for a
    // signed-in OWNER following their own link, where it disambiguates their
    // several boards.
    const { data: linkRows } = useBoardLiveQuery(
        query => {
            if (!token) return null
            return query.from({ link: linksCollection }).where(({ link }) => eq(link.token, token))
        },
        [token, linksCollection]
    )

    const { data: projectRows, isReady } = useBoardLiveQuery(
        query => query.from({ project: projectsCollection }),
        [projectsCollection]
    )

    const linkedProjectId = linkRows?.[0]?.project ?? ''
    const projects = projectRows ?? []

    const projectId = linkedProjectId
        ? (projects.find(p => p.id === linkedProjectId)?.id ?? '')
        : (projects[0]?.id ?? '')

    return { projectId, isResolved: isReady }
}

function PublicBoardHeader({
    name,
    token,
    onSignedIn,
}: {
    name: string
    token: string
    onSignedIn: () => void
}) {
    const [isSigningIn, setIsSigningIn] = useState(false)
    const signInRole = useSignInRole(token)

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
                        slug="cards"
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

/**
 * The role a link offers to someone willing to sign in, or null when it offers
 * nothing.
 *
 * Read from the public metadata endpoint, NOT from cards_share_links. The
 * collection is owner-only by rule, so a visitor reads no row — the obvious
 * implementation renders the button only for people who already have access,
 * i.e. nobody who needs it. That is precisely the bug the e2e caught.
 *
 * A viewer link returns needs_signin=false and no button appears, which matches
 * the server: anonymous read is its whole grant, and the OTP endpoints refuse
 * it outright.
 */
function useSignInRole(token: string): 'commentor' | 'editor' | null {
    const { data } = useQuery({
        queryKey: ['cards', 'share-link-meta', token],
        enabled: !!token,
        queryFn: async () => {
            const res = await fetch(
                `${PB_SERVER_ADDR}/api/cards/share-link/${encodeURIComponent(token)}`
            )
            if (!res.ok) return null
            return (await res.json()) as { role?: string; needs_signin?: boolean }
        },
    })

    if (!data?.needs_signin) return null
    return data.role === 'editor' || data.role === 'commentor' ? data.role : null
}

function LinkGone({ reason }: { reason: 'revoked' | 'missing' }) {
    return (
        <View className="flex-1 items-center justify-center bg-background px-6">
            <DocumentTitle pkg="Cards" title="Link unavailable" />
            <Text className="text-[17px] font-semibold text-foreground">
                This link is no longer available
            </Text>
            <Text className="mt-2 text-[13px] text-muted text-center">
                {reason === 'revoked'
                    ? 'It may have been revoked or reached its expiry date. Ask whoever shared the board for a new link.'
                    : 'The board it pointed at could not be found.'}
            </Text>
        </View>
    )
}
