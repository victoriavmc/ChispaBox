// Arnés de pruebas: convierte audio sintético con un núcleo FFmpeg WASM (una hebra) y mide.
// Uso: node prueba-nucleo.mjs <ruta_glue.js> <ruta_wasm> <etiqueta> <salida.json>
import { pathToFileURL } from 'node:url';
import { readFileSync, writeFileSync } from 'node:fs';
globalThis.self ??= globalThis;
globalThis.location ??= { href: pathToFileURL(process.argv[2]).href };

const [, , glueArg, wasmArg, etiqueta, salidaArg] = process.argv;

// ---- WAV sintético (sin dependencias) ----
function wav({ rate, channels, seconds, freqs }) {
  const n = Math.round(rate * seconds);
  const data = Buffer.alloc(n * channels * 2);
  for (let i = 0; i < n; i++) {
    const t = i / rate;
    let v = 0;
    for (const f of freqs) v += Math.sin(2 * Math.PI * f * t);
    v = (v / freqs.length) * 0.6;
    for (let c = 0; c < channels; c++) {
      const s = Math.round(Math.max(-1, Math.min(1, v * (c ? 0.8 : 1))) * 32767);
      data.writeInt16LE(s, (i * channels + c) * 2);
    }
  }
  const h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + data.length, 4); h.write('WAVE', 8);
  h.write('fmt ', 12); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(channels, 22);
  h.writeUInt32LE(rate, 24); h.writeUInt32LE(rate * channels * 2, 28); h.writeUInt16LE(channels * 2, 32);
  h.writeUInt16LE(16, 34); h.write('data', 36); h.writeUInt32LE(data.length, 40);
  return Buffer.concat([h, data]);
}

// Lee PCM 16 bits de un WAV producido por FFmpeg (cabecera de 44 bytes en pcm_s16le).
function pcmDeWav(buf) {
  let off = 12;
  let channels = 0, rate = 0;
  while (off < buf.length - 8) {
    const id = buf.toString('ascii', off, off + 4);
    const size = buf.readUInt32LE(off + 4);
    if (id === 'fmt ') { channels = buf.readUInt16LE(off + 10); rate = buf.readUInt32LE(off + 12); }
    if (id === 'data') {
      const d = buf.subarray(off + 8, off + 8 + size);
      const frames = Math.floor(d.length / (2 * channels));
      const mono = new Float32Array(frames);
      for (let i = 0; i < frames; i++) mono[i] = d.readInt16LE(i * channels * 2) / 32768;
      return { mono, rate, channels, frames };
    }
    off += 8 + size + (size % 2);
  }
  throw new Error('WAV sin bloque data');
}

// SNR tras alinear el retardo del códec (búsqueda de correlación en ±4000 muestras).
function snrAlineado(ref, dec) {
  const L = Math.min(ref.length, 44100 * 2);
  let mejor = { lag: 0, corr: -Infinity };
  for (let lag = -4000; lag <= 4000; lag += 2) {
    let c = 0;
    for (let i = 0; i < L; i += 4) {
      const j = i + lag;
      if (j < 0 || j >= dec.length) continue;
      c += ref[i] * dec[j];
    }
    if (c > mejor.corr) mejor = { lag, corr: c };
  }
  let se = 0, sr = 0, n = 0;
  for (let i = 0; i < L; i++) {
    const j = i + mejor.lag;
    if (j < 0 || j >= dec.length) continue;
    const e = ref[i] - dec[j];
    se += e * e; sr += ref[i] * ref[i]; n++;
  }
  return n && se > 0 ? 10 * Math.log10(sr / se) : 99;
}

async function nuevoNucleo() {
  const mod = await import(pathToFileURL(glueArg).href);
  const createFFmpegCore = mod.default ?? mod.createFFmpegCore;
  const salida = [];
  const errores = [];
  let instancia = null;
  instancia = await createFFmpegCore({
    wasmBinary: readFileSync(wasmArg),
    locateFile: (f) => (f.endsWith('.wasm') ? wasmArg : f),
    print: (t) => salida.push(t),
    printErr: (t) => errores.push(t),
  });
  instancia.setLogger?.(({ message }) => salida.push(message));
  return { m: instancia, salida, errores };
}

