import { pathToFileURL } from 'node:url';
import { readFileSync } from 'node:fs';
globalThis.self ??= globalThis;
const glue = process.argv[2], wasm = process.argv[3];
globalThis.location ??= { href: pathToFileURL(glue).href };
const create = (await import(pathToFileURL(glue).href)).default;
const R = 48000, N = R * 2, b = Buffer.alloc(N * 4);
for (let i = 0; i < N; i++) { const v = Math.round(Math.sin(2 * Math.PI * 440 * i / R) * 0.5 * 32767); b.writeInt16LE(v, i * 4); b.writeInt16LE(v, i * 4 + 2); }
const h = Buffer.alloc(44); h.write('RIFF',0); h.writeUInt32LE(36+b.length,4); h.write('WAVE',8); h.write('fmt ',12); h.writeUInt32LE(16,16); h.writeUInt16LE(1,20); h.writeUInt16LE(2,22); h.writeUInt32LE(R,24); h.writeUInt32LE(R*4,28); h.writeUInt16LE(4,32); h.writeUInt16LE(16,34); h.write('data',36); h.writeUInt32LE(b.length,40);
const casos = {
  est32k: ['-c:a','libopus','-b:a','32k'],
  est64k: ['-c:a','libopus','-b:a','64k'],
  est96k: ['-c:a','libopus','-b:a','96k'],
  est128k: ['-c:a','libopus','-b:a','128k'],
  est48k_ar16k: ['-ar','16000','-c:a','libopus','-b:a','128k'],
  est44k: ['-ar','44100','-c:a','libopus','-b:a','128k'],
  mono128k: ['-ac','1','-c:a','libopus','-b:a','128k'],
};
for (const [nombre, extra] of Object.entries(casos)) {
  const m = await create({ wasmBinary: readFileSync(wasm) });
  const logs = []; m.setLogger(({ message }) => logs.push(message));
  m.FS.writeFile('in.wav', Buffer.concat([h, b]));
  let ret; try { ret = m.exec('-i','in.wav', ...extra, '-f','ogg','out.ogg'); } catch (e) { ret = 'EXC ' + e.message; }
  let size = -1; try { size = m.FS.readFile('out.ogg').length; } catch (e) {}
  console.log(nombre.padEnd(14), 'ret', String(ret).padEnd(8), 'bytes', size, '|', logs.filter(l => /fail|rror|invalid/i.test(l)).slice(-2).join(' / '));
}
