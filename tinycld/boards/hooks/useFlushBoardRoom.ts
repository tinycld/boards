import { log } from '@tinycld/core/lib/logger'
import { pb } from '@tinycld/core/lib/pocketbase'
import { useCallback } from 'react'

/** Must match `roomKindBoards` in boards/server/realtime.go. */
const ROOM_KIND = 'boards'

/**
 * Persist the board's live realtime state to `boards_cards.*` right now.
 *
 * The description editor is a WebView that LazyEditor mounts only for the
 * duration of a session; what replaces it is a READ VIEW rendering the
 * PocketBase record. Those are two different sources, and the record is
 * written by the server's save coordinator on a 3s debounce — so a card
 * reopened inside that window shows the placeholder rather than the words
 * just typed. Nothing is lost (the text is in the Y.Doc and in the server's
 * room), but the surface the reader is looking at has not heard about it.
 *
 * The room is keyed per BOARD, not per card, so closing a card never empties
 * it and the coordinator's teardown flush never fires. Ending a description
 * session is therefore the only moment that knows the read view is about to
 * become the thing on screen. Flushing here makes the record current before
 * anyone reads it.
 *
 * Fire-and-forget on purpose: the flush is an optimization of what the
 * debounce would do anyway, so a failure costs at most the 3s wait it was
 * skipping. Blocking the editor from closing on a network round-trip would
 * trade a stale read for a stuck UI.
 */
export function useFlushBoardRoom(projectId: string) {
    return useCallback(() => {
        if (!projectId) return
        void pb
            .send(`/api/realtime/${ROOM_KIND}/${encodeURIComponent(projectId)}/flush`, {
                method: 'POST',
            })
            .catch(err => {
                // The debounce still lands this within 3s; say so rather than
                // reporting an error for a write that is merely late.
                log.debug('boards.description', 'force flush failed; debounce will follow', {
                    projectId,
                    err: String(err),
                })
            })
    }, [projectId])
}
