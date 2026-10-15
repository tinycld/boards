// @vitest-environment happy-dom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import type { BuiltinFieldProps } from '@tinycld/core/lib/forms/host-ui'
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { BoardCardView } from '../tinycld/boards/types'

afterEach(cleanup)

// The card's host components read the open card from CardFormProvider and
// render the same pickers the properties block does. Mounted over local-only
// collections (the attachments section reads the card's children query).

vi.mock('@tinycld/core/lib/auth', () => ({
    useAuth: () => ({ user: { id: 'u1' }, isLoggedIn: true }),
}))

vi.mock('@tinycld/core/lib/pocketbase', async () => {
    const { BasicIndex, createCollection, localOnlyCollectionOptions } = await import(
        '@tanstack/db'
    )
    const mk = (id: string, initialData: { id: string }[]) => {
        const collection = createCollection({
            ...localOnlyCollectionOptions({ id, getKey: (r: { id: string }) => r.id, initialData }),
            autoIndex: 'eager',
            defaultIndexType: BasicIndex,
        })
        return Object.assign(collection, { fetchRelations: () => collection })
    }
    const stores: Record<string, unknown> = {
        boards_cards: mk('boards_cards', [
            { id: 'c1', project: 'p1', title: 'Ship it', number: 7 },
        ]),
        boards_checklist_items: mk('boards_checklist_items', []),
        boards_comments: mk('boards_comments', []),
        boards_attachments: mk('boards_attachments', []),
        boards_activity: mk('boards_activity', []),
        boards_card_watchers: mk('boards_card_watchers', []),
        boards_comment_reactions: mk('boards_comment_reactions', []),
        boards_card_links: mk('boards_card_links', []),
        boards_pr_links: mk('boards_pr_links', []),
        users: mk('users', []),
    }
    return { useStore: (...names: string[]) => names.map(n => stores[n]) }
})

import { CardFormProvider, type CardFormValue } from '../tinycld/boards/forms/CardFormContext'
import { DueField } from '../tinycld/boards/forms/fields/DueField'
import { PriorityField } from '../tinycld/boards/forms/fields/PriorityField'
import { AttachmentsSection } from '../tinycld/boards/forms/sections/AttachmentsSection'
import { ChecklistSection } from '../tinycld/boards/forms/sections/ChecklistSection'
import { SectionChipsSection } from '../tinycld/boards/forms/sections/SectionChipsSection'
import { formatSchedule } from '../tinycld/boards/lib/due-time'

const card: BoardCardView = {
    id: 'c1',
    key: 'OTTER-7',
    number: 7,
    listId: 'l1',
    position: 'a0',
    title: 'Ship it',
    description: '',
    due: new Date(2030, 0, 15),
    dueHasTime: false,
    labels: [],
    assignees: [],
    priority: 'high',
    listCategory: 'todo',
    created: '',
    listChangedAt: '',
    checklistTotal: 0,
    checklistDone: 0,
    commentCount: 0,
    attachmentCount: 0,
    parent: '',
    parentKey: '',
    subtaskTotal: 0,
    subtaskDone: 0,
    epic: null,
    sprint: null,
}

// Formatted the way the chip formats it, so the test holds in any locale.
const dueLabel = formatSchedule(undefined, card.due, false)

function cardForm(canEdit: boolean): CardFormValue {
    return {
        card,
        projectId: 'p1',
        projectLabels: [],
        projectEpics: [],
        projectSprints: [],
        sprintsEnabled: false,
        projectMembers: [],
        projectCards: [card],
        projectLists: [{ id: 'l1', name: 'To do' }],
        canEdit,
        canComment: canEdit,
        isOwner: false,
        onManageLabels: () => {},
        isFieldVisible: () => true,
    }
}

function fieldProps(key: string, disabled = false): BuiltinFieldProps {
    return {
        fieldKey: key,
        label: key,
        recordId: card.id,
        value: undefined,
        onChange: () => {},
        mode: 'edit',
        disabled,
    }
}

function mount(ui: ReactNode, canEdit = true) {
    const queryClient = new QueryClient()
    return render(
        <QueryClientProvider client={queryClient}>
            <CardFormProvider value={cardForm(canEdit)}>{ui}</CardFormProvider>
        </QueryClientProvider>
    )
}

/** The pressable a piece of text sits in, or null when it is bare. */
function pressableAround(container: HTMLElement, text: string) {
    const node = [...container.querySelectorAll('rn-text')].find(el => el.textContent === text)
    if (!node) throw new Error(`no text "${text}"`)
    return node.closest('rn-pressable')
}

describe('card form fields', () => {
    it('renders the due date as the picker trigger, and bare when disabled', () => {
        const editable = mount(<DueField {...fieldProps('due')} />)
        expect(pressableAround(editable.container, dueLabel)).not.toBeNull()
        cleanup()

        const bare = mount(<DueField {...fieldProps('due', true)} />)
        expect(pressableAround(bare.container, dueLabel)).toBeNull()
        expect(bare.container.querySelector('rn-pressable')).toBeNull()
    })

    it('renders the priority as the picker trigger, and bare when disabled', () => {
        const editable = mount(<PriorityField {...fieldProps('priority')} />)
        expect(pressableAround(editable.container, 'High')).not.toBeNull()
        cleanup()

        const bare = mount(<PriorityField {...fieldProps('priority', true)} />)
        expect(pressableAround(bare.container, 'High')).toBeNull()
        expect(bare.container.querySelector('rn-pressable')).toBeNull()
    })

    it('renders nothing with no card behind the form', () => {
        const queryClient = new QueryClient()
        const { container } = render(
            <QueryClientProvider client={queryClient}>
                <PriorityField {...fieldProps('priority')} />
            </QueryClientProvider>
        )
        expect(container.innerHTML).toBe('')
    })
})

describe('optional sections', () => {
    /** The chip row beside the checklist, as the card's form lays them out. */
    function ChipsAndChecklist() {
        return (
            <>
                <SectionChipsSection {...fieldProps('chips')} />
                <ChecklistSection {...fieldProps('checklist')} />
                <AttachmentsSection {...fieldProps('attachments')} />
            </>
        )
    }

    it('offers an empty section as a chip, and pressing it opens the section', async () => {
        const { container, getByText } = mount(<ChipsAndChecklist />)
        await waitFor(() => expect(container.textContent).toContain('Checklist'))
        expect(container.querySelector('[testID="boards-section-heading-checklist"]')).toBeNull()
        expect(container.textContent).toContain('Attachments')

        fireEvent.click(getByText('Checklist'))
        await waitFor(() =>
            expect(
                container.querySelector('[testID="boards-section-heading-checklist"]')
            ).toBeTruthy()
        )
        // The opened section takes its chip's place; the others stay offered.
        expect(container.textContent).toContain('Attachments')
    })

    it('offers nothing to a reader when the card has no content', async () => {
        // An editor beside the reader shows when the card's children query
        // has settled, so the reader's empty subtree is the settled answer.
        const queryClient = new QueryClient()
        const { getByTestId } = render(
            <QueryClientProvider client={queryClient}>
                <div data-testid="editor">
                    <CardFormProvider value={cardForm(true)}>
                        <ChipsAndChecklist />
                    </CardFormProvider>
                </div>
                <div data-testid="reader">
                    <CardFormProvider value={cardForm(false)}>
                        <ChipsAndChecklist />
                    </CardFormProvider>
                </div>
            </QueryClientProvider>
        )
        await waitFor(() => expect(getByTestId('editor').textContent).toContain('Attachments'))
        expect(getByTestId('reader').textContent).toBe('')
    })
})
