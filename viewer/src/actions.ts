import { isNavigational, useStore } from "./store";
import type { Actions } from "./git";

/** The git terminal's view of the app: thin adapters over the store. */
export const makeActions = (): Actions => {
  const s = () => useStore.getState();
  const manifest = () => {
    const m = s().manifest;
    if (!m) throw new Error("fatal: not an alchemist repository (no set loaded)");
    return m;
  };
  return {
    reflog: () => s().history.filter(isNavigational),
    restore: (id) => s().restore(id),
    checkout: (i) => s().checkout(i),
    diff: (a, b) => s().diff(a, b),
    head: () => s().head,
    objects: () => manifest().objects,
    commits: () => manifest().commits,
    select: (id) => s().select(id),
    status: () => {
      const { head } = s();
      return manifest().objects.flatMap((o) => [
        ...(o.added_in === head && head > 0 ? [`+ ${o.name}`] : []),
        ...(o.removed_in === head ? [`- ${o.name}`] : []),
      ]);
    },
  };
};
