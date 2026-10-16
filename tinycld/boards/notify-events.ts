import type { PackageNotifyEvents } from '@tinycld/core/lib/notify/registry'

declare module '@tinycld/core/lib/notify/events' {
    interface NotificationEvents {
        'boards.attachment_failed': { card: string; name: string }
        // Emitted by the card face when a type hides Attachments; the emit lands with the forms branch.
        'boards.attachment_refused': { card: string; name: string }
        'boards.card_moved': { board: string; key: string }
        'boards.sprint_completed': { sprint: string; completed: number; rolled: number }
    }
}

/** Policy for boards' user-facing notifications; core composes these at boot. */
const notifyEvents = {
    'boards.attachment_failed': { channels: ['toast'], variant: 'error' },
    'boards.attachment_refused': { channels: ['toast'], variant: 'warning' },
    'boards.card_moved': { channels: ['toast'], variant: 'success' },
    'boards.sprint_completed': { channels: ['toast'], variant: 'success' },
} satisfies PackageNotifyEvents

export default notifyEvents
