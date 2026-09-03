// Write SPZ with Spark's own SpzWriter so the viewer's reader is guaranteed to accept it.
// usage: node ply2spz.mjs in.ply out.spz [shDegree]
// The ply body is streamed in chunks so a 200 MB capture does not need a second copy in memory.
import { closeSync, fstatSync, openSync, readSync, writeFileSync } from "node:fs";
import { SpzWriter } from "@sparkjsdev/spark";

const [inPath, outPath, shArg] = process.argv.slice(2);
if (!inPath || !outPath) {
  console.error("usage: node ply2spz.mjs in.ply out.spz [shDegree]");
  process.exit(2);
}
const requestedDeg = parseInt(shArg ?? "1");
if (!(requestedDeg >= 0 && requestedDeg <= 3)) {
  console.error(`bad shDegree ${shArg}`);
  process.exit(2);
}

// --- parse the 3DGS ply header from the first 64 KB
const fd = openSync(inPath, "r");
const fileSize = fstatSync(fd).size;
const head = Buffer.alloc(Math.min(65536, fileSize));
readSync(fd, head, 0, head.length, 0);
let off = 0;
let n = 0;
const props = [];
for (;;) {
  const nl = head.indexOf(0x0a, off);
  if (nl < 0) {
    console.error(`${inPath}: no end_header in the first ${head.length} bytes`);
    process.exit(1);
  }
  const line = head.subarray(off, nl).toString("ascii").trim();
  off = nl + 1;
  if (line.startsWith("element vertex")) n = parseInt(line.split(" ").pop());
  else if (line.startsWith("property")) props.push(line.split(" ")[2]);
  else if (line === "end_header") break;
}
const col = Object.fromEntries(props.map((p, i) => [p, i]));
const stride = props.length;
for (const k of ["x", "y", "z", "opacity", "scale_0", "scale_1", "scale_2", "rot_0", "rot_1", "rot_2", "rot_3", "f_dc_0", "f_dc_1", "f_dc_2"]) {
  if (!(k in col)) {
    console.error(`${inPath}: missing property ${k}`);
    process.exit(1);
  }
}
if (off + n * stride * 4 > fileSize) {
  console.error(`${inPath}: header promises ${n} x ${stride} floats but the file has only ${fileSize - off} body bytes`);
  process.exit(1);
}

// ply f_rest is channel-major: [R: c0..cK-1, G: c0..cK-1, B: c0..cK-1]; K = 3 (deg 1), 8 (deg 2), 15 (deg 3)
const nrest = props.filter((p) => p.startsWith("f_rest_")).length;
const K = nrest / 3;
const have = K >= 15 ? 3 : K >= 8 ? 2 : K >= 3 ? 1 : 0;
let SH_DEG = requestedDeg;
if (SH_DEG > have) {
  console.error(`ply carries SH degree ${have}; writing degree ${have} instead of ${SH_DEG}`);
  SH_DEG = have;
}
// The writer sizes its buffer and stamps the header from shDegree, so it must be built AFTER the downgrade.
const w = new SpzWriter({ numSplats: n, shDegree: SH_DEG, fractionalBits: 12, flagAntiAlias: false });

const SH_C0 = 0.28209479177387814;
const sig = (x) => 1 / (1 + Math.exp(-x));
const sh1 = new Float32Array(9);
const sh2 = new Float32Array(15);
const sh3 = new Float32Array(21);
const CHUNK = 65536; // splats per read
const f32 = new Float32Array(CHUNK * stride);
const chunkBuf = Buffer.from(f32.buffer);
let badQuats = 0;
for (let start = 0; start < n; start += CHUNK) {
  const count = Math.min(CHUNK, n - start);
  const bytes = count * stride * 4;
  const got = readSync(fd, chunkBuf, 0, bytes, off + start * stride * 4);
  if (got !== bytes) {
    console.error(`${inPath}: short read at splat ${start}`);
    process.exit(1);
  }
  for (let j = 0; j < count; j++) {
    const i = start + j;
    const b = j * stride;
    const g = (k) => f32[b + col[k]];
    w.setCenter(i, g("x"), g("y"), g("z"));
    w.setAlpha(i, sig(g("opacity")));
    w.setRgb(i, 0.5 + SH_C0 * g("f_dc_0"), 0.5 + SH_C0 * g("f_dc_1"), 0.5 + SH_C0 * g("f_dc_2"));
    w.setScale(i, Math.exp(g("scale_0")), Math.exp(g("scale_1")), Math.exp(g("scale_2"))); // writer wants LINEAR scale (it logs internally)
    // ply is (w,x,y,z); spz wants (x,y,z,w). The writer normalizes, so a zero quaternion would become NaN.
    let qw = g("rot_0"), qx = g("rot_1"), qy = g("rot_2"), qz = g("rot_3");
    const norm = Math.hypot(qw, qx, qy, qz);
    if (!(norm > 1e-12)) {
      badQuats++;
      qw = 1; qx = 0; qy = 0; qz = 0;
    }
    w.setQuat(i, qx, qy, qz, qw);
    if (SH_DEG >= 1) {
      // spz wants coeff-major (c0 rgb, c1 rgb, ...)
      for (let c = 0; c < 3; c++) for (let ch = 0; ch < 3; ch++) sh1[c * 3 + ch] = f32[b + col[`f_rest_${ch * K + c}`]];
      if (SH_DEG >= 2) for (let c = 0; c < 5; c++) for (let ch = 0; ch < 3; ch++) sh2[c * 3 + ch] = f32[b + col[`f_rest_${ch * K + 3 + c}`]];
      if (SH_DEG >= 3) for (let c = 0; c < 7; c++) for (let ch = 0; ch < 3; ch++) sh3[c * 3 + ch] = f32[b + col[`f_rest_${ch * K + 8 + c}`]];
      w.setSh(i, sh1, SH_DEG >= 2 ? sh2 : undefined, SH_DEG >= 3 ? sh3 : undefined);
    }
  }
}
closeSync(fd);
if (badQuats) console.error(`${badQuats} zero-norm quaternions replaced with identity`);
const out = await w.finalize();
writeFileSync(outPath, out);
console.log(`${inPath} -> ${outPath}: ${n} splats, sh${SH_DEG}, ${(out.length / 1e6).toFixed(2)} MB, clipped ${w.clippedCount}`);
