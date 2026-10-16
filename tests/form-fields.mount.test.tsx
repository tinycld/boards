// @vitest-environment happy-dom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { BuiltinFieldProps } from '@tinycld/core/lib/forms/host-ui'
import { appHref } from '@tinycld/core/lib/org-routes'
import { OverlayProvider } from '@tinycld/core/ui/overlay'
import { router } from 'expo-router'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { BoardCardView, BoardEpic } from '../tinycld/boards/types'

afterEach(cleanup)

// The card's host components read the open card from CardFormProvider and
// render the same pickers the properties block does. Mounted over local-only
// collections (the attachments section reads the card's children query).

vi.mock('@tinycld/core/lib/auth', () => ({
    useAuth: () => ({ user: { id: 'u1' }, isLoggedIn: true }),
}))

// The card row the priority field writes, kept to read back what it wrote.
const held = vi.hoisted(() => ({
    cards: undefined as
        | {
              get: (id: string) => { priority?: string } | undefined
              update: (id: string, change: (draft: { priority: string }) => void) => unknown
          }
        | undefined,
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
    held.cards = stores.boards_cards as typeof held.cards
    return { useStore: (...names: string[]) => names.map(n => stores[n]) }
})

import { DetailLinks } from '../tinycld/boards/components/detail/DetailLinks'
import { CardFormProvider, type CardFormValue } from '../tinycld/boards/forms/CardFormContext'
import { CreateCardProvider, type CreateCardValue } from '../tinycld/boards/forms/CreateCardContext'
import { DueField } from '../tinycld/boards/forms/fields/DueField'
import { EpicField } from '../tinycld/boards/forms/fields/EpicField'
import { PriorityField } from '../tinycld/boards/forms/fields/PriorityField'
import { SprintField } from '../tinycld/boards/forms/fields/SprintField'
import { AttachmentsSection } from '../tinycld/boards/forms/sections/AttachmentsSection'
import { ChecklistSection } from '../tinycld/boards/forms/sections/ChecklistSection'
import { SectionChipsSection } from '../tinycld/boards/forms/sections/SectionChipsSection'
import { SubtasksSection } from '../tinycld/boards/forms/sections/SubtasksSection'
import * as cardMutations from '../tinycld/boards/hooks/useCardMutations'
import type { CardLinkView } from '../tinycld/boards/lib/card-links'
import { formatSchedule } from '../tinycld/boards/lib/due-time'
import { useBoardsUIStore } from '../tinycld/boards/stores/boards-ui-store'

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

function cardForm(canEdit: boolean, overrides: Partial<CardFormValue> = {}): CardFormValue {
    return {
        card,
        variant: 'peek',
        projectId: 'p1',
        projectSlug: 'OTTER',
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
        ...overrides,
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

function mountCard(ui: ReactNode, overrides: Partial<CardFormValue> = {}) {
    const queryClient = new QueryClient()
    return render(
        <QueryClientProvider client={queryClient}>
            <OverlayProvider>
                <CardFormProvider value={cardForm(true, overrides)}>{ui}</CardFormProvider>
            </OverlayProvider>
        </QueryClientProvider>
    )
}

function mountCreate(ui: ReactNode, overrides: Partial<CreateCardValue> = {}) {
    const queryClient = new QueryClient()
    const value: CreateCardValue = {
        labels: [],
        epics: [],
        sprints: [],
        sprintsEnabled: false,
        members: [],
        ...overrides,
    }
    return render(
        <QueryClientProvider client={queryClient}>
            <CreateCardProvider value={value}>{ui}</CreateCardProvider>
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

    it('edits the form value with no card or board behind the form', () => {
        // The form builder's preview: neither provider is above the field.
        const queryClient = new QueryClient()
        const { container } = render(
            <QueryClientProvider client={queryClient}>
                <PriorityField {...fieldProps('priority')} value="high" />
            </QueryClientProvider>
        )
        expect(pressableAround(container, 'High')).not.toBeNull()
    })
})

describe('card mutations', () => {
    beforeEach(() => {
        held.cards?.update('c1', draft => {
            draft.priority = 'low'
        })
    })

    it('create mode mounts no card mutation', () => {
        const spy = vi.spyOn(cardMutations, 'useUpdateCard')
        mountCreate(<PriorityField {...fieldProps('priority')} />)
        expect(spy).not.toHaveBeenCalled()
        spy.mockRestore()
    })

    it('pressing a priority option writes the card row', async () => {
        mountCard(<PriorityField {...fieldProps('priority')} />, {
            card: { ...card, priority: 'low' },
        })
        fireEvent.click(screen.getByText('Low'))
        fireEvent.click(await screen.findByText('High'))
        await waitFor(() => expect(held.cards?.get('c1')?.priority).toBe('high'))
    })

    it('a disabled field ignores presses', async () => {
        mountCard(<PriorityField {...fieldProps('priority', true)} />, {
            card: { ...card, priority: 'low' },
        })
        fireEvent.click(screen.getByText('Low'))
        await new Promise(resolve => setTimeout(resolve, 0))
        expect(screen.queryByText('High')).toBeNull()
        expect(held.cards?.get('c1')?.priority).not.toBe('high')
    })

    it('EpicField renders nothing without epics and a picker with them', () => {
        const none = mountCreate(<EpicField {...fieldProps('epic')} />)
        expect(none.container.textContent).toBe('')
        cleanup()

        const epics = [{ id: 'e1', title: 'Launch' }] as unknown as BoardEpic[]
        mountCreate(<EpicField {...fieldProps('epic')} />, { epics })
        expect(screen.getByText('Add to epic')).toBeTruthy()
    })

    it('SprintField renders nothing when sprints are off', () => {
        const { container } = mountCreate(<SprintField {...fieldProps('sprint')} />)
        expect(container.textContent).toBe('')
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

// A row inside an open card opens its card where the reader is: on the full
// page as the next card's page, stacked so Back returns; on the peek through
// the store. Sub-task and link rows share the opener; both are pinned.
describe('opening a sub-task', () => {
    const child: BoardCardView = {
        ...card,
        id: 'c2',
        key: 'OTTER-8',
        number: 8,
        title: 'Child',
        parent: 'c1',
    }
    const parent: BoardCardView = { ...card, subtaskTotal: 1 }

    function mountSubtasks(variant: CardFormValue['variant']) {
        mountCard(<SubtasksSection {...fieldProps('subtasks')} />, {
            variant,
            card: parent,
            projectCards: [parent, child],
            canEdit: false,
        })
    }

    afterEach(() => {
        useBoardsUIStore.getState().closeCard()
        vi.mocked(router.push).mockClear()
    })

    it('pushes the sub-task’s page from the full page', () => {
        mountSubtasks('page')
        fireEvent.click(screen.getByText('Child'))
        expect(router.push).toHaveBeenCalledWith(appHref('boards/OTTER/8'))
        expect(useBoardsUIStore.getState().openCardId).toBeNull()
    })

    it('opens the sub-task through the store from the peek', () => {
        mountSubtasks('peek')
        fireEvent.click(screen.getByText('Child'))
        expect(useBoardsUIStore.getState().openCardId).toBe('c2')
        expect(router.push).not.toHaveBeenCalled()
    })
})

describe('opening a linked card', () => {
    const far: BoardCardView = { ...card, id: 'c2', key: 'OTTER-8', number: 8, title: 'Far card' }
    const link: CardLinkView = {
        id: 'k1',
        type: 'related',
        label: 'Related to',
        far: { state: 'resolved', card: far },
        farCardId: far.id,
    }

    function mountLinks(variant: CardFormValue['variant']) {
        mountCard(
            <DetailLinks
                card={card}
                links={[link]}
                addLink={() => {}}
                removeLink={() => {}}
                isAddingLink={false}
                cardsById={new Map([[far.id, far]])}
                pickerCards={[card, far]}
                projectId="p1"
                canEdit={false}
                isVisible
                isComposing={false}
                onComposingChange={() => {}}
            />,
            { variant, canEdit: false }
        )
    }

    afterEach(() => {
        useBoardsUIStore.getState().closeCard()
        vi.mocked(router.push).mockClear()
    })

    it('pushes the far card’s page from the full page', () => {
        mountLinks('page')
        fireEvent.click(screen.getByText('Far card'))
        expect(router.push).toHaveBeenCalledWith(appHref('boards/OTTER/8'))
        expect(useBoardsUIStore.getState().openCardId).toBeNull()
    })

    it('opens the far card through the store from the peek', () => {
        mountLinks('peek')
        fireEvent.click(screen.getByText('Far card'))
        expect(useBoardsUIStore.getState().openCardId).toBe('c2')
        expect(router.push).not.toHaveBeenCalled()
    })
})
