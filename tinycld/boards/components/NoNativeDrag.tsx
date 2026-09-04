import type { ReactNode } from 'react'
import { Platform } from 'react-native'

/**
 * Suppresses the browser's native HTML5 drag on web. Text selected inside a
 * card (or any future image content) would otherwise start a browser
 * ghost-drag before Drax's pointer gesture activates — stealing the gesture.
 * Cancelling `dragstart` on a wrapping element stops any native drag that
 * begins inside the card, leaving Drax's pointer gesture as the only drag.
 * `display: contents` keeps layout untouched; the event still bubbles to this
 * wrapper. No-op on native. (Copied from drive's DraggableDriveItem.)
 */
export function NoNativeDrag({ children }: { children: ReactNode }) {
    if (Platform.OS !== 'web') return <>{children}</>
    return (
        <div
            role="presentation"
            style={{ display: 'contents' }}
            onDragStartCapture={e => e.preventDefault()}
        >
            {children}
        </div>
    )
}
