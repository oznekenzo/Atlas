import { isNavigational, useStore } from "./store";
import type { Actions } from "./git";
import { changeSummary } from "./identity";
import { drift } from "./drift";

/** The git terminal's view of the app: thin adapters over the store. */
export const makeActions = (): Actions => {
  const s = () => useStore.getState();
  const manifest = () => {
    const m = s().manifest;
    if (!m) throw new Error("fatal: not a state atlas repository (no set loaded)");
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
    branch: (name, target) => s().branch(name, target),
    enterBranch: () => s().enterBranch(),
    proposal: () => {
      const p = s().proposal;
      return p ? { name: p.name, base: p.base, target: p.target, commits: p.commits.length } : null;
    },
    onBranch: () => s().mode.kind === "proposal" && s().proposal !== null,
    standard: () => s().standard,
    setStandard: (i) => s().setStandard(i),
    drift: () => {
      const st = s();
      if (st.standard === null || st.mode.kind === "proposal") return null;
      const d = drift(manifest().objects, st.standard, st.head);
      return { lines: d.lines, off: d.off, meanM: d.meanM };
    },
    commit: (msg) => {
      const r = s().commitProposal(msg);
      return r && { lines: r.lines.map((l) => ({ k: l.k, t: l.t })), placed: r.placed, ofN: r.ofN, meanM: r.meanM, done: r.done };
    },
    status: () => {
      const { head } = s();
      if (s().mode.kind === "proposal")
        return (
          s()
            .measureProposal()
            ?.lines.map((l) => l.t) ?? []
        );
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
