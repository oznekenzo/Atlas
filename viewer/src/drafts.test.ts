import { describe, expect, it } from "vitest";
import { parseManifest } from "./manifest";
import { canSave, draftDirty, fitDrafts, nameOf, parseDrafts, placedByThing, proposalOf, sameLayout, seedOf, type SavedDraft } from "./drafts";
import type { Draft } from "./store";
import raw from "../public/sets/garage/commits.json";

// the garage set as published: four states; August has four things
const M = parseManifest(raw);
const draft = (p: Partial<Draft>): Draft => ({ id: null, base: 3, placements: [], inHand: null, attempts: [], ...p });
const withKeys = (base: number | null) => seedOf(M, base).map((p, i) => ({ ...p, key: i + 1 }));
const branch = (d: Draft, id: number, name = `Draft ${id}`): SavedDraft => ({ id, name, savedAt: 0, ...proposalOf(d) });

describe("seedOf", () => {
  it("is empty from scratch and one placement per thing present in the state", () => {
    expect(seedOf(M, null)).toEqual([]);
    expect(seedOf(M, 3).length).toBe(M.objects.filter((o) => o.present.includes(3)).length);
    expect(seedOf(null, 3)).toEqual([]);
  });
});

describe("dirty", () => {
  it("a fresh draft from a state is clean, and can still be saved as a branch", () => {
    const d = draft({ placements: withKeys(3) });
    expect(draftDirty(d, [], M)).toBe(false);
    expect(canSave(d, [], M)).toBe(true);
  });
  it("a moved placement, a changed base, or a measure makes it dirty", () => {
    const seed = withKeys(3);
    expect(draftDirty(draft({ placements: [{ ...seed[0], x: seed[0].x + 1 }, ...seed.slice(1)] }), [], M)).toBe(true);
    expect(draftDirty(draft({ base: 2, placements: seed }), [], M)).toBe(true);
    expect(draftDirty(draft({ placements: seed, attempts: [{ n: 1, text: "4 placed" }] }), [], M)).toBe(true);
  });
  it("a saved draft is clean against its branch and cannot be saved again until it moves", () => {
    const d = draft({ id: 1, placements: [{ key: 9, id: 0, x: 1, z: 2 }] });
    const drafts = [branch(d, 1)];
    expect(draftDirty(d, drafts, M)).toBe(false);
    expect(canSave(d, drafts, M)).toBe(false);
    const moved = { ...d, placements: [{ key: 9, id: 0, x: 1.5, z: 2 }] };
    expect(draftDirty(moved, drafts, M)).toBe(true);
    expect(canSave(moved, drafts, M)).toBe(true);
  });
  it("an id whose branch is gone compares to the seed", () => {
    expect(draftDirty(draft({ id: 7, placements: withKeys(3) }), [], M)).toBe(false);
  });
  it("sameLayout ignores keys and minds order", () => {
    expect(sameLayout([{ id: 0, x: 1, z: 1 }], [{ id: 0, x: 1, z: 1 }])).toBe(true);
    expect(
      sameLayout(
        [
          { id: 0, x: 1, z: 1 },
          { id: 1, x: 2, z: 2 },
        ],
        [
          { id: 1, x: 2, z: 2 },
          { id: 0, x: 1, z: 1 },
        ],
      ),
    ).toBe(false);
  });
});

describe("names and counts", () => {
  it("names a saved draft by its branch and an unsaved one by the next number", () => {
    const d = draft({ id: 2 });
    expect(nameOf(2, [branch(d, 2, "Draft 2")], 2)).toBe("Draft 2");
    expect(nameOf(null, [], 2)).toBe("Draft 3");
    expect(nameOf(9, [], 0)).toBe("Draft 1");
  });
  it("groups what is down by thing across its ids", () => {
    const plant = M.objects.find((o) => o.present.includes(3))!;
    const rows = placedByThing(M.objects, [
      { key: 1, id: plant.id, x: 0, z: 0 },
      { key: 2, id: plant.id, x: 1, z: 0 },
    ]);
    expect(rows).toEqual([{ name: plant.name, n: 2 }]);
  });
});

describe("the browser's copy", () => {
  it("rejects junk and keeps what fits", () => {
    expect(parseDrafts(null)).toEqual({ seq: 0, drafts: [] });
    expect(parseDrafts("x")).toEqual({ seq: 0, drafts: [] });
    expect(parseDrafts({ seq: "1", drafts: [] })).toEqual({ seq: 0, drafts: [] });
    const got = parseDrafts({
      seq: 1,
      drafts: [
        { id: 2, name: "Draft 2", base: 3, placements: [{ id: 0, x: 1, z: 2 }, { id: "bad" }], attempts: ["1 placed", 4], savedAt: 5 },
        { id: "no" },
      ],
    });
    expect(got.seq).toBe(2);
    expect(got.drafts).toEqual([{ id: 2, name: "Draft 2", base: 3, placements: [{ id: 0, x: 1, z: 2 }], attempts: ["1 placed"], savedAt: 5 }]);
  });
  it("fits a branch from another build of the set, and leaves a fitting one alone", () => {
    const ok: SavedDraft = { id: 1, name: "Draft 1", base: 3, placements: [{ id: 0, x: 0, z: 0 }], attempts: [], savedAt: 0 };
    const stale: SavedDraft = {
      id: 2,
      name: "Draft 2",
      base: 9,
      placements: [
        { id: 999, x: 0, z: 0 },
        { id: 1, x: 0, z: 0 },
      ],
      attempts: [],
      savedAt: 0,
    };
    const same = [ok];
    expect(fitDrafts(same, M)).toBe(same);
    const fitted = fitDrafts([ok, stale], M);
    expect(fitted[0]).toBe(ok);
    expect(fitted[1]).toEqual({ ...stale, base: null, placements: [{ id: 1, x: 0, z: 0 }] });
  });
});