// Ejecuta ffmpeg con argumentos en un núcleo nuevo (EXIT_RUNTIME=1: una instancia por ejecución).
async function ffmpeg(args, archivos) {
  const { m, salida, errores } = await nuevoNucleo();
  for (const [nombre, datos] of Object.entries(archivos)) m.FS.writeFile(nombre, datos);
  const t0 = performance.now();
  let codigo = 0;
  try {
    codigo = m.exec(...args);
  } catch (e) {
    codigo = e?.status ?? -1;
  }
  const ms = performance.now() - t0;
  const memoriaMB = m.HEAPU8 ? m.HEAPU8.length / 1048576 : null;
  return { codigo, ms, memoriaMB, salida, errores, m };
}

const casos = [
  { nombre: 'mp3', args: ['-i', 'in.wav', '-map', '0:a:0', '-vn', '-c:a', 'libmp3lame', '-b:a', '128k', '-f', 'mp3', 'out.mp3'], ext: 'mp3', decode: ['-i', 'in.mp3', '-f', 'wav', 'out.wav'] },
  { nombre: 'ogg', args: ['-i', 'in.wav', '-map', '0:a:0', '-vn', '-c:a', 'libopus', '-b:a', '128k', '-f', 'ogg', 'out.ogg'], ext: 'ogg', decode: ['-i', 'in.ogg', '-f', 'wav', 'out.wav'] },
  { nombre: 'webm', args: ['-i', 'in.wav', '-map', '0:a:0', '-vn', '-c:a', 'libopus', '-b:a', '128k', '-f', 'webm', 'out.webm'], ext: 'webm', decode: ['-i', 'in.webm', '-f', 'wav', 'out.wav'] },
  { nombre: 'm4a', args: ['-i', 'in.wav', '-map', '0:a:0', '-vn', '-c:a', 'aac', '-b:a', '128k', '-f', 'mp4', '-movflags', '+faststart', 'out.m4a'], ext: 'm4a', decode: ['-i', 'in.m4a', '-f', 'wav', 'out.wav'] },
  { nombre: 'flac', args: ['-i', 'in.wav', '-map', '0:a:0', '-vn', '-c:a', 'flac', '-f', 'flac', 'out.flac'], ext: 'flac', decode: ['-i', 'in.flac', '-f', 'wav', 'out.wav'] },
  { nombre: 'wav', args: ['-i', 'in.wav', '-map', '0:a:0', '-vn', '-c:a', 'pcm_s16le', '-f', 'wav', 'out.wav'], ext: 'wav', decode: null },
];

const original = wav({ rate: 44100, channels: 2, seconds: 3, freqs: [440, 1320] });
const ref = pcmDeWav(original);
const resultados = { etiqueta, casos: {} };

// Versión de la compilación y codificadores disponibles
{
  const r = await ffmpeg(['-encoders'], {});
  resultados.codificadores = r.salida.join('\n');
  const f = await ffmpeg(['-formats'], {});
  resultados.formatos = f.salida.join('\n');
  const v = await ffmpeg(['-version'], {});
  resultados.version = v.salida.slice(0, 3).join('\n');
  const c = await ffmpeg(['-buildconf'], {});
  resultados.buildconf = c.salida.join('\n');
}

for (const caso of casos) {
  const codificar = await ffmpeg(caso.args, { 'in.wav': original });
  const salidaArchivo = codificar.m.FS.readFile ? (() => { try { return Buffer.from(codificar.m.FS.readFile(caso.args.at(-1))); } catch { return null; } })() : null;
  const reg = { codigo: codificar.codigo, ms: Math.round(codificar.ms), memoriaMB: codificar.memoriaMB, bytes: salidaArchivo?.length ?? 0 };
  if (codificar.codigo !== 0) reg.errorCodificar = codificar.salida.slice(-4);
  if (salidaArchivo && caso.decode) {
    const d = await ffmpeg(caso.decode, { [`in.${caso.ext}`]: salidaArchivo });
    const decWav = (() => { try { return Buffer.from(d.m.FS.readFile('out.wav')); } catch { return null; } })();
    reg.decodificacion = { codigo: d.codigo, ms: Math.round(d.ms) };
    if (d.codigo !== 0) reg.errorDecodificar = d.salida.slice(-4);
    if (decWav) {
      const p = pcmDeWav(decWav);
      reg.duracionSeg = +(p.frames / p.rate).toFixed(3);
      reg.canales = p.channels;
      reg.tasa = p.rate;
      reg.snrDB = +snrAlineado(ref.mono, p.mono).toFixed(1);
    }
  }
  resultados.casos[caso.nombre] = reg;
}

writeFileSync(salidaArg, JSON.stringify(resultados, null, 2));
console.log(`OK ${etiqueta} -> ${salidaArg}`);
