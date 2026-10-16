import { useNavigation, useRouter } from 'expo-router'
import { useEffect, useRef } from 'react'
import { Pressable, Text, View } from 'react-native'
import { useBoardLayout } from '../hooks/useBoardLayout'
import { useIsRouteFocused } from '../hooks/useIsRouteFocused'
import { useLeaveToBoard } from '../hooks/useLeaveToBoard'
import { type OpenCard, useOpenCard } from '../hooks/useOpenCard'
import { findCardEntry } from '../lib/board-cards'
import { parseCardSegment } from '../lib/board-route'
import type { BoardProject } from '../types'
import { CardPage } from './CardPage'
import { CardSurface } from './CardSurface'

/**
 * One card over its board — the `[card]` child of the board's layout route.
 *
 * The segment's shape picks the surface (lib/board-route.ts): a key or a
 * record id is the peek or the modal, per the reader's preference; a bare
 * number is the full page. Anything that names no card on THIS board is a
 * not-found over the board, with a way back to it.
 *
 * The board is beneath, mounted once by the layout. The stack the children
 * share is laid over it with its pointer events switched off on web (see
 * childStackPointerEvents in the layout), so each surface opts its own nodes
 * back in: the peek's panel, but not the space beside it, where the board must
 * stay operable.
 */
export function CardChild({ segment }: { segment: string }) {
    const { project } = useBoardLayout()
    const open = useOpenCard()
    const leaveToBoard = useLeaveToBoard()
    useCanonicalSegment(project, segment, open)
    useLeaveWhenCardGoes(open, leaveToBoard)

    if (!open) return <CardNotFound onBack={leaveToBoard} />
    if (open.surface === 'page') {
        return (
            <View pointerEvents="auto" className="flex-1">
                <CardPage project={project} cardId={open.cardId} />
            </View>
        )
    }
    return <FocusedSurface project={project} cardId={open.cardId} />
}

/**
 * The peek or the modal, only while this child is the one on screen.
 *
 * Each peek opened from a peek is pushed, and on web a child under a
 * transparent one stays laid out. Rendering every covered surface would stack
 * one panel per card walked, each with its own editor; the covered ones come
 * back when Back uncovers them.
 */
function FocusedSurface({ project, cardId }: { project: BoardProject; cardId: string }) {
    const isFocused = useIsRouteFocused()
    if (!isFocused) return null
    return (
        <View pointerEvents="box-none" className="flex-1">
            <CardSurface project={project} cardId={cardId} />
        </View>
    )
}

/**
 * Leave for the board when the card on screen stops resolving: deleted,
 * archived, moved to another board, or filtered out — here or by someone else.
 *
 * Only a card this child HAS shown: a link that never resolved stays on the
 * not-found, which says what happened. And only while focused, so a covered
 * child does not navigate out from under the one on top. Once per child.
 */
function useLeaveWhenCardGoes(open: OpenCard, leaveToBoard: () => void) {
    const navigation = useNavigation()
    const shownRef = useRef(false)
    const leftRef = useRef(false)
    useEffect(() => {
        if (open) {
            shownRef.current = true
            return
        }
        if (!shownRef.current || leftRef.current || !navigation.isFocused()) return
        leftRef.current = true
        leaveToBoard()
    }, [open, leaveToBoard, navigation])
}

/**
 * Respell a record-id segment once the card it names has a canonical one: the
 * peek's `/PL/<id>` becomes `/PL/PL-12` once the server numbers the card, the
 * page's `/PL/<id>` becomes `/PL/12`.
 *
 * `setParams` rather than `replace`, which would remount the child and end
 * the editing session; and only while this child is the focused route,
 * because `setParams` writes to whichever route is on top. A covered child
 * keeps its id spelling, which still resolves. Only an id is respelled: a key
 * or a number someone typed is left as they typed it.
 */
function useCanonicalSegment(project: BoardProject, segment: string, open: OpenCard) {
    const router = useRouter()
    const navigation = useNavigation()
    const card = open ? findCardEntry(project, open.cardId)?.card : undefined
    const canonical = canonicalSegment(open, card)
    useEffect(() => {
        if (!canonical || canonical === segment || !navigation.isFocused()) return
        if (parseCardSegment(segment).kind !== 'id') return
        router.setParams({ card: canonical })
    }, [canonical, segment, router, navigation])
}

function canonicalSegment(open: OpenCard, card: { key: string; number: number } | undefined) {
    if (!open || !card) return ''
    if (open.surface === 'page') return card.number ? String(card.number) : ''
    return card.key
}

function CardNotFound({ onBack }: { onBack: () => void }) {
    return (
        <View
            pointerEvents="auto"
            className="flex-1 bg-background items-center justify-center gap-3 p-6"
        >
            <Text className="text-[15px] font-semibold text-foreground">
                This card doesn’t exist or was removed
            </Text>
            <Pressable
                accessibilityRole="button"
                onPress={onBack}
                className="border border-border bg-card rounded-lg px-3.5 py-2 web:outline-none web:focus-visible:ring-2 web:focus-visible:ring-ring"
            >
                <Text className="text-[13px] font-medium text-foreground">Back to board</Text>
            </Pressable>
        </View>
    )
}
