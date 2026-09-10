import { eq } from '@tanstack/db'
import { HelpIcon } from '@tinycld/core/components/help/HelpIcon'
import { errorToString, handleMutationErrorsWithForm } from '@tinycld/core/lib/errors'
import { mutation, useMutation } from '@tinycld/core/lib/mutations'
import { PB_SERVER_ADDR, useStore } from '@tinycld/core/lib/pocketbase'
import { useToastStore } from '@tinycld/core/lib/stores/toast-store'
import { useThemeColor } from '@tinycld/core/lib/use-app-theme'
import { useOrgLiveQuery } from '@tinycld/core/lib/use-org-live-query'
import {
    type Control,
    FormErrorSummary,
    SelectInput,
    TextInput,
    useForm,
    z,
    zodResolver,
} from '@tinycld/core/ui/form'
import * as Clipboard from 'expo-clipboard'
import { Check, Copy, GitPullRequest, Trash2 } from 'lucide-react-native'
import { newRecordId } from 'pbtsdb/core'
import { Pressable, ScrollView, Text, View } from 'react-native'
import { useCopiedFlag } from '../hooks/useCopiedFlag'
import { canRemoveRepo } from '../lib/repo-permissions'

const repoSchema = z.object({
    project: z.string().min(1, 'Choose a board'),
    owner: z
        .string()
        .min(1, 'Owner is required')
        .regex(/^[a-zA-Z0-9-]+$/, 'Only letters, numbers, and hyphens'),
    name: z
        .string()
        .min(1, 'Repository name is required')
        .regex(/^[a-zA-Z0-9._-]+$/, 'Only letters, numbers, dots, hyphens, underscores'),
})

type RepoFormValues = z.infer<typeof repoSchema>

interface RepoRow {
    id: string
    project: string
    projectName: string
    repo: string
}

/**
 * Every board this user belongs to (any role) plus every repo attached to
 * one of them — everything this package-wide screen needs in two queries.
 *
 * Joined in JS rather than chained as a second `.innerJoin()`: TanStack DB
 * needs a single equality per join, and a THIRD table joined off an
 * already-joined alias blew up type inference here (the members collection's
 * `expand` shape multiplies against the other two). The membership join
 * alone is the same one useActiveBoard.ts uses, so mirroring it keeps this
 * within the shape the type checker already handles elsewhere.
 */
function useGitHubSettingsData() {
    const [reposCollection, projectsCollection, membersCollection] = useStore(
        'boards_project_repos',
        'boards_projects',
        'boards_project_members'
    )

    const { data: memberRows } = useOrgLiveQuery((query, { userId }) =>
        query
            .from({ member: membersCollection })
            .innerJoin({ project: projectsCollection }, ({ member, project }) =>
                eq(member.project, project.id)
            )
            .where(({ member }) => eq(member.user, userId))
    )

    // Unfiltered by project: the collection's own sync already scopes to
    // boards this user can read (viaMember in the migration's rules), so
    // there is nothing further to ask the query for.
    const { data: repoRows } = useOrgLiveQuery(query => query.from({ repo: reposCollection }))

    const projectNames = new Map<string, string>()
    const ownedProjects: { id: string; name: string }[] = []
    for (const { member, project } of memberRows ?? []) {
        projectNames.set(project.id, project.name)
        if (member.role === 'owner' && !project.archived) {
            ownedProjects.push({ id: project.id, name: project.name })
        }
    }
    ownedProjects.sort((a, b) => a.name.localeCompare(b.name))
    const ownedProjectIds = new Set(ownedProjects.map(p => p.id))

    const repos: RepoRow[] = (repoRows ?? [])
        .filter(repo => projectNames.has(repo.project))
        .map(repo => ({
            id: repo.id,
            project: repo.project,
            projectName: projectNames.get(repo.project) ?? '',
            repo: repo.repo,
        }))
        .sort((a, b) => a.projectName.localeCompare(b.projectName) || a.repo.localeCompare(b.repo))

    return { repos, ownedProjects, ownedProjectIds }
}

export default function GitHubSettings() {
    const primaryColor = useThemeColor('primary')
    const { repos, ownedProjects, ownedProjectIds } = useGitHubSettingsData()
    const canWrite = ownedProjects.length > 0

    return (
        <ScrollView contentContainerStyle={{ flexGrow: 1 }} className="bg-background">
            <View className="flex-1 gap-5 p-5" style={{ maxWidth: 600 }}>
                <Header primaryColor={primaryColor} />
                <WebhookURLBlock />
                <RepoList repos={repos} ownedProjectIds={ownedProjectIds} />
                <AddRepoSection ownedProjects={ownedProjects} isVisible={canWrite} />
                <ReadOnlyNote isVisible={!canWrite} />
            </View>
        </ScrollView>
    )
}

