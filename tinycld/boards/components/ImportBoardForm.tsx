import type { PickedFile } from '@tinycld/core/file-viewer/picked-file'
import { usePickFiles } from '@tinycld/core/file-viewer/use-pick-files'
import { Button, ButtonText } from '@tinycld/core/ui/button'
import { FileUp } from 'lucide-react-native'
import { useState } from 'react'
import { Pressable, ScrollView, Text, View } from 'react-native'
import { type BoardImportResult, importCaveats, useBoardImport } from '../hooks/useBoardImport'

interface ImportBoardFormProps {
    onClose: () => void
    onImported: (projectId: string) => void
}

/**
 * Create a board from a Trello export or a board export.
 *
 * Two steps rather than one: pick a file and import it, then read what the
 * import had to guess or drop before leaving. The second step is the point —
 * an import that silently drops every assignee and guesses four column statuses
 * is a board someone will misread for weeks otherwise.
 */
export function ImportBoardForm({ onClose, onImported }: ImportBoardFormProps) {
    const [picked, setPicked] = useState<PickedFile | null>(null)
    const [result, setResult] = useState<BoardImportResult | null>(null)
    const { pickFiles } = usePickFiles()
    const importBoard = useBoardImport()

    const choose = async () => {
        const files = await pickFiles({ mimeTypes: ['application/json'] })
        if (files.length > 0) setPicked(files[0])
    }

    const start = () => {
        if (!picked) return
        importBoard.mutate({ file: picked }, { onSuccess: setResult })
    }

    if (result) {
        return (
            <ImportSummary
                result={result}
                onDone={() => {
                    onImported(result.projectId)
                    onClose()
                }}
            />
        )
    }

    return (
        <View className="px-5 pb-5 gap-3">
            <Text className="text-[12px] text-muted">
                Choose a Trello export, or a board exported from here. The import creates a new
                board that you own.
            </Text>

            <Pressable
                accessibilityRole="button"
                testID="boards-import-pick"
                onPress={choose}
                className="flex-row items-center gap-2.5 rounded-lg border border-dashed border-border p-3"
            >
                <FileUp size={18} className="text-muted" />
                <Text className="text-[13px] text-foreground flex-1" numberOfLines={1}>
                    {picked ? picked.name : 'Choose a file…'}
                </Text>
            </Pressable>

            <View className="flex-row justify-end gap-2 pt-2">
                <Pressable onPress={onClose} className="px-3 py-1.5" accessibilityRole="button">
                    <Text className="text-[13px] text-muted">Cancel</Text>
                </Pressable>
                <Button
                    onPress={start}
                    isDisabled={!picked || importBoard.isPending}
                    size="sm"
                    testID="boards-import-confirm"
                >
                    <ButtonText>{importBoard.isPending ? 'Importing…' : 'Import'}</ButtonText>
                </Button>
            </View>
        </View>
    )
}

/**
 * What arrived, and what did not.
 *
 * The caveats are listed rather than counted, and the dialog does not close on
 * its own — this is the only moment the information exists, and a toast that
 * vanishes in six seconds is not where it belongs.
 */
function ImportSummary({ result, onDone }: { result: BoardImportResult; onDone: () => void }) {
    const caveats = importCaveats(result)

    return (
        <View className="px-5 pb-5 gap-3">
            <Text className="text-[13px] text-foreground">
                Imported <Text className="font-semibold">{result.name}</Text> — {result.lists}{' '}
                columns, {result.cards} cards, {result.labels} labels.
            </Text>

            <CaveatList caveats={caveats} />

            <View className="flex-row justify-end pt-2">
                <Button onPress={onDone} size="sm" testID="boards-import-done">
                    <ButtonText>Open the board</ButtonText>
                </Button>
            </View>
        </View>
    )
}

function CaveatList({ caveats }: { caveats: string[] }) {
    if (caveats.length === 0) return null

    return (
        <ScrollView className="max-h-[160px]">
            <View className="gap-1.5 rounded-lg bg-foreground/5 p-3">
                {caveats.map(caveat => (
                    <Text key={caveat} className="text-[12px] text-muted">
                        {caveat}
                    </Text>
                ))}
            </View>
        </ScrollView>
    )
}
