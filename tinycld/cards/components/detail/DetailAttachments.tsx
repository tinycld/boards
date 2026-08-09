import { downloadFile } from '@tinycld/core/file-viewer/file-url'
import { PreviewModal } from '@tinycld/core/file-viewer/PreviewModal'
import { type PickedFile, webFileToPickedFile } from '@tinycld/core/file-viewer/picked-file'
import { getPreviewActionFactories } from '@tinycld/core/file-viewer/preview-action-registry'
import { Thumbnail } from '@tinycld/core/file-viewer/Thumbnail'
import {
    type UploadingFile,
    uploadProgress,
    useUploadsForScope,
} from '@tinycld/core/file-viewer/upload-store'
import { usePickFiles } from '@tinycld/core/file-viewer/use-pick-files'
import { useAuth } from '@tinycld/core/lib/auth'
import { formatBytes } from '@tinycld/core/lib/format-utils'
import { useThemeColor } from '@tinycld/core/lib/use-app-theme'
import { ConfirmDialog } from '@tinycld/core/ui/ConfirmDialog'
import { Image } from 'expo-image'
import { Paperclip, Plus, Trash2, X } from 'lucide-react-native'
import { useState } from 'react'
import { Platform, Pressable, Text, View } from 'react-native'
import { useAttachmentMutations } from '../../hooks/useAttachmentMutations'
import { attachmentToSource } from '../../lib/attachment-source'
import type { BoardAttachment } from '../../types'

const THUMB_SIZE = 56

interface DetailAttachmentsProps {
    attachments: BoardAttachment[]
    cardId: string
    projectId: string
    canEdit: boolean
    isOwner: boolean
}

export function DetailAttachments({
    attachments,
    cardId,
    projectId,
    canEdit,
    isOwner,
}: DetailAttachmentsProps) {
    // Read here rather than taken as a prop, matching DetailActivity — the
    // uploader-may-delete check is this section's own business.
    const { user } = useAuth()
    const currentUserId = user?.id ?? ''
    const { uploadFiles, deleteAttachment, dismissUpload } = useAttachmentMutations(
        cardId,
        projectId,
        currentUserId
    )
    const uploads = useUploadsForScope(cardId)
    const { pickFiles, ActionSheetElement } = usePickFiles()
    const mutedColor = useThemeColor('muted')

    const [previewIndex, setPreviewIndex] = useState<number | null>(null)
    const [pendingDelete, setPendingDelete] = useState<BoardAttachment | null>(null)

    // Registered by whoever is installed — drive contributes "Save to Drive"
    // when present, and the list is simply empty when it isn't. Cards
    // references no other package to get this.
    const previewActions = getPreviewActionFactories().map(factory => factory())

    // Like the checklist, the section exists to hold its own composer — with
    // no composer and nothing attached there is only a heading over nothing.
    if (!canEdit && attachments.length === 0) return null

    const sources = attachments.map(attachmentToSource)
    const activeSource = previewIndex === null ? null : (sources[previewIndex] ?? null)

    // An upload's placeholder id IS the record id it was posted under, so once
    // the live query delivers that row the placeholder is a duplicate of it —
    // same name, same everything — and must stop being drawn immediately. The
    // store's own timer is only a backstop for a row that never arrives.
    const settled = new Set(attachments.map(a => a.id))
    const inFlight = uploads.filter(u => !settled.has(u.id))

    const attach = async () => {
        const picked = await pickFiles({ multiple: true })
        if (picked.length > 0) await uploadFiles(picked)
    }

    const confirmDelete = () => {
        if (!pendingDelete) return
        deleteAttachment.mutate(pendingDelete.id, { onSuccess: () => setPendingDelete(null) })
    }

    return (
        <View className="mb-6">
            <View className="flex-row items-center gap-2 mb-2.5">
                <Text className="text-[13px] font-semibold text-foreground">Attachments</Text>
                {attachments.length > 0 ? (
                    <Text className="text-[12px] font-medium text-muted">{attachments.length}</Text>
                ) : null}
            </View>

            {attachments.map((attachment, index) => (
                <AttachmentRow
                    key={attachment.id}
                    attachment={attachment}
                    onOpen={() => setPreviewIndex(index)}
                    // Mirrors the delete rule exactly: uploader or project owner.
                    canDelete={isOwner || attachment.uploadedBy.id === currentUserId}
                    onDelete={() => setPendingDelete(attachment)}
                />
            ))}

            {inFlight.map(upload => (
                <UploadRow
                    key={upload.id}
                    upload={upload}
                    onDismiss={() => dismissUpload(upload.id)}
                />
            ))}

            {canEdit ? (
                <Pressable
                    onPress={attach}
                    accessibilityRole="button"
                    accessibilityLabel="Attach file"
                    testID="cards-attach-file"
                    className="flex-row items-center gap-1.5 mt-1 py-1.5 active:opacity-60"
                >
                    <Plus size={14} color={mutedColor} strokeWidth={2.2} />
                    <Text className="text-[13px] text-muted">Attach file</Text>
                </Pressable>
            ) : null}

            {ActionSheetElement}

            <PreviewModal
                isVisible={activeSource !== null}
                source={activeSource}
                onClose={() => setPreviewIndex(null)}
                onNext={
                    previewIndex !== null && previewIndex < sources.length - 1
                        ? () => setPreviewIndex(previewIndex + 1)
                        : undefined
                }
                onPrevious={
                    previewIndex !== null && previewIndex > 0
                        ? () => setPreviewIndex(previewIndex - 1)
                        : undefined
                }
                onDownload={activeSource ? () => downloadFile(activeSource) : undefined}
                actions={previewActions}
            />

            <ConfirmDialog
                isOpen={pendingDelete !== null}
                onClose={() => setPendingDelete(null)}
                onConfirm={confirmDelete}
                title="Delete attachment?"
                message={`"${pendingDelete?.displayName ?? ''}" will be permanently deleted.`}
                confirmLabel="Delete"
                isDestructive
                isSubmitting={deleteAttachment.isPending}
            />
        </View>
    )
}

