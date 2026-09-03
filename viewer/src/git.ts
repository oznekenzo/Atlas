/**
 * The git terminal: real git grammar over a history that cannot be rewritten.
 * Pure — takes an Actions adapter, returns lines. No store import, so it is trivially testable.
 */
import type { Commit, Obj } from "./types";

export type ReflogEntry = { id: number; verb: string; detail: string };
export type Actions = {
  reflog: () => ReflogEntry[]; // navigational entries only, oldest first
  restore: (id: number) => boolean;
  checkout: (i: number) => boolean;
  diff: (a: number, b: number) => boolean;
  head: () => number;
  objects: () => Obj[];
  commits: () => Commit[];
  select: (id: number | null) => void;
  status: () => string[];
};
export type Line = { k: "in" | "o" | "e" | "a" | "d"; t: string };

const stamp = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? "undated     "
    : d.toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
};
const fmt = (c: Commit) => `${c.hash}  ${stamp(c.captured)}   ${c.message}`;
const pad3 = (n: number) => String(n).padStart(3, "0");

/** Resolve a revision to a commit index. Throws with git's wording on failure. */
export function resolveRef(ref: string, A: Actions): number {
  const cs = A.commits();
  const head = A.head();
  let m: RegExpMatchArray | null;
  if (ref === "HEAD") return head;
  if ((m = ref.match(/^HEAD~(\d+)$/))) {
    const i = head - parseInt(m[1], 10);
    if (i < 0) throw new Error(`fatal: ambiguous argument '${ref}': unknown revision (only ${head} commit${head === 1 ? "" : "s"} before HEAD)`);
    return i;
  }
  if ((m = ref.match(/^c(\d+)$/))) {
    const i = parseInt(m[1], 10);
    if (i >= cs.length) throw new Error(`fatal: ambiguous argument '${ref}': unknown revision (c0…c${cs.length - 1})`);
    return i;
  }
  const byHash = cs.filter((c) => c.hash.startsWith(ref));
  if (byHash.length === 1) return byHash[0].index;
  if (byHash.length > 1) throw new Error(`error: short object ID ${ref} is ambiguous`);
  throw new Error(`fatal: ambiguous argument '${ref}': unknown revision`);
}

const findObject = (A: Actions, words: string[]) => {
  const q = words.join(" ").toLowerCase();
  return q ? A.objects().find((o) => o.name.toLowerCase().includes(q)) : undefined;
};

