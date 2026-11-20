// The collections of a unit test are local-only: a write is saved at once and
// there is no request. pbtsdb refuses such a collection in a batch, so for
// these tests the staged batch of useStagedMutation is its callback alone.
export function localStagedBatch(fn: () => void) {
    fn()
    return { commit: async () => {}, rollback: () => {} }
}
