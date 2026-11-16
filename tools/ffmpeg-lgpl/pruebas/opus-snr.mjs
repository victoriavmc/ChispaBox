import { pathToFileURL } from 'node:url';
import { readFileSync } from 'node:fs';
globalThis.self ??= globalThis;
const [,, glue, wasm, rate] = process.argv; const R = Number(rate);
globalThis.location ??= { href: pathToFileURL(glue).href };
const create = (await import(pathToFileURL(glue).href)).default;
const N = R * 3, b = Buffer.alloc(N * 4);
for (let i = 0; i < N; i++) { const v = 0.3*Math.sin(2*Math.PI*440*i/R) + 0.2*Math.sin(2*Math.PI*1320*i/R); const s = Math.round(v*32767); b.writeInt16LE(s,i*4); b.writeInt16LE(Math.round(s*0.8),i*4+2); }
const h = Buffer.alloc(44); h.write('RIFF',0); h.writeUInt32LE(36+b.length,4); h.write('WAVE',8); h.write('fmt ',12); h.writeUInt32LE(16,16); h.writeUInt16LE(1,20); h.writeUInt16LE(2,22); h.writeUInt32LE(R,24); h.writeUInt32LE(R*4,28); h.writeUInt16LE(4,32); h.writeUInt16LE(16,34); h.write('data',36); h.writeUInt32LE(b.length,40);
const wavIn = Buffer.concat([h,b]);
const m = await create({ wasmBinary: readFileSync(wasm) });
m.FS.writeFile('in.wav', wavIn);
const r1 = m.exec('-i','in.wav','-c:a','libopus','-b:a','128k','-f','ogg','out.ogg');
const ogg = Buffer.from(m.FS.readFile('out.ogg'));
const m2 = await create({ wasmBinary: readFileSync(wasm) });
m2.FS.writeFile('in.ogg', ogg);
const r2 = m2.exec('-i','in.ogg','-f','wav','out.wav');
const dec = Buffer.from(m2.FS.readFile('out.wav'));
const rate2 = dec.readUInt32LE(24);
const pcm = (buf, ch=2) => { const d = buf.subarray(44); const f = Math.floor(d.length/(2*ch)); const o = new Float32Array(f); for (let i=0;i<f;i++) o[i] = d.readInt16LE(i*ch*2)/32768; return o; };
const ref = pcm(wavIn), out = pcm(dec);
let best = {lag:0,c:-Infinity}; const L = Math.min(ref.length, R*2);
for (let lag=-3000; lag<=3000; lag+=1) { let c=0; for (let i=0;i<L;i+=8){ const j=i+lag; if(j<0||j>=out.length) continue; c+=ref[i]*out[j]; } if (c>best.c) best={lag,c}; }
let se=0, sr=0, n=0; for (let i=0;i<L;i++){ const j=i+best.lag; if(j<0||j>=out.length) continue; const e=ref[i]-out[j]; se+=e*e; sr+=ref[i]*ref[i]; n++; }
console.log(`rate ${R} -> decoded ${rate2} Hz, ret ${r1}/${r2}, lag ${best.lag}, SNR ${(10*Math.log10(sr/se)).toFixed(1)} dB`);
