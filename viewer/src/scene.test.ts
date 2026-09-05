import { describe, expect, it } from "vitest";
import { parseManifest } from "./manifest";
import { carry, chainOf, diff, drift, idAt, months, standing, status, things, thingOf } from "./scene";
import type { Obj } from "./types";
import raw from "../public/sets/garage/commits.json";

// the garage set as published: four states, nine ids, seven things; the monstera and the fan move between Jul and Aug
const M = parseManifest(raw);
const O = M.objects;
const byName = (name: string, state: number) => O.find((o) => o.name === name && o.present.includes(state))!.id;

/** A thing that moves twice, once per state, under a new id each time; and one re-labelled without moving. */
const twoHop = (): Obj[] => {
  const box = (x: number, z: number): Obj["bbox"] => [
    [x - 0.2, 0, z - 0.2],
    [x + 0.2, 1, z + 0.2],
  ];
  const obj = (id: number, present: number[], bbox: Obj["bbox"], moved_from: number | null, moved_to: number | null): Obj => ({
    id,
    name: "Cart",
    added_in: present[0],
    removed_in: null,
    present,
    moved_from,
    moved_to,
    doc: null,
    by: null,
    bbox,
    voxels: 1,
    volume_vox_m3: 0.1,
  });
  return [
    obj(0, [0], box(0, 0), null, 1),
    obj(1, [1], box(1, 0), 0, 2),
    obj(2, [2], box(2, 0), 1, null),
    { ...obj(3, [0], box(-2, -2), null, 4), name: "Rack" },
    { ...obj(4, [1, 2], box(-2.02, -2.01), 3, null), name: "Rack" },
  ];
};

describe("things", () => {
  it("one chain per physical thing, oldest id first", () => {
    expect(things(O).map((t) => t.name)).toEqual(["Tall plant", "Small plant", "Knot", "Monstera", "Fan", "Lamp", "Suitcase"]);
    expect(chainOf(O, byName("Monstera", 3))).toEqual([byName("Monstera", 1), byName("Monstera", 3)]);
    expect(thingOf(O, byName("Fan", 3)).root).toBe(byName("Fan", 2));
  });
  it("finds the id a thing wears in a state, and carries a selection across states", () => {
    const monsteraJul = byName("Monstera", 2);
    expect(idAt(O, monsteraJul, 3)).toBe(byName("Monstera", 3));
    expect(idAt(O, monsteraJul, 0)).toBeNull();
    expect(carry(O, monsteraJul, [3])).toBe(byName("Monstera", 3));
    expect(carry(O, byName("Suitcase", 2), [3])).toBeNull();
  });
});

describe("diff", () => {
  it("Jul → Aug: two moves with their distances, three removals, nothing added", () => {
    const d = diff(O, 2, 3);
    const moved = d.changes.filter((c) => c.k === "moved").map((c) => [c.name, +(c as { metres: number }).metres.toFixed(1)]);
    expect(moved).toEqual([
      ["Monstera", 2.6],
      ["Fan", 1.4],
    ]);
    expect(d.changes.filter((c) => c.k === "removed").map((c) => c.name)).toEqual(["Tall plant", "Small plant", "Suitcase"]);
    expect(d.added.size).toBe(0);
    expect(d.movedTo.get(byName("Monstera", 3))).toBe(byName("Monstera", 2));
  });
  it("Jun → Jul: three arrivals, four unchanged", () => {
    const d = diff(O, 1, 2);
    expect(d.changes.filter((c) => c.k === "added").map((c) => c.name)).toEqual(["Fan", "Lamp", "Suitcase"]);
    expect(d.changes.filter((c) => c.k === "same").length).toBe(4);
  });
  it("a thing that moved twice across the range is one move for the whole distance, not a removal and an addition", () => {
    const d = diff(twoHop(), 0, 2);
    const cart = d.changes.find((c) => c.name === "Cart")!;
    expect(cart.k).toBe("moved");
    expect((cart as { metres: number }).metres).toBeCloseTo(2, 5);
    expect((cart as { from: number }).from).toBe(0);
  });
  it("a new id under the move threshold is the same thing, unmoved", () => {
    const d = diff(twoHop(), 0, 1);
    expect(d.changes.find((c) => c.name === "Rack")!.k).toBe("same");
  });
});

describe("drift", () => {
  it("Aug against the Jul standard: two must move, three must be added, mean 2.0 m", () => {
    const d = drift(O, 2, 3);
    expect(d.off).toBe(2);
    expect(d.missing).toBe(3);
    expect(d.extra).toBe(0);
    expect(d.meanM!).toBeCloseTo(2.0, 1);
    expect(d.lines.map((l) => l.k)).toEqual(["keep", "keep", "move", "move", "add", "add", "add"]);
  });
  it("the standard itself has no drift; June before it is reported the same way as any state", () => {
    expect(drift(O, 2, 2).isStandard).toBe(true);
    expect(drift(O, 2, 1).extra).toBe(0);
    expect(drift(O, 2, 1).missing).toBe(3);
  });
  it("status and standing read the same drift", () => {
    expect(status(O, 3, 2)).toEqual({ text: "Off standard", cls: "off" });
    expect(status(O, 2, 2).cls).toBe("std");
    expect(status(O, 1, 2).cls).toBe("before");
    expect(standing(O, byName("Monstera", 3), 3, 2).t).toBe("2.6 m from the standard");
    expect(standing(O, byName("Suitcase", 2), 3, 2).k).toBe("missing");
    expect(standing(O, byName("Knot", 3), 3, 2).k).toBe("match");
  });
});

describe("months", () => {
  it("the monstera: not in May, arrived in June, in room in July, moved in August", () => {
    const rows = months(O, M.commits.length, byName("Monstera", 3));
    expect(rows.map((r) => r.mark)).toEqual(["not in room", "arrived", "in room", "moved"]);
    expect(rows[3].metres!).toBeCloseTo(2.6, 1);
  });
});
