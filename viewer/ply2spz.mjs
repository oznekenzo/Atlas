// Write SPZ with Spark's own SpzWriter so the viewer's reader is guaranteed to accept it.
// usage: node ply2spz.mjs in.ply out.spz [shDegree]
import { readFileSync, writeFileSync } from "node:fs";
import { SpzWriter } from "@sparkjsdev/spark";

const [inPath, outPath, shArg] = process.argv.slice(2);
let SH_DEG = parseInt(shArg ?? "1");
const buf = readFileSync(inPath);
// --- parse 3DGS ply header
let off = 0, n = 0; const props = [];
for (;;) { const nl = buf.indexOf(0x0a, off); const line = buf.subarray(off, nl).toString("ascii").trim(); off = nl + 1;
  if (line.startsWith("element vertex")) n = parseInt(line.split(" ").pop());
  else if (line.startsWith("property")) props.push(line.split(" ")[2]);
  else if (line === "end_header") break; }
const col = Object.fromEntries(props.map((p, i) => [p, i])); const stride = props.length;
const f32 = new Float32Array(buf.buffer.slice(buf.byteOffset + off, buf.byteOffset + off + n * stride * 4));

const w = new SpzWriter({ numSplats: n, shDegree: SH_DEG, fractionalBits: 12, flagAntiAlias: false });
const SH_C0 = 0.28209479177387814; const sig = (x) => 1 / (1 + Math.exp(-x));
const sh1 = new Float32Array(9), sh2 = new Float32Array(15), sh3 = new Float32Array(21);
const nrest = props.filter(p => p.startsWith("f_rest_")).length;
// ply f_rest is channel-major: [R: c0..cK, G: c0..cK, B: c0..cK]; K = 3 (deg 1), 8 (deg 2), 15 (deg 3)
const K = nrest / 3; const have = K >= 15 ? 3 : K >= 8 ? 2 : K >= 3 ? 1 : 0;
if (SH_DEG > have) { console.error(`ply carries SH degree ${have}; writing degree ${have} instead of ${SH_DEG}`); SH_DEG = have; }
for (let i = 0; i < n; i++) {
  const b = i * stride; const g = (k) => f32[b + col[k]];
  w.setCenter(i, g("x"), g("y"), g("z"));
  w.setAlpha(i, sig(g("opacity")));
  w.setRgb(i, 0.5 + SH_C0 * g("f_dc_0"), 0.5 + SH_C0 * g("f_dc_1"), 0.5 + SH_C0 * g("f_dc_2"));
  w.setScale(i, Math.exp(g("scale_0")), Math.exp(g("scale_1")), Math.exp(g("scale_2")));   // writer wants LINEAR scale (it logs internally)
  w.setQuat(i, g("rot_1"), g("rot_2"), g("rot_3"), g("rot_0"));     // ply is (w,x,y,z); spz wants (x,y,z,w)
  if (SH_DEG >= 1) {
    // spz wants coeff-major (c0 rgb, c1 rgb, ...)
    for (let c = 0; c < 3; c++) for (let ch = 0; ch < 3; ch++) sh1[c * 3 + ch] = f32[b + col[`f_rest_${ch * K + c}`]];
    if (SH_DEG >= 2) for (let c = 0; c < 5; c++) for (let ch = 0; ch < 3; ch++) sh2[c * 3 + ch] = f32[b + col[`f_rest_${ch * K + 3 + c}`]];
    if (SH_DEG >= 3) for (let c = 0; c < 7; c++) for (let ch = 0; ch < 3; ch++) sh3[c * 3 + ch] = f32[b + col[`f_rest_${ch * K + 8 + c}`]];
    w.setSh(i, sh1, SH_DEG >= 2 ? sh2 : undefined, SH_DEG >= 3 ? sh3 : undefined);
  }
}
const out = await w.finalize();
writeFileSync(outPath, out);
console.log(`${inPath} -> ${outPath}: ${n} splats, sh${SH_DEG}, ${(out.length / 1e6).toFixed(2)} MB, clipped ${w.clippedCount}`);
