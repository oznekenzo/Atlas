/**
 * One loaded commit on the GPU: its Spark mesh plus the CPU-side colour source and voxel labels.
 * Painting is declarative: a Style says, per object, how its splats should look; `paint` rewrites
 * the RGBA array only when the style actually differs from what the layer already shows.
 */
import { PackedSplats, RgbaArray, SplatMesh } from "@sparkjsdev/spark";

/** Anything paintable: a mesh plus the CPU-side colour source and per-splat labels behind it. */
export type Paintable = {
  mesh: SplatMesh;
  n: number;
  /** Original RGBA8, straight from the file. Never mutated. */
  orig: Uint8Array;
  /** Per-splat label: 0 = static, object id + 1 otherwise. */
  label: Uint16Array;
  rgba: RgbaArray;
  /** Style currently applied to `rgba`, or null before the first paint. */
  style: Style | null;
};

export type Layer = Paintable & {
  /**
   * The same commit reduced to just its objects — the labelled splats, compacted. Onion mode layers
   * these into whichever commit you are standing in: the room around them is untouched between
   * captures, so drawing it once per commit would cost N× and blur N copies of the same wall against
   * each other at the registration residual. Null when this commit changed nothing.
   */
  objects: Paintable | null;
  /** One object on its own, by id: what a proposal carries across the floor. Built lazily, kept. */
  parts: Map<number, Paintable>;
  /** Per label (object id + 1): a subsample of that object's splat centres in world space, flat xyz. For picking. */
  pts: (Float32Array | undefined)[];
};

/** Per-object paint rule. Index 0 = static splats, object id + 1 otherwise. */
export type Style = {
  /** 1 = `rgb` is an absolute colour (0..255); 0 = `rgb` multiplies the original. */
  abs: Uint8Array;
  rgb: Float32Array;
  /** Alpha multiplier. */
  alpha: Float32Array;
};

export const ADD = [127, 214, 164] as const;
export const REM = [224, 112, 92] as const;

/** Opacity is baked into the generated splats, so a change has to bump the mesh version. */
export function setOpacity(mesh: SplatMesh, opacity: number) {
  if (mesh.opacity === opacity) return;
  mesh.opacity = opacity;
  mesh.updateVersion();
}

/**
 * Compact a layer down to its labelled splats. Spark's packed format is 4 uint32 per splat, so this is
 * a stride copy — no decode, no re-upload of anything the GPU already has in the full mesh.
 */
export const buildObjects = (L: Layer): Paintable | null => extract(L, (o) => o > 0);
/** One object's splats as a mesh of their own, so a proposal can carry it across the floor. */
export const buildObject = (L: Layer, id: number): Paintable | null => extract(L, (o) => o === id + 1);

function extract(L: Layer, keep: (label: number) => boolean): Paintable | null {
  const src = L.mesh.packedSplats;
  const packed = src?.packedArray;
  if (!packed) return null;
  let count = 0;
  for (let k = 0; k < L.n; k++) if (keep(L.label[k])) count++;
  if (count === 0) return null;
  const sub = new Uint32Array(count * 4);
  const orig = new Uint8Array(count * 4);
  const label = new Uint16Array(count);
  for (let k = 0, j = 0; k < L.n; k++) {
    if (!keep(L.label[k])) continue;
    const r = k * 4;
    const w = j * 4;
    sub[w] = packed[r];
    sub[w + 1] = packed[r + 1];
    sub[w + 2] = packed[r + 2];
    sub[w + 3] = packed[r + 3];
    orig[w] = L.orig[r];
    orig[w + 1] = L.orig[r + 1];
    orig[w + 2] = L.orig[r + 2];
    orig[w + 3] = L.orig[r + 3];
    label[j] = L.label[k];
    j++;
  }
  const mesh = new SplatMesh({
    packedSplats: new PackedSplats({ packedArray: sub, numSplats: count, splatEncoding: src?.splatEncoding }),
  });
  mesh.visible = false;
  // its own RGBA source, so onion can isolate a single object's history out of the whole set
  const rgba = new RgbaArray({ array: orig.slice(), count });
  mesh.splatRgba = rgba;
  mesh.updateGenerator();
  return { mesh, n: count, orig, label, rgba, style: null };
}

export const makeStyle = (nObjects: number): Style => ({
  abs: new Uint8Array(nObjects + 1),
  rgb: new Float32Array((nObjects + 1) * 3).fill(1),
  alpha: new Float32Array(nObjects + 1).fill(1),
});

export const setDim = (s: Style, o: number, f: number) => {
  s.abs[o] = 0;
  s.rgb[o * 3] = s.rgb[o * 3 + 1] = s.rgb[o * 3 + 2] = f;
  s.alpha[o] = 1;
};

export const setColor = (s: Style, o: number, rgb: readonly [number, number, number], alpha: number) => {
  s.abs[o] = 1;
  s.rgb[o * 3] = rgb[0];
  s.rgb[o * 3 + 1] = rgb[1];
  s.rgb[o * 3 + 2] = rgb[2];
  s.alpha[o] = alpha;
};

/** Hidden splats need rgb = 0 AND alpha = 0: colour is premultiplied downstream, so alpha alone leaves a glow. */
export const setHidden = (s: Style, o: number) => setColor(s, o, [0, 0, 0], 0);

const same = (x: ArrayLike<number>, y: ArrayLike<number>) => {
  if (x.length !== y.length) return false;
  for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return false;
  return true;
};

export const sameStyle = (a: Style | null, b: Style) => a !== null && same(a.abs, b.abs) && same(a.rgb, b.rgb) && same(a.alpha, b.alpha);

/**
 * Rewrite the layer's RGBA from `orig` under `style`. Returns false (and touches nothing) when the
 * style is unchanged. The loop is closure-free on purpose: it runs over millions of splats.
 */
export function paint(L: Paintable, style: Style): boolean {
  if (sameStyle(L.style, style)) return false;
  const a = L.rgba.array;
  if (!a) return false;
  const { orig, label, n } = L;
  const { abs, rgb, alpha } = style;
  for (let k = 0, i = 0; k < n; k++, i += 4) {
    const o = label[k];
    const o3 = o * 3;
    if (abs[o]) {
      a[i] = rgb[o3];
      a[i + 1] = rgb[o3 + 1];
      a[i + 2] = rgb[o3 + 2];
    } else {
      a[i] = orig[i] * rgb[o3];
      a[i + 1] = orig[i + 1] * rgb[o3 + 1];
      a[i + 2] = orig[i + 2] * rgb[o3 + 2];
    }
    a[i + 3] = orig[i + 3] * alpha[o];
  }
  L.rgba.needsUpdate = true;
  L.mesh.updateVersion(); // Spark regenerates a mesh only when its version moves; the array alone is not watched
  L.style = style;
  return true;
}
