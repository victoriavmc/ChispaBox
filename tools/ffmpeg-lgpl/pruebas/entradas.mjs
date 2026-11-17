import { pathToFileURL } from 'node:url';
import { readFileSync } from 'node:fs';
globalThis.self ??= globalThis;
const [,, glue, wasm] = process.argv;
globalThis.location ??= { href: pathToFileURL(glue).href };
const create = (await import(pathToFileURL(glue).href)).default;
const R = 44100, N = R * 2, b = Buffer.alloc(N * 4);
for (let i = 0; i < N; i++) { const s = Math.round(0.4*Math.sin(2*Math.PI*440*i/R)*32767); b.writeInt16LE(s,i*4); b.writeInt16LE(s,i*4+2); }
const h = Buffer.alloc(44); h.write('RIFF',0); h.writeUInt32LE(36+b.length,4); h.write('WAVE',8); h.write('fmt ',12); h.writeUInt32LE(16,16); h.writeUInt16LE(1,20); h.writeUInt16LE(2,22); h.writeUInt32LE(R,24); h.writeUInt32LE(R*4,28); h.writeUInt16LE(4,32); h.writeUInt16LE(16,34); h.write('data',36); h.writeUInt32LE(b.length,40);
const wavIn = Buffer.concat([h,b]);
const run = async (args, files) => { const m = await create({ wasmBinary: readFileSync(wasm) }); for (const [k,v] of Object.entries(files)) m.FS.writeFile(k,v); const r = m.exec(...args); let out=null; try { out = Buffer.from(m.FS.readFile(args.at(-1))); } catch(e){} return { r, out }; };
const mk = await run(['-i','in.wav','-c:a','libopus','-b:a','96k','-f','matroska','a.mkv'], { 'in.wav': wavIn });
const mov = await run(['-i','in.wav','-c:a','aac','-b:a','128k','-f','mov','a.mov'], { 'in.wav': wavIn });
const dec = async (name, buf) => { const d = await run(['-i',name,'-f','wav','o.wav'], { [name]: buf }); return d.r + (d.out ? ' ok ' + d.out.length + 'B' : ' sin salida'); };
console.log('mkv(opus) enc', mk.r, 'dec ->', mk.out ? await dec('a.mkv', mk.out) : 'n/a');
console.log('mov(aac) enc', mov.r, 'dec ->', mov.out ? await dec('a.mov', mov.out) : 'n/a');
const ogg = await run(['-i','in.wav','-c:a','libopus','-b:a','128k','-f','ogg','a.ogg'], { 'in.wav': wavIn });
console.log('ogg(opus) enc', ogg.r, 'dec ->', ogg.out ? await dec('a.ogg', ogg.out) : 'n/a');