export function run(cmdline: string, A: Actions): Line[] {
  const out: Line[] = [{ k: "in", t: cmdline }];
  const argv =
    cmdline
      .trim()
      .match(/(?:[^\s"]+|"[^"]*")+/g)
      ?.map((s) => s.replace(/^"|"$/g, "")) ?? [];
  if (argv[0] !== "git") {
    out.push({ k: "e", t: `${argv[0] ?? ""}: command not found` });
    return out;
  }
  const [, sub, ...rest] = argv;
  const cs = A.commits();
  const checkout = (i: number) => {
    if (A.checkout(i)) out.push({ k: "o", t: `HEAD is now at ${cs[i].hash} ${cs[i].message}` });
    else out.push({ k: "e", t: `error: c${i} is still loading` });
  };
  try {
    switch (sub) {
      case "log": {
        for (const c of [...cs].reverse()) out.push({ k: "o", t: fmt(c) });
        break;
      }
      case "reflog": {
        const h = A.reflog();
        for (let n = 0; n < h.length; n++) {
          const a = h[h.length - 1 - n];
          out.push({ k: n === 0 ? "o" : "d", t: `HEAD@{${n}}  ${pad3(a.id)}  ${a.verb.padEnd(9)} ${a.detail}` });
        }
        break;
      }
      case "checkout": {
        const m = (rest[0] ?? "").match(/^HEAD@\{(\d+)\}$/);
        if (m) {
          const h = A.reflog();
          const a = h[h.length - 1 - parseInt(m[1], 10)];
          if (!a) throw new Error(`fatal: log for 'HEAD' only has ${h.length} entries`);
          if (A.restore(a.id)) out.push({ k: "o", t: `restored ${pad3(a.id)}  ${a.verb} ${a.detail}` });
          else out.push({ k: "d", t: "already there" });
          break;
        }
        checkout(resolveRef(rest[0] ?? "HEAD", A));
        break;
      }
      case "diff": {
        let a: number;
        let b: number;
        if (rest.length === 0) {
          b = A.head();
          a = Math.max(0, b - 1);
        } else if (rest.length === 1) {
          b = A.head();
          a = resolveRef(rest[0], A);
        } else {
          a = resolveRef(rest[0], A);
          b = resolveRef(rest[1], A);
        }
        if (a === b) {
          out.push({ k: "d", t: "(no changes)" });
          break;
        }
        const lo = Math.min(a, b);
        const hi = Math.max(a, b);
        if (!A.diff(lo, hi)) {
          out.push({ k: "e", t: `error: c${lo} or c${hi} is still loading` });
          break;
        }
        let any = false;
        for (const o of A.objects()) {
          const inA = o.present.includes(lo);
          const inB = o.present.includes(hi);
          if (inB && !inA) out.push({ k: "a", t: `+ ${o.name}` });
          if (inA && !inB) out.push({ k: "e", t: `- ${o.name}` });
          any ||= inA !== inB;
        }
        if (!any) out.push({ k: "d", t: "(no object changes)" });
        break;
      }
      case "show": {
        const i = resolveRef(rest[0] ?? "HEAD", A);
        if (!A.checkout(i)) {
          out.push({ k: "e", t: `error: c${i} is still loading` });
          break;
        }
        out.push({ k: "o", t: fmt(cs[i]) }, { k: "d", t: "" });
        for (const o of A.objects()) {
          if (o.added_in === i && i > 0) out.push({ k: "a", t: `+ ${o.name}` });
          if (o.removed_in === i) out.push({ k: "e", t: `- ${o.name}` });
        }
        break;
      }
      case "status": {
        out.push({ k: "o", t: `On commit c${A.head()} — “${cs[A.head()].message}”` });
        const lines = A.status();
        if (lines.length === 0) out.push({ k: "d", t: "  nothing changed in this commit" });
        for (const l of lines) out.push({ k: l.startsWith("+") ? "a" : "e", t: `  ${l}` });
        break;
      }
      case "blame": {
        const o = findObject(A, rest);
        if (!o) throw new Error(`fatal: no such object '${rest.join(" ")}'`);
        A.select(o.id);
        checkout(o.added_in);
        out.push({ k: "o", t: `${o.name}: appeared in ${cs[o.added_in].hash} (c${o.added_in}) — ${cs[o.added_in].message}` });
        if (o.removed_in !== null) out.push({ k: "o", t: `           removed in ${cs[o.removed_in].hash} (c${o.removed_in})` });
        break;
      }
      case "bisect": {
        const o = findObject(A, rest);
        if (!o) throw new Error("usage: git bisect <object>");
        let lo = 0;
        let hi = cs.length - 1;
        while (lo < hi) {
          const mid = (lo + hi) >> 1;
          const has = mid >= o.added_in;
          out.push({ k: "d", t: `  bisect: c${mid} ${has ? "has" : "lacks"} ${o.name}` });
          if (has) hi = mid;
          else lo = mid + 1;
        }
        checkout(lo);
        A.select(o.id);
        out.push({ k: "o", t: `${cs[lo].hash} is the first commit with ${o.name}` });
        break;
      }
      case "reset":
        out.push({ k: "e", t: "fatal: the physical world does not support reset." });
        break;
      case "revert":
        out.push({ k: "e", t: "fatal: the physical world does not support revert." });
        break;
      case "rebase":
        out.push({ k: "e", t: "fatal: history here is not yours to rewrite." });
        break;
      case "push":
        out.push({ k: "e", t: "fatal: remote is reality. read-only." });
        break;
      case "stash":
        out.push({ k: "e", t: "fatal: nowhere to put it." });
        break;
      case "help":
      case undefined:
        out.push(
          { k: "o", t: "log · checkout <ref> · diff [a] [b] · show <ref> · status · blame <object> · bisect <object> · reflog" },
          { k: "d", t: `refs: c0…c${cs.length - 1}, HEAD, HEAD~n, a hash prefix, or HEAD@{n} from the reflog` },
        );
        break;
      default:
        out.push({ k: "e", t: `git: '${sub}' is not a git command. See 'git help'.` });
    }
  } catch (e) {
    out.push({ k: "e", t: e instanceof Error ? e.message : String(e) });
  }
  return out;
}
