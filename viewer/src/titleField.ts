/**
 * The title card's point field: an industrial bay assembled from points, near to far, dollying forward forever.
 * The design's own code (atlas-title.js), typed; `start` renders until the returned stop is called.
 */
/* eslint-disable */
// prettier-ignore
export const startTitleField = (() => {
  const TAU = Math.PI * 2;
  function rng(seed: number) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }
  function bay(seed: number) {
    const r = rng(seed), X: number[] = [], Y: number[] = [], Z: number[] = [], Wt: number[] = [];
    const RW = 28, RD = 80, RH = 11;
    const add = (x: number, y: number, z: number, w: number) => { X.push(x); Y.push(y); Z.push(z); Wt.push(w); };
    const line = (x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, n: number, w: number) => { for (let i = 0; i < n; i++) { const t = r(); add(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, z0 + (z1 - z0) * t, w); } };
    // floor: sparse fill plus painted grid lines every 4 m
    for (let i = 0; i < 22000; i++) add((r() - .5) * RW, 0, r() * RD, .35);
    for (let z = 0; z <= RD; z += 4) line(-RW / 2, 0, z, RW / 2, 0, z, 260, .9);
    for (let x = -RW / 2; x <= RW / 2; x += 4) line(x, 0, 0, x, 0, RD, 500, .9);
    // walls: corrugated cladding suggested by vertical lines every 1 m
    for (let z = 0; z <= RD; z += 1) for (const sx of [-1, 1]) line(sx * RW / 2, 0, z, sx * RW / 2, RH, z, 40, .5);
    for (let x = -RW / 2; x <= RW / 2; x += 1) line(x, 0, RD, x, RH, RD, 40, .5);
    // I-beam columns every 8 m: two flanges + web, heavy
    for (let z = 0; z <= RD; z += 8) for (const sx of [-1, 1]) { const cx = sx * (RW / 2 - .5); for (const dx of [-.3, .3]) line(cx + dx, 0, z - .3, cx + dx, RH, z - .3, 260, 1.4), line(cx + dx, 0, z + .3, cx + dx, RH, z + .3, 260, 1.4); line(cx, 0, z, cx, RH, z, 200, 1.2); }
    // roof beams: straight, across the bay at each column, plus purlins along the bay
    for (let z = 0; z <= RD; z += 8) { line(-RW / 2, RH, z, RW / 2, RH, z, 900, 1.3); line(-RW / 2, RH - .5, z, RW / 2, RH - .5, z, 500, .9); }
    for (let x = -RW / 2 + 2; x < RW / 2; x += 4) line(x, RH, 0, x, RH, RD, 900, .7);
    // crane rail on each side at 8.5 m, plus a gantry crane bridge at z=22
    for (const sx of [-1, 1]) line(sx * (RW / 2 - 1.2), 8.5, 0, sx * (RW / 2 - 1.2), 8.5, RD, 1600, 1.5);
    line(-RW / 2 + 1.2, 8.6, 22, RW / 2 - 1.2, 8.6, 22, 1400, 1.6); line(-RW / 2 + 1.2, 9.4, 22, RW / 2 - 1.2, 9.4, 22, 900, 1.2);
    for (let x = -RW / 2 + 1.2; x < RW / 2; x += 1.5) line(x, 8.6, 22, x + 1.5, 9.4, 22, 60, .9);
    line(3, 8.6, 22, 3, 5.4, 22, 200, 1.4); // hoist cable
    // high-bay lights: bright dense points under the roof
    for (let z = 6; z < RD; z += 12) for (const x of [-9, 0, 9]) for (let i = 0; i < 60; i++) add(x + (r() - .5) * .5, RH - 1.2, z + (r() - .5) * .5, 3);
    // pallet racking: two long aisles of uprights and beams, three shelf levels
    for (const rx of [-8, -4.5, 4.5, 8]) { for (let z = 6; z < RD - 6; z += 2.7) line(rx, 0, z, rx, 6, z, 160, 1.1); for (const y of [1.6, 3.4, 5.2]) line(rx, y, 6, rx, y, RD - 6, 1500, 1); }
    // pallets/loads on shelves: boxy clusters, edges only
    for (const rx of [-6.25, 6.25]) for (let z = 7.5; z < RD - 7; z += 2.7) for (const y of [0, 1.6, 3.4]) if (r() < .7) { const h = .9 + r() * .7, w = 3.2, d = 1.1; for (let i = 0; i < 90; i++) { const f = r(); let x = rx + (r() - .5) * w, yy = y + r() * h, zz = z + (r() - .5) * d; if (f < .5) x = rx + (r() < .5 ? -1 : 1) * w / 2; else if (f < .8) zz = z + (r() < .5 ? -1 : 1) * d / 2; else yy = y + h; add(x, yy, zz, .9); } }
    // machines down the centre: rectilinear, with cabinets and a conveyor line
    for (let z = 10; z < RD - 8; z += 9) { const w = 3 + r() * 2, d = 2 + r() * 2, h = 1.8 + r() * 1.4, x = (r() - .5) * 1.5; for (const [x0, x1] of [[x - w / 2, x + w / 2]]) { for (const y of [0, h]) { line(x0, y, z - d / 2, x1, y, z - d / 2, 160, 1.2); line(x0, y, z + d / 2, x1, y, z + d / 2, 160, 1.2); line(x0, y, z - d / 2, x0, y, z + d / 2, 120, 1.2); line(x1, y, z - d / 2, x1, y, z + d / 2, 120, 1.2); } for (const xx of [x0, x1]) for (const zz of [z - d / 2, z + d / 2]) line(xx, 0, zz, xx, h, zz, 120, 1.2); for (let i = 0; i < 500; i++) add(x0 + r() * w, h, z - d / 2 + r() * d, .6); } }
    line(-1.2, .9, 0, -1.2, .9, RD, 1800, 1.1); line(1.2, .9, 0, 1.2, .9, RD, 1800, 1.1); for (let z = 0; z < RD; z += 2) line(-1.2, 0, z, -1.2, .9, z, 30, .9), line(1.2, 0, z, 1.2, .9, z, 30, .9); // conveyor
    // roof monitors / skylight strips as faint rectangles
    for (let z = 8; z < RD; z += 16) { line(-3, RH + .01, z, 3, RH + .01, z, 200, .6); line(-3, RH + .01, z + 4, 3, RH + .01, z + 4, 200, .6); }
    return { X: Float32Array.from(X), Y: Float32Array.from(Y), Z: Float32Array.from(Z), W: Float32Array.from(Wt), n: X.length, RD };
  }
  function start(canvas: HTMLCanvasElement): () => void {
    const ctx = canvas.getContext('2d', { alpha: false })!;
    let raf = 0;
    const P = bay(11), n = P.n;
    const RX = new Float32Array(n), RY = new Float32Array(n);
    for (let i = 0; i < n; i++) { RX[i] = (Math.random() - .5) * 3; RY[i] = (Math.random() - .5) * 3; }
    let img: ImageData | null = null, buf: Uint32Array | null = null, W = 0, H = 0;
    const t0 = performance.now();
    function frame(t: number) {
      const dpr = Math.min(1.5, devicePixelRatio || 1);
      const cw = Math.max(1, Math.round(canvas.clientWidth * dpr)), ch = Math.max(1, Math.round(canvas.clientHeight * dpr));
      if (cw !== W || ch !== H) { W = cw; H = ch; canvas.width = W; canvas.height = H; img = ctx.createImageData(W, H); buf = new Uint32Array(img.data.buffer); }
      buf!.fill(0xff050405); // ABGR little-endian: opaque near-black
      const s = (t - t0) / 1000;
      const yaw = Math.sin(s * 0.04) * 0.10 + Math.sin(s * 0.013) * 0.06, cy = Math.cos(yaw), sy = Math.sin(yaw);
      // dolly: fast at first, then ever slower, never stopping (approaches 36 m asymptotically)
      const eyeZ = -10 + 36 * (1 - Math.exp(-s / 40)) + s * 0.02, eyeY = 1.8 + Math.sin(s * 0.07) * 0.25 + Math.sin(s * 0.023) * 0.15;
      const f = H * 0.9, cx = W / 2, cyPx = H * 0.52;
      for (let i = 0; i < n; i++) {
        const dz0 = P.Z[i] - eyeZ; if (dz0 < 0.6) continue;
        const px0 = P.X[i];
        const x = px0 * cy - dz0 * sy, dz = px0 * sy + dz0 * cy; if (dz < 0.6) continue;
        const inv = f / dz;
        const u = (s - dz * 0.07) / 4.5; const uu = u <= 0 ? 0 : u >= 1 ? 1 : u; const e = 1 - (1 - uu) * (1 - uu) * (1 - uu);
        if (e <= 0) continue;
        const sx = cx + (x + RX[i] * (1 - e)) * inv, spy = cyPx - (P.Y[i] - eyeY - RY[i] * (1 - e)) * inv;
        const xi = sx | 0, yi = spy | 0; if (xi < 0 || xi >= W || yi < 0 || yi >= H) continue;
        const fog = Math.exp(-dz / 42);
        let a = (0.03 + 0.55 * fog) * (0.15 + 0.85 * e) * P.W[i]; if (a > 0.7) a = 0.7;
        const v = (a * 255) | 0, idx = yi * W + xi;
        // additive-ish: take max with existing
        const b = buf!; const cur = b[idx] & 0xff; const nv = cur + v > 255 ? 255 : cur + v;
        b[idx] = 0xff000000 | (nv << 16) | (nv << 8) | nv;
        if (dz < 14 && W > 1200) { if (xi + 1 < W) b[idx + 1] = b[idx]; if (yi + 1 < H) b[idx + W] = b[idx]; }
      }
      ctx.putImageData(img!, 0, 0);
      raf = requestAnimationFrame(frame);
    }
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }
  return start;
})();
