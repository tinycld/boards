import { useAuth } from '@tinycld/core/lib/auth'
import type { BuiltinFieldProps } from '@tinycld/core/lib/forms/host-ui'
import { ReactionBar } from '@tinycld/core/ui/reactions'
import { useCardReactions } from '../../hooks/useCardReactions'
import { useReactorNames } from '../../hooks/useReactorNames'
import { type CardFormValue, useAdapterData } from '../CardFormContext'

/** Votes on the card itself, counted apart from the reactions on its comments. */
export function ReactionsSection({ disabled }: BuiltinFieldProps) {
    const data = useAdapterData(disabled)
    if (data?.mode !== 'card') return null
    return <Reactions data={data} />
}

/** Gated on the role, never on `disabled`: a commenter reacts on a read-only card. */
function Reactions({ data }: { data: CardFormValue }) {
    const { card, projectId, canComment } = data
    const { reactions, toggleReaction } = useCardReactions(projectId, card.id)
    const reactorName = useReactorNames()
    // Non-throwing: a card opened from the public board has no session.
    const { user } = useAuth({ throwIfAnon: false })
    return (
        <ReactionBar
            groups={reactions}
            targetId={card.id}
            canReact={canComment}
            onToggle={toggleReaction}
            nameFor={reactorName}
            currentUserId={user?.id ?? ''}
            testIDPrefix="boards-card-reaction"
        />
    )
}
