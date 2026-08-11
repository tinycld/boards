import { ResponsiveToolbar, type ToolbarItem } from '@tinycld/core/components/ResponsiveToolbar'
import type { EditorCommands, EditorToolbarState } from '@tinycld/core/lib/editor/types'
import { useThemeColor } from '@tinycld/core/lib/use-app-theme'
import type { LucideIcon } from 'lucide-react-native'
import {
    Bold,
    Code,
    Heading1,
    Heading2,
    Heading3,
    Image as ImageIcon,
    Italic,
    Link2,
    List,
    ListOrdered,
    Quote,
    Underline,
} from 'lucide-react-native'
import { useMemo } from 'react'
import { Platform, Pressable, View } from 'react-native'

interface MarkdownToolbarProps {
    commands: EditorCommands
    toolbarState: EditorToolbarState
    /** False while the editor is unfocused or the viewer cannot write. */
    isVisible: boolean
    /**
     * Open the image chooser / link dialog. The dialogs themselves are owned
     * by the editor host (useDescriptionEditor / CommentEditor), NOT rendered
     * here: this toolbar unmounts on editor blur, and a dialog's input taking
     * focus IS a blur — a dialog mounted here closes itself the instant it
     * opens. The link dialog shipped with exactly that bug (visible for one
     * frame, then gone) before it was hoisted to match the image picker.
     */
    onOpenImagePicker: () => void
    onOpenLinkDialog: () => void
    /**
     * Row height for the buttons. The description keeps the default; the
     * inline comment editor passes a compact one so the toolbar fits the
     * fixed-height row it swaps into in place of the author line.
     */
    height?: number
    /**
     * Pinned to the right edge, never folded into the overflow menu — the
     * inline comment editor puts Save/Cancel here so the whole editing
     * session lives in one row.
     */
    rightItems?: ToolbarItem[]
}

/**
 * Formatting controls for the markdown surfaces — card descriptions and
 * comments.
 *
 * Every button here has a working command on web and native. That rules out
 * several the schema can still hold: strikethrough and task lists have no
 * command on `EditorCommands`, and tables/colors are `undefined` on web while
 * on native they are defined but land on a `default: break` in the WebView's
 * dispatcher — so a button for them would look enabled and do nothing.
 * (Images cleared that bar: `insertImage` works on both platforms, and the
 * button opens a chooser rather than toggling a mark, so it needs no active
 * state.)
 *
 * Buttons deliberately do not take focus (see FormatButton) — every command
 * acts on the editor's selection, and taking focus collapses it.
 */
export function MarkdownToolbar({
    commands,
    toolbarState,
    isVisible,
    onOpenImagePicker,
    onOpenLinkDialog,
    height = 38,
    rightItems,
}: MarkdownToolbarProps) {
    const iconColor = useThemeColor('muted-foreground')
    const activeColor = useThemeColor('primary')

    const items = useMemo<ToolbarItem[]>(() => {
        const button = (
            key: string,
            icon: LucideIcon,
            label: string,
            isActive: boolean,
            onPress: () => void
        ): ToolbarItem => ({
            type: 'custom',
            key,
            element: (
                <FormatButton
                    icon={icon}
                    accessibilityLabel={label}
                    isActive={isActive}
                    onPress={onPress}
                    iconColor={iconColor}
                    activeColor={activeColor}
                />
            ),
            // A custom item without these three vanishes at narrow widths
            // rather than folding into the overflow menu — and the peek panel
            // is exactly the narrow case this toolbar has to survive.
            overflowLabel: label,
            overflowIcon: icon,
            overflowPress: onPress,
        })

        const headingLevel = toolbarState.activeHeadingLevel ?? null

        return [
            button('bold', Bold, 'Bold', toolbarState.isBoldActive, () => commands.toggleBold()),
            button('italic', Italic, 'Italic', toolbarState.isItalicActive, () =>
                commands.toggleItalic()
            ),
            button('underline', Underline, 'Underline', toolbarState.isUnderlineActive, () =>
                commands.toggleUnderline()
            ),
            { type: 'separator' },
            button('h1', Heading1, 'Heading 1', headingLevel === 1, () =>
                commands.toggleHeading(1)
            ),
            button('h2', Heading2, 'Heading 2', headingLevel === 2, () =>
                commands.toggleHeading(2)
            ),
            button('h3', Heading3, 'Heading 3', headingLevel === 3, () =>
                commands.toggleHeading(3)
            ),
            { type: 'separator' },
            button('bullet', List, 'Bullet list', toolbarState.isBulletListActive, () =>
                commands.toggleBulletList()
            ),
            button('ordered', ListOrdered, 'Numbered list', toolbarState.isOrderedListActive, () =>
                commands.toggleOrderedList()
            ),
            { type: 'separator' },
            button('quote', Quote, 'Quote', toolbarState.isBlockquoteActive, () =>
                commands.toggleBlockquote()
            ),
            button('code', Code, 'Code', toolbarState.isCodeActive ?? false, () =>
                commands.toggleCode?.()
            ),
            button('link', Link2, 'Link', toolbarState.isLinkActive, onOpenLinkDialog),
            button('image', ImageIcon, 'Insert image', false, onOpenImagePicker),
        ]
    }, [commands, toolbarState, iconColor, activeColor, onOpenImagePicker, onOpenLinkDialog])

    if (!isVisible) return null

    return (
        // No vertical margin: this sits inside a fixed-height row that the
        // label also occupies, and any extra height here would reintroduce the
        // reflow that row exists to prevent. Stickiness lives on the row, not
        // on this — the row is the child that is always present to be pinned.
        <View className="border border-border rounded-[10px] bg-background">
            <ResponsiveToolbar items={items} rightItems={rightItems} height={height} />
        </View>
    )
}

interface FormatButtonProps {
    icon: LucideIcon
    accessibilityLabel: string
    isActive: boolean
    onPress: () => void
    iconColor: string
    activeColor: string
}

/**
 * One toolbar toggle.
 *
 * The `onMouseDown` guard is load-bearing on web: without it the press moves
 * DOM focus off ProseMirror, whose blur handler collapses the selection — so
 * Bold would apply to nothing. It also keeps this toolbar mounted, since it is
 * only rendered while the editor holds focus.
 */
function FormatButton({
    icon: Icon,
    accessibilityLabel,
    isActive,
    onPress,
    iconColor,
    activeColor,
}: FormatButtonProps) {
    const webProps =
        Platform.OS === 'web'
            ? { onMouseDown: (e: { preventDefault: () => void }) => e.preventDefault() }
            : {}

    return (
        <Pressable
            accessibilityRole="button"
            accessibilityLabel={accessibilityLabel}
            // `aria-pressed`, not accessibilityState: this react-native-web
            // build maps aria-* props straight through and ignores
            // accessibilityState entirely, so the latter would announce
            // nothing and leave no attribute for a test to read. A toggle is
            // also semantically "pressed" rather than "selected".
            aria-pressed={isActive}
            // The native screen-reader path reads this one; RN-Web ignores it.
            accessibilityState={{ selected: isActive }}
            onPress={onPress}
            {...webProps}
            className="rounded-md p-1.5"
            style={isActive ? { backgroundColor: `${activeColor}22` } : undefined}
            hitSlop={Platform.OS === 'web' ? undefined : { top: 6, bottom: 6, left: 4, right: 4 }}
        >
            <Icon size={16} color={isActive ? activeColor : iconColor} />
        </Pressable>
    )
}
