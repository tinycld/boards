import { captureException, errorToString } from '@tinycld/core/lib/errors'
import { useMutation } from '@tinycld/core/lib/mutations'
import { notify } from '@tinycld/core/lib/notify'
import { pb } from '@tinycld/core/lib/pocketbase'
import { Platform } from 'react-native'

export type BoardExportFormat = 'csv' | 'json'

export interface BoardExportInput {
    projectId: string
    /** Names the downloaded file. The extension is added from the format. */
    boardName: string
    format: BoardExportFormat
}

const MIME: Record<BoardExportFormat, string> = {
    csv: 'text/csv',
    json: 'application/json',
}

/**
 * Download a board as a file.
 *
 * Fetched with `fetch` rather than `pb.send`, which parses every response as
 * JSON and would mangle a CSV. The bearer header is set by hand for the same
 * reason core's fetchRenderedHtml does it — this is a raw route, not a
 * collection read.
 *
 * The save itself cannot go through core's `downloadFromUrl`, which takes a URL
 * the platform fetches for itself: a browser anchor and expo-file-system's
 * downloader both issue their own unauthenticated request, and this endpoint
 * requires the bearer. So the bytes are fetched here, where the token is, and
 * handed to the platform afterwards — a Blob URL on web, a cache file plus the
 * share sheet on native, mirroring what downloadFromUrl does once it has them.
 */
export function useBoardExport() {
    return useMutation<void, Error, BoardExportInput>({
        mutationKey: ['boards', 'export'],
        mutationFn: async ({ projectId, boardName, format }: BoardExportInput) => {
            const query = new URLSearchParams({ project: projectId, format })
            const url = `${pb.baseURL.replace(/\/$/, '')}/api/boards/export?${query}`

            const headers: Record<string, string> = {}
            if (pb.authStore.token) {
                headers.Authorization = `Bearer ${pb.authStore.token}`
            }
            const response = await fetch(url, { method: 'GET', headers })
            if (!response.ok) {
                throw new Error(`Export failed: HTTP ${response.status}`)
            }

            const body = await response.text()
            await saveExport(body, exportFileName(boardName, format), MIME[format])
        },
        onError: (error: unknown) => {
            captureException('boards.export', error)
            notify.emit({
                event: 'mutation.error',
                title: 'Export failed',
                body: errorToString(error),
                durationMs: 6000,
                data: { operation: 'boards.export', error: errorToString(error) },
            })
        },
    })
}

/**
 * A board is named by a person, so it can carry a slash, a quote or a newline —
 * all of which either break a Content-Disposition header or escape a directory.
 * The server sanitizes its own filename the same way; this is the client's copy
 * for the name it gives the Blob or the cache file.
 */
export function exportFileName(boardName: string, format: BoardExportFormat): string {
    const stem = boardName
        .replace(/[^A-Za-z0-9._-]+/g, '-')
        .replace(/^[-.]+|[-.]+$/g, '')
        .toLowerCase()
    return `${stem || 'board'}.${format}`
}

async function saveExport(body: string, fileName: string, mimeType: string) {
    if (Platform.OS === 'web') {
        const href = URL.createObjectURL(new Blob([body], { type: mimeType }))
        const anchor = document.createElement('a')
        anchor.href = href
        anchor.download = fileName
        anchor.click()
        // Revoked on the next tick rather than immediately: Safari has not
        // finished reading the blob when click() returns, and revoking in the
        // same frame cancels the download it just started.
        setTimeout(() => URL.revokeObjectURL(href), 0)
        return
    }

    // Lazily imported for the reason core's file-url.ts documents: a
    // module-init failure in expo-file-system or expo-sharing would otherwise
    // propagate up the import graph of every screen that merely renders a
    // board menu.
    const [{ Directory, File, Paths }, Sharing] = await Promise.all([
        import('expo-file-system'),
        import('expo-sharing'),
    ])
    if (!(await Sharing.isAvailableAsync())) {
        throw new Error('Sharing is not available on this device')
    }
    // A unique subdirectory so repeated exports do not collide while the
    // user-facing filename stays the one the share sheet offers to save.
    const subdir = new Directory(Paths.cache, `boards-export-${Date.now()}`)
    subdir.create({ intermediates: true, idempotent: true })
    const target = new File(subdir, fileName)
    target.create()
    target.write(body)
    await Sharing.shareAsync(target.uri, { mimeType, dialogTitle: fileName })
}