function Header({ primaryColor }: { primaryColor: string }) {
    return (
        <View className="gap-2">
            <GitPullRequest size={32} color={primaryColor} />
            <View className="flex-row items-center gap-2">
                <Text className="text-foreground" style={{ fontSize: 20, fontWeight: 'bold' }}>
                    GitHub
                </Text>
                <HelpIcon topic="boards:github" size={18} />
            </View>
            <Text className="text-muted-foreground" style={{ fontSize: 13 }}>
                Attach a repository to a board to show its pull requests on cards. There is no
                separate on/off switch — a board's GitHub integration is active as soon as a
                repository is attached, and inactive again once every repository is removed.
            </Text>
        </View>
    )
}

function WebhookURLBlock() {
    const mutedColor = useThemeColor('muted-foreground')
    const foregroundColor = useThemeColor('foreground')
    const borderColor = useThemeColor('border')
    const surfaceColor = useThemeColor('surface')
    const [copied, markCopied] = useCopiedFlag()
    // Read at render time, not module scope: PB_SERVER_ADDR is a Proxy that
    // throws until the server address resolves, and every other consumer
    // (anon-identity.ts, use-cli-downloads.ts, use-release-manifest.ts)
    // interpolates it inside a function body for exactly that reason.
    const webhookURL = `${PB_SERVER_ADDR}/api/webhooks/github`

    const onCopy = async () => {
        await Clipboard.setStringAsync(webhookURL)
        markCopied()
    }

    return (
        <View className="gap-1.5">
            <Text className="text-foreground" style={{ fontSize: 13, fontWeight: '600' }}>
                Webhook URL
            </Text>
            <Text className="text-muted-foreground" style={{ fontSize: 12 }}>
                Add this as a webhook URL in your GitHub App's settings so pull request activity
                reaches this deployment.
            </Text>
            <View
                className="flex-row items-center gap-2 px-2.5 py-2 rounded-md border"
                style={{ backgroundColor: surfaceColor, borderColor }}
            >
                <Text
                    numberOfLines={1}
                    style={{
                        fontSize: 12,
                        fontFamily: 'monospace',
                        color: foregroundColor,
                        flex: 1,
                    }}
                >
                    {webhookURL}
                </Text>
                <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Copy webhook URL"
                    onPress={onCopy}
                    hitSlop={4}
                >
                    {copied ? (
                        <Check size={14} color={mutedColor} />
                    ) : (
                        <Copy size={14} color={mutedColor} />
                    )}
                </Pressable>
            </View>
        </View>
    )
}

function RepoList({
    repos,
    ownedProjectIds,
}: {
    repos: RepoRow[]
    ownedProjectIds: ReadonlySet<string>
}) {
    return (
        <View className="gap-3">
            <Text className="text-foreground" style={{ fontSize: 18, fontWeight: 'bold' }}>
                Attached repositories
            </Text>
            <EmptyReposNote isVisible={repos.length === 0} />
            {repos.map(repo => (
                <RepoRowItem
                    key={repo.id}
                    repo={repo}
                    // Per-row, not screen-wide: owning board A must not grant
                    // Remove on board B's repo — see lib/repo-permissions.ts.
                    canRemove={canRemoveRepo(ownedProjectIds, repo.project)}
                />
            ))}
        </View>
    )
}

function EmptyReposNote({ isVisible }: { isVisible: boolean }) {
    if (!isVisible) return null
    return (
        <Text className="text-muted-foreground" style={{ fontSize: 13, fontStyle: 'italic' }}>
            No repositories attached yet. GitHub integration turns on for a board the moment you
            attach its first repository below.
        </Text>
    )
}

function RepoRowItem({ repo, canRemove }: { repo: RepoRow; canRemove: boolean }) {
    const [reposCollection] = useStore('boards_project_repos')

    const removeMutation = useMutation({
        mutationFn: mutation(function* () {
            yield reposCollection.delete(repo.id)
        }),
        // A rejected delete (a race, a revoked role, a rule this UI didn't
        // anticipate) must not just quietly revert the optimistic removal —
        // useMutation's own default would already toast a generic message,
        // but naming the repo here is clearer than that fallback.
        onError: error =>
            useToastStore.getState().addToast({
                title: `Couldn't remove ${repo.repo}`,
                body: errorToString(error),
                variant: 'error',
                duration: 5000,
            }),
    })

    return (
        <View className="flex-row items-center justify-between gap-3 border border-border rounded-xl p-3">
            <View>
                <Text className="text-foreground" style={{ fontWeight: '600' }}>
                    {repo.repo}
                </Text>
                <Text className="text-muted-foreground" style={{ fontSize: 11 }}>
                    {repo.projectName}
                </Text>
            </View>
            <RemoveRepoButton
                isVisible={canRemove}
                isPending={removeMutation.isPending}
                onPress={() => removeMutation.mutate()}
            />
        </View>
    )
}

