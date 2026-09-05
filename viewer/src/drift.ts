/**
 * Drift from the standard: where a state differs from the one marked as the approved layout.
 * A move is a thing standing somewhere else; a departure is a thing the standard has and the state lacks; an
 * arrival is a thing the state has and the standard does not. Pure, over attribution.ts and identity.ts.
 */
import type { Obj } from "./types";
import { attribution, centre, metres, placementsOf, type Placement } from "./attribution";
import { chainOf } from "./identity";

export type DriftLine =
  | { k: "off"; id: number; stdId: number; metres: number; from: Placement; to: Placement; t: string }
  | { k: "missing"; stdId: number; from: Placement; t: string }
  | { k: "extra"; id: number; t: string };
export type Drift = {
  isStandard: boolean;
  lines: DriftLine[];
  off: number;
  missing: number;
  extra: number;
  meanM: number | null;
  maxM: number | null;
};

/** The id a thing wears in `commit`, following its move chain, or null if it is not there. */
export const idIn = (objects: Obj[], id: number, commit: number): number | null =>
  chainOf(objects, id).find((i) => objects[i].present.includes(commit)) ?? null;

export function drift(objects: Obj[], standard: number, head: number): Drift {
  if (standard === head) return { isStandard: true, lines: [], off: 0, missing: 0, extra: 0, meanM: null, maxM: null };
  const name = (id: number) => objects[id].name;
  const lines: DriftLine[] = [];
  let sum = 0;
  let max = 0;
  let off = 0;
  for (const l of attribution(objects, placementsOf(objects, standard), placementsOf(objects, head))) {
    if (l.k === "move" && l.metres !== null) {
      const stdId = idIn(objects, l.id, standard)!;
      lines.push({
        k: "off",
        id: l.id,
        stdId,
        metres: l.metres,
        from: centre(objects[stdId]),
        to: centre(objects[l.id]),
        t: `${name(l.id)} · ${metres(l.metres)} from standard`,
      });
      off++;
      sum += l.metres;
      max = Math.max(max, l.metres);
    } else if (l.k === "rem") lines.push({ k: "missing", stdId: l.id, from: centre(objects[l.id]), t: `${name(l.id)} · missing` });
    else if (l.k === "add") lines.push({ k: "extra", id: l.id, t: `${name(l.id)} · not in standard` });
  }
  return {
    isStandard: false,
    lines,
    off,
    missing: lines.filter((l) => l.k === "missing").length,
    extra: lines.filter((l) => l.k === "extra").length,
    meanM: off ? sum / off : null,
    maxM: off ? max : null,
  };
}
