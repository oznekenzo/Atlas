/**
 * Aura: the game's yield, computed from a scene's object placements and nothing else. Pure, so the HUD,
 * the diff legend, the proposal board and a node script all get the same number from the same positions.
 *
 * Rules (the cards state the relation; only the diffs ever show a value):
 *   base      a plant alone is worth a little
 *   light     a plant within reach of the lamp
 *   catalyst  the knot touching both a plant and the lamp: gold
 *   wind      every reach doubles, except the knot's
 *   sun       a reaction on the door half of the room counts in full, else half
 *   throne    a reaction within reach of the chair counts in full, else half
 */
import type { Manifest, Obj } from "./types";

export const RULES = {
  BASE: 4,
  LIGHT: 20,
  CATALYST: 40,
  LIGHT_REACH: 1.5,
  CATALYST_REACH: 1.0,
  THRONE_REACH: 2.0,
  WIND: 2,
} as const;

/** Where an object stands on the floor, world metres. */
export type Placement = { id: number; x: number; z: number };
export type Rule = "base" | "light" | "catalyst";
export type Reaction = {
  plant: number;
  rule: Rule;
  with: number[];
  /** Governing distance: plant–lamp for light, the knot's farther partner for catalyst. */
  dist: number | null;
  reach: number | null;
  raw: number;
  sun: number;
  throne: number;
  value: number;
};
/** A rule that nearly fired: the closest partner set that was still out of reach. */
export type Missed = { plant: number; rule: "light" | "catalyst"; with: number[]; dist: number; reach: number };
export type Score = { aura: number; reactions: Reaction[]; missed: Missed[]; wind: boolean; hasThrone: boolean };

const dist = (a: Placement, b: Placement) => Math.hypot(a.x - b.x, a.z - b.z);
const r1 = (v: number) => Math.round(v * 10) / 10;

export const centre = (o: Obj): Placement => ({ id: o.id, x: (o.bbox[0][0] + o.bbox[1][0]) / 2, z: (o.bbox[0][2] + o.bbox[1][2]) / 2 });

/** Objects present in a commit, standing where they were captured. */
export const placementsOf = (M: Manifest, commit: number): Placement[] => M.objects.filter((o) => o.present.includes(commit)).map(centre);

/** True on the door half of the room. No door recorded → everywhere counts in full. */
export function doorHalf(M: Manifest, p: Placement): boolean {
  if (!M.door || !M.room) return true;
  const mx = (M.room[0][0] + M.room[1][0]) / 2;
  const mz = (M.room[0][2] + M.room[1][2]) / 2;
  switch (M.door) {
    case "-z":
      return p.z < mz;
    case "+z":
      return p.z > mz;
    case "-x":
      return p.x < mx;
    default:
      return p.x > mx;
  }
}

export function score(M: Manifest, P: Placement[]): Score {
  const obj = (p: Placement) => M.objects[p.id];
  const plants = P.filter((p) => obj(p).kind === "plant");
  const things = (sub: string) => P.filter((p) => obj(p).sub === sub);
  const lights = things("light");
  const knots = things("catalyst");
  const thrones = things("throne");
  const wind = things("wind").length > 0;
  const lightReach = RULES.LIGHT_REACH * (wind ? RULES.WIND : 1);
  const throneReach = RULES.THRONE_REACH * (wind ? RULES.WIND : 1);
  const reactions: Reaction[] = [];
  const missed: Missed[] = [];
  for (const p of plants) {
    const sun = doorHalf(M, p) ? 1 : 0.5;
    const throne = thrones.some((t) => dist(p, t) <= throneReach) ? 1 : 0.5;
    const add = (rule: Rule, w: number[], d: number | null, reach: number | null, raw: number) =>
      reactions.push({ plant: p.id, rule, with: w, dist: d, reach, raw, sun, throne, value: raw * sun * throne });
    add("base", [], null, null, RULES.BASE);
    let nearest: { l: Placement; d: number } | null = null;
    for (const l of lights) {
      const d = dist(p, l);
      if (d <= lightReach) add("light", [l.id], d, lightReach, RULES.LIGHT);
      else if (!nearest || d < nearest.d) nearest = { l, d };
    }
    if (nearest) missed.push({ plant: p.id, rule: "light", with: [nearest.l.id], dist: nearest.d, reach: lightReach });
    let nearK: { w: number[]; d: number } | null = null;
    for (const l of lights)
      for (const k of knots) {
        const d = Math.max(dist(p, k), dist(l, k));
        if (d <= RULES.CATALYST_REACH) add("catalyst", [l.id, k.id], d, RULES.CATALYST_REACH, RULES.CATALYST);
        else if (!nearK || d < nearK.d) nearK = { w: [l.id, k.id], d };
      }
    if (nearK) missed.push({ plant: p.id, rule: "catalyst", with: nearK.w, dist: nearK.d, reach: RULES.CATALYST_REACH });
  }
  return { aura: r1(reactions.reduce((a, r) => a + r.value, 0)), reactions, missed, wind, hasThrone: thrones.length > 0 };
}