interface AttachmentRowProps {
    attachment: BoardAttachment
    onOpen: () => void
    canDelete: boolean
    onDelete: () => void
}

function AttachmentRow({ attachment, onOpen, canDelete, onDelete }: AttachmentRowProps) {
    const mutedColor = useThemeColor('muted')

    return (
        <View className="flex-row items-center gap-3 py-1.5">
            {/* The flex lives on the TEXTS, not on a wrapping View —
                react-native-web collapses a Text to its container's width, so
                a name inside a nested flex column that never resolves to a
                real width renders as a sliver or vanishes outright. Putting
                `flex-1` on the Text is what ChecklistTitle already does, and
                it is the shape that works here. */}
            <Pressable
                onPress={onOpen}
                accessibilityRole="button"
                accessibilityLabel={`Open ${attachment.displayName}`}
                className="flex-row items-center gap-3 flex-1 active:opacity-70"
            >
                <Thumbnail source={attachmentToSource(attachment)} size={THUMB_SIZE} />
                {/* `minWidth: 0` is load-bearing and cannot come from the
                    className. react-native-web renders a Text as a
                    `display: block` element carrying `min-width: auto`, and
                    `flex-1` sets `flex-basis: 0` — so the name resolves to
                    width ZERO and disappears while the size text is pushed off
                    the end of the row. Measured in the running app: the button
                    was 413px wide and the Text inside it 0. */}
                <Text
                    numberOfLines={1}
                    style={{ minWidth: 0 }}
                    className="flex-1 text-[13px] text-foreground"
                >
                    {attachment.displayName}
                </Text>
                <Text numberOfLines={1} className="text-[11px] text-muted shrink-0">
                    {formatBytes(attachment.size)} · {attachment.uploadedBy.firstName}
                </Text>
            </Pressable>
            {canDelete ? (
                <Pressable
                    onPress={onDelete}
                    accessibilityRole="button"
                    accessibilityLabel={`Delete ${attachment.displayName}`}
                    className="p-1.5 shrink-0 active:opacity-60"
                >
                    <Trash2 size={14} color={mutedColor} strokeWidth={2.2} />
                </Pressable>
            ) : null}
        </View>
    )
}

/**
 * A file still going up.
 *
 * An image shows the picture itself from the local URI, so a drop is
 * acknowledged with the thing that was dropped rather than a generic row;
 * the bar sits directly beneath it. Anything else gets a paperclip in the
 * same footprint, so the list does not jump when the real row replaces it.
 */
function UploadRow({ upload, onDismiss }: { upload: UploadingFile; onDismiss: () => void }) {
    const mutedColor = useThemeColor('muted')
    const isError = upload.status === 'error'
    const progress = uploadProgress(upload)

    return (
        <View className="flex-row items-center gap-3 py-1.5">
            <View
                className="rounded-md overflow-hidden bg-foreground/[0.06] items-center justify-center shrink-0"
                style={{ width: THUMB_SIZE, height: THUMB_SIZE }}
            >
                {upload.previewUri ? (
                    <Image
                        source={{ uri: upload.previewUri }}
                        style={{ width: THUMB_SIZE, height: THUMB_SIZE }}
                        contentFit="cover"
                    />
                ) : (
                    <Paperclip size={18} color={mutedColor} strokeWidth={2.2} />
                )}
            </View>

            {/* This row DOES need a column — the bar sits under the name — so
                unlike the settled row it keeps a wrapping View. `flex-1` on
                the View plus a full-width Text inside is what gives the Text a
                container width to resolve against. */}
            <View className="flex-1">
                <Text numberOfLines={1} className="w-full text-[13px] text-foreground">
                    {upload.name}
                </Text>
                {isError ? (
                    <Text numberOfLines={1} className="text-[11px] text-destructive">
                        {upload.errorMessage ?? 'Upload failed'}
                    </Text>
                ) : (
                    <>
                        <View
                            className="h-1 rounded-sm bg-foreground/[0.06] mt-1 overflow-hidden"
                            accessibilityRole="progressbar"
                            accessibilityLabel={`Uploading ${upload.name}`}
                            accessibilityValue={{
                                now: Math.round(progress * 100),
                                min: 0,
                                max: 100,
                            }}
                            testID={`cards-upload-progress-${upload.name}`}
                        >
                            <View
                                className="h-full rounded-sm bg-primary"
                                style={{ width: `${progress * 100}%` }}
                            />
                        </View>
                        <Text className="text-[11px] text-muted mt-0.5">
                            {upload.status === 'done'
                                ? 'Uploaded'
                                : `${formatBytes(upload.loaded)} of ${formatBytes(upload.size)}`}
                        </Text>
                    </>
                )}
            </View>

            {isError ? (
                <Pressable
                    onPress={onDismiss}
                    accessibilityRole="button"
                    accessibilityLabel={`Dismiss ${upload.name}`}
                    className="p-1.5 shrink-0 active:opacity-60"
                >
                    <X size={14} color={mutedColor} strokeWidth={2.2} />
                </Pressable>
            ) : null}
        </View>
    )
}

/** Converts web `File`s from a drop into the picker's shape. */
export function filesToPicked(files: File[]): PickedFile[] {
    if (Platform.OS !== 'web') return []
    return files.map(webFileToPickedFile)
}
