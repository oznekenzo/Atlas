import { useStore } from "./store";
import type { Actions } from "./git";
/** The git terminal's view of the app: thin adapters over the store. */
export const makeActions = (): Actions => {
  const s = () => useStore.getState();
  return {
    reflog: () => s().history, restore: (id) => s().restore(id),
    checkout: (i) => s().checkout(i), diff: (a, b) => s().diff(a, b), head: () => s().head,
    objects: () => s().manifest!.objects, commits: () => s().manifest!.commits, select: (id) => s().select(id),
    status: () => { const st = s(); return st.manifest!.objects.flatMap(o => [
      ...(o.added_in === st.head && st.head > 0 ? [`+ ${o.name}`] : []), ...(o.removed_in === st.head ? [`- ${o.name}`] : [])]); },
  };
};
