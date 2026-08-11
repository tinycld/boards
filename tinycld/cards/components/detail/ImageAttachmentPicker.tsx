import { Thumbnail } from '@tinycld/core/file-viewer/Thumbnail'
import { useThemeColor } from '@tinycld/core/lib/use-app-theme'
import { Modal, ModalBackdrop, ModalContent } from '@tinycld/core/ui/modal'
import { Upload } from 'lucide-react-native'
import { Pressable, ScrollView, Text, View } from 'react-native'
import { attachmentToSource } from '../../lib/attachment-source'
import { isImageAttachment } from '../../lib/description-image'
import type { BoardAttachment } from '../../types'

const THUMB_SIZE = 40

interface ImageAttachmentPickerProps {
    isOpen: boolean
    onClose: () => void
    /** The card's full attachment list; only images are offered. */
    attachments: BoardAttachment[]
    /** Insert the chosen attachment into the description at the caret. */
    onPick: (attachment: BoardAttachment) => void
    /** Pick a new image from the OS, upload it, and insert it. */
    onUploadNew: () => void
}

/**
 * Chooser behind the description toolbar's image button: the card's image
 * attachments plus an upload action, both funneling into one insert path.
 *
 * Deliberately NOT mounted inside DescriptionToolbar — the toolbar renders
 * only while the editor is focused, and this dialog taking focus blurs the
 * editor, so a dialog owned by the toolbar would unmount itself the moment it
 * opened. useDescriptionEditor owns it (and keeps the toolbar row alive while
 * it is open).
 */
export function ImageAttachmentPicker({
    isOpen,
    onClose,
    attachments,
    onPick,
    onUploadNew,
}: ImageAttachmentPickerProps) {
    const mutedColor = useThemeColor('muted-foreground')
    if (!isOpen) return null

    const images = attachments.filter(isImageAttachment)

    return (
        <Modal isOpen onClose={onClose}>
            <ModalBackdrop />
            <ModalContent className="w-[360px] p-4 gap-3">
                <Text className="text-foreground" style={{ fontSize: 20, fontWeight: '600' }}>
                    Insert image
                </Text>
                <ImageList images={images} onPick={onPick} />
                <Pressable
                    onPress={onUploadNew}
                    accessibilityRole="button"
                    accessibilityLabel="Upload image"
                    testID="cards-image-picker-upload"
                    className="flex-row items-center gap-3 py-2 active:opacity-70"
                >
                    <View className="w-[40px] h-[40px] rounded-lg border border-border border-dashed items-center justify-center">
                        <Upload size={16} color={mutedColor} />
                    </View>
                    <Text className="text-[13px] text-foreground">Upload image</Text>
                </Pressable>
                <View className="flex-row justify-end">
                    <Pressable onPress={onClose} className="px-3 py-2">
                        <Text className="text-foreground" style={{ fontSize: 13 }}>
                            Cancel
                        </Text>
                    </Pressable>
                </View>
            </ModalContent>
        </Modal>
    )
}

function ImageList({
    images,
    onPick,
}: {
    images: BoardAttachment[]
    onPick: (attachment: BoardAttachment) => void
}) {
    if (images.length === 0) {
        return <Text className="text-[13px] text-muted">No image attachments yet.</Text>
    }
    return (
        <ScrollView style={{ maxHeight: 280 }}>
            {images.map(attachment => (
                <Pressable
                    key={attachment.id}
                    onPress={() => onPick(attachment)}
                    accessibilityRole="button"
                    accessibilityLabel={`Insert ${attachment.displayName}`}
                    testID={`cards-image-picker-${attachment.id}`}
                    className="flex-row items-center gap-3 py-1.5 active:opacity-70"
                >
                    <Thumbnail source={attachmentToSource(attachment)} size={THUMB_SIZE} />
                    <Text
                        numberOfLines={1}
                        style={{ minWidth: 0 }}
                        className="flex-1 text-[13px] text-foreground"
                    >
                        {attachment.displayName}
                    </Text>
                </Pressable>
            ))}
        </ScrollView>
    )
}