export const sceneAura = (M: Manifest, commit: number) => score(M, placementsOf(M, commit)).aura;

/** The earliest id in an object's move chain: one physical thing, whatever the tracker called it later. */
export function rootOf(M: Manifest, id: number): number {
  let o = M.objects[id];
  const seen = new Set<number>();
  while (o && o.moved_from !== null && !seen.has(o.id)) {
    seen.add(o.id);
    o = M.objects[o.moved_from];
  }
  return o ? o.id : id;
}

export type Line = { k: "move" | "add" | "rem" | "on" | "off" | "miss" | "note"; delta: number; t: string };

const fmtM = (m: number) => `${m.toFixed(1)} m`;
const factors = (r: Reaction) => {
  const f: string[] = [];
  if (r.sun < 1) f.push("back half ½");
  if (r.throne < 1) f.push("no throne ½");
  return f.length ? ` · ${f.join(" · ")}` : "";
};
const sign = (v: number) => (v >= 0 ? `+${r1(v)}` : `−${r1(-v)}`);

/** Attribution: what moved, what arrived or left, which reactions turned on or off, and what nearly fired. */
export function attribution(M: Manifest, PA: Placement[], PB: Placement[]): { auraA: number; auraB: number; lines: Line[] } {
  const A = score(M, PA);
  const B = score(M, PB);
  const name = (id: number) => M.objects[id].name;
  const byRoot = (P: Placement[]) => new Map(P.map((p) => [rootOf(M, p.id), p]));
  const ra = byRoot(PA);
  const rb = byRoot(PB);
  const lines: Line[] = [];
  for (const [root, pb] of rb) {
    const pa = ra.get(root);
    if (!pa) lines.push({ k: "add", delta: 0, t: `${name(pb.id)} arrives` });
    else {
      const d = dist(pa, pb);
      if (d > 0.05) {
        const half = doorHalf(M, pb) !== doorHalf(M, pa) ? (doorHalf(M, pb) ? " · now door half" : " · now back half") : "";
        lines.push({ k: "move", delta: 0, t: `${name(pb.id)} moved ${fmtM(d)}${half}` });
      }
    }
  }
  for (const [root, pa] of ra) if (!rb.has(root)) lines.push({ k: "rem", delta: 0, t: `${name(pa.id)} leaves` });
  if (A.wind !== B.wind)
    lines.push({ k: "note", delta: 0, t: B.wind ? "wind: every reach doubles, except the knot's" : "wind gone: reaches are what they were" });

  const key = (r: Reaction) => `${rootOf(M, r.plant)}|${r.rule}|${r.with.map((w) => rootOf(M, w)).join(",")}`;
  const ka = new Map(A.reactions.map((r) => [key(r), r]));
  const kb = new Map(B.reactions.map((r) => [key(r), r]));
  const describe = (r: Reaction) => {
    const w = r.with.map(name).join(" + ");
    const where = r.dist !== null ? ` · ${fmtM(r.dist)}, reach ${fmtM(r.reach!)}` : "";
    return `${r.rule} on ${name(r.plant)}${w ? ` (${w})` : ""}${where}${factors(r)}`;
  };
  for (const [k, rb2] of kb) {
    const ra2 = ka.get(k);
    if (!ra2) lines.push({ k: "on", delta: rb2.value, t: `${sign(rb2.value)}  ${describe(rb2)}` });
    else if (Math.abs(rb2.value - ra2.value) > 0.01)
      lines.push({ k: "on", delta: rb2.value - ra2.value, t: `${sign(rb2.value - ra2.value)}  ${describe(rb2)}` });
  }
  for (const [k, ra2] of ka) if (!kb.has(k)) lines.push({ k: "off", delta: -ra2.value, t: `${sign(-ra2.value)}  ${describe(ra2)} · gone` });
  if (B.hasThrone && !B.reactions.some((r) => r.throne === 1)) lines.push({ k: "note", delta: 0, t: "throne: nothing within reach to keep" });
  for (const m of B.missed) {
    const w = m.with.map(name).join(" + ");
    lines.push({
      k: "miss",
      delta: 0,
      t: `${m.rule} on ${name(m.plant)} (${w}): out of reach by ${fmtM(m.dist - m.reach)} · ${fmtM(m.dist)}, reach ${fmtM(m.reach)}`,
    });
  }
  return { auraA: A.aura, auraB: B.aura, lines };
}
