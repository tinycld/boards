import { Button, ButtonText } from '@tinycld/core/ui/button'
import { Modal, ModalBackdrop, ModalContent } from '@tinycld/core/ui/modal'
import { FileJson, FileSpreadsheet } from 'lucide-react-native'
import { useState } from 'react'
import { Pressable, Text, View } from 'react-native'
import { type BoardExportFormat, useBoardExport } from '../hooks/useBoardExport'

interface ExportBoardDialogProps {
    isVisible: boolean
    onClose: () => void
    projectId: string
    boardName: string
}

interface FormatOption {
    format: BoardExportFormat
    label: string
    hint: string
    icon: typeof FileJson
}

/**
 * The two formats, described by what they are FOR rather than by what they
 * contain — someone picking one is choosing a destination, not a serialization.
 */
const OPTIONS: FormatOption[] = [
    {
        format: 'csv',
        label: 'Spreadsheet (CSV)',
        hint: 'One row per card. Opens in Excel, Numbers or Sheets.',
        icon: FileSpreadsheet,
    },
    {
        format: 'json',
        label: 'Full backup (JSON)',
        hint: 'The whole board, including checklists and comments.',
        icon: FileJson,
    },
]

function FormatRow({
    option,
    isSelected,
    onSelect,
}: {
    option: FormatOption
    isSelected: boolean
    onSelect: () => void
}) {
    const Icon = option.icon
    return (
        <Pressable
            accessibilityRole="radio"
            accessibilityState={{ selected: isSelected }}
            accessibilityLabel={option.label}
            testID={`boards-export-${option.format}`}
            onPress={onSelect}
            className={`flex-row items-start gap-3 rounded-lg border p-3 ${
                isSelected ? 'border-primary bg-primary/5' : 'border-border'
            }`}
        >
            <Icon size={18} className="text-foreground mt-0.5" />
            <View className="flex-1">
                <Text className="text-[13px] font-medium text-foreground">{option.label}</Text>
                <Text className="text-[12px] text-muted mt-0.5">{option.hint}</Text>
            </View>
        </Pressable>
    )
}

/**
 * Export a board to a file.
 *
 * Archived cards travel in both formats and are flagged rather than dropped:
 * an export doubles as a backup, and a file that quietly omitted the archive
 * would misrepresent the board to whoever reads it as one.
 */
export function ExportBoardDialog({
    isVisible,
    onClose,
    projectId,
    boardName,
}: ExportBoardDialogProps) {
    if (!isVisible) return null

    return (
        <Modal isOpen onClose={onClose}>
            <ModalBackdrop />
            <ModalContent className="w-[360px] p-0">
                <View className="px-5 pt-5 pb-3">
                    <Text className="text-[15px] font-semibold text-foreground">Export board</Text>
                </View>
                <ExportBoardForm projectId={projectId} boardName={boardName} onClose={onClose} />
            </ModalContent>
        </Modal>
    )
}

/**
 * A child component so it unmounts with the dialog — that resets the chosen
 * format on close without a manual reset, the same reason NewBoardDialog splits
 * its form out.
 */
function ExportBoardForm({
    projectId,
    boardName,
    onClose,
}: {
    projectId: string
    boardName: string
    onClose: () => void
}) {
    const [format, setFormat] = useState<BoardExportFormat>('csv')
    const exportBoard = useBoardExport()

    // Closed on success only. A failed export leaves the dialog up with the
    // toast beside it, so the retry is one press rather than reopening the menu.
    const onExport = () =>
        exportBoard.mutate({ projectId, boardName, format }, { onSuccess: onClose })

    return (
        <View className="px-5 pb-5 gap-3">
            <View className="gap-2" accessibilityRole="radiogroup">
                {OPTIONS.map(option => (
                    <FormatRow
                        key={option.format}
                        option={option}
                        isSelected={format === option.format}
                        onSelect={() => setFormat(option.format)}
                    />
                ))}
            </View>

            <View className="flex-row justify-end gap-2 pt-2">
                <Pressable onPress={onClose} className="px-3 py-1.5" accessibilityRole="button">
                    <Text className="text-[13px] text-muted">Cancel</Text>
                </Pressable>
                <Button
                    onPress={onExport}
                    isDisabled={exportBoard.isPending}
                    size="sm"
                    testID="boards-export-confirm"
                >
                    <ButtonText>{exportBoard.isPending ? 'Exporting…' : 'Export'}</ButtonText>
                </Button>
            </View>
        </View>
    )
}