function RemoveRepoButton({
    isVisible,
    isPending,
    onPress,
}: {
    isVisible: boolean
    isPending: boolean
    onPress: () => void
}) {
    const dangerColor = useThemeColor('danger')
    if (!isVisible) return null
    return (
        <Pressable
            accessibilityRole="button"
            accessibilityLabel="Remove repository"
            disabled={isPending}
            onPress={onPress}
            className="p-1"
            style={{ opacity: isPending ? 0.5 : 1 }}
        >
            <Trash2 size={16} color={dangerColor} />
        </Pressable>
    )
}

function AddRepoSection({
    ownedProjects,
    isVisible,
}: {
    ownedProjects: { id: string; name: string }[]
    isVisible: boolean
}) {
    if (!isVisible) return null
    return <AddRepoForm ownedProjects={ownedProjects} />
}

function AddRepoForm({ ownedProjects }: { ownedProjects: { id: string; name: string }[] }) {
    const primaryColor = useThemeColor('primary')
    const primaryFgColor = useThemeColor('primary-foreground')
    const [reposCollection] = useStore('boards_project_repos')

    const {
        control,
        handleSubmit,
        reset,
        setError,
        getValues,
        formState: { errors, isSubmitted, isDirty },
    } = useForm({
        mode: 'onChange',
        resolver: zodResolver(repoSchema),
        defaultValues: { project: ownedProjects[0]?.id ?? '', owner: '', name: '' },
    })

    const create = useMutation({
        mutationFn: mutation(function* (data: z.infer<typeof repoSchema>) {
            yield reposCollection.insert({
                id: newRecordId(),
                project: data.project,
                repo: `${data.owner.trim()}/${data.name.trim()}`,
                installation_id: '',
                created: '',
                updated: '',
            })
        }),
        onSuccess: () => reset(),
        onError: handleMutationErrorsWithForm({ setError, getValues }),
    })

    const onSubmit = handleSubmit(data => create.mutate(data))
    const canSubmit = !create.isPending && isDirty

    return (
        <View className="gap-2 border-t border-border pt-4">
            <Text className="text-foreground" style={{ fontSize: 13, fontWeight: '600' }}>
                Attach a repository
            </Text>
            <FormErrorSummary errors={errors} isEnabled={isSubmitted} />
            <BoardPicker control={control} ownedProjects={ownedProjects} />
            <View className="flex-row gap-2 items-start">
                <View className="flex-1">
                    <TextInput control={control} name="owner" label="Owner" placeholder="octocat" />
                </View>
                <View className="flex-1">
                    <TextInput
                        control={control}
                        name="name"
                        label="Repository"
                        placeholder="hello-world"
                    />
                </View>
            </View>
            <Pressable
                onPress={onSubmit}
                disabled={!canSubmit}
                className="self-start rounded-lg"
                style={{
                    paddingVertical: 8,
                    paddingHorizontal: 14,
                    backgroundColor: primaryColor,
                    opacity: canSubmit ? 1 : 0.5,
                }}
            >
                <Text style={{ color: primaryFgColor, fontSize: 13, fontWeight: '600' }}>
                    {create.isPending ? 'Attaching…' : 'Attach'}
                </Text>
            </Pressable>
        </View>
    )
}

/** Only rendered when there is a real choice — a single board is preselected
 * by useForm's defaultValues, and a picker of one option is noise. */
function BoardPicker({
    control,
    ownedProjects,
}: {
    control: Control<RepoFormValues>
    ownedProjects: { id: string; name: string }[]
}) {
    if (ownedProjects.length <= 1) return null
    return (
        <SelectInput
            control={control}
            name="project"
            label="Board"
            options={ownedProjects.map(p => ({ label: p.name, value: p.id }))}
        />
    )
}

function ReadOnlyNote({ isVisible }: { isVisible: boolean }) {
    if (!isVisible) return null
    return (
        <Text className="text-muted-foreground" style={{ fontSize: 12, fontStyle: 'italic' }}>
            Only a board owner can attach or remove repositories. You can see what is attached, but
            not change it.
        </Text>
    )
}
