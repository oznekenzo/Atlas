import { isNavigational, useStore } from "./store";
import type { Actions } from "./git";
import { changeSummary } from "./identity";

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
      if (head === 0) return [];
      const objects = manifest().objects;
      const { added, removed, moved } = changeSummary(objects, head - 1, head);
      return [
        ...added.map((id) => `+ ${objects[id].name}`),
        ...removed.map((id) => `- ${objects[id].name}`),
        ...moved.map((m) => `~ ${objects[m.to].name} moved`),
      ];
    },
  };
};
