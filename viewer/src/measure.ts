/**
 * How close a proposal is to a target scene. A proposal places things on the floor of the base commit; the
 * measurement is each placed thing's distance from where it stood in the target, plus what is still missing
 * and what stands at the base that the target never had. Pure, so the legend, the terminal and the tags agree.
 */
import type { Obj } from "./types";
import { chainOf } from "./identity";
import { centre, placementsOf, type Placement } from "./attribution";

export type MeasureLine = { k: "off" | "missing" | "extra"; id: number; metres: number | null; t: string };
export type Measure = { lines: MeasureLine[]; placed: number; ofN: number; meanM: number | null; maxM: number | null; done: boolean };

export const DONE_WITHIN_M = 0.5; // every placed thing within this of its target counts as restored
const fmt = (m: number) => `${m.toFixed(2)} m`;

const standsIn = (objects: Obj[], id: number, commit: number) => chainOf(objects, id).some((i) => objects[i].present.includes(commit));

/** What a proposal can place: whatever stood in the target and has nothing standing at the base. Ids as in the target. */
export const trayOf = (objects: Obj[], base: number, target: number): number[] =>
  placementsOf(objects, target)
    .map((p) => p.id)
    .filter((id) => !standsIn(objects, id, base));

export function measure(objects: Obj[], base: number, target: number, placements: Record<number, Placement>, targetLabel: string): Measure {
  const name = (id: number) => objects[id].name;
  const tray = trayOf(objects, base, target);
  const off: MeasureLine[] = [];
  const missing: MeasureLine[] = [];
  let sum = 0;
  let max = 0;
  for (const id of tray) {
    const got = placements[id];
    if (!got) {
      missing.push({ k: "missing", id, metres: null, t: `${name(id)} missing` });
      continue;
    }
    const want = centre(objects[id]);
    const d = Math.hypot(got.x - want.x, got.z - want.z);
    sum += d;
    max = Math.max(max, d);
    off.push({ k: "off", id, metres: d, t: `${name(id)} ${fmt(d)} off` });
  }
  off.sort((x, y) => (y.metres ?? 0) - (x.metres ?? 0));
  const extra: MeasureLine[] = placementsOf(objects, base)
    .filter((p) => !standsIn(objects, p.id, target))
    .map((p) => ({ k: "extra", id: p.id, metres: null, t: `${name(p.id)} not in ${targetLabel}` }));
  const placed = off.length;
  return {
    lines: [...off, ...missing, ...extra],
    placed,
    ofN: tray.length,
    meanM: placed ? sum / placed : null,
    maxM: placed ? max : null,
    done: tray.length > 0 && placed === tray.length && max <= DONE_WITHIN_M,
  };
}
