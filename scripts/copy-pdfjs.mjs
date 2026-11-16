// Copia los recursos de PDF.js (worker, mapas de caracteres, fuentes estándar y WASM) a public/pdfjs/.
// Así la vista previa de PDF funciona sin conexión y sin CDN. Se ejecuta antes de `dev` y `build`.
// Uso: npm run copy:pdfjs

import { cp, mkdir, rm, copyFile, access } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE = join(ROOT, 'node_modules', 'pdfjs-dist');
const TARGET = join(ROOT, 'public', 'pdfjs');

const FILES = ['build/pdf.worker.min.mjs'];
const DIRS = ['cmaps', 'standard_fonts', 'wasm'];

await access(join(SOURCE, 'package.json')).catch(() => {
  console.error('Falta node_modules/pdfjs-dist. Ejecutá `npm ci` primero.');
  process.exit(1);
});

await rm(TARGET, { recursive: true, force: true });
await mkdir(TARGET, { recursive: true });
for (const file of FILES) await copyFile(join(SOURCE, file), join(TARGET, file.split('/').pop()));
for (const dir of DIRS) await cp(join(SOURCE, dir), join(TARGET, dir), { recursive: true });
console.log(`PDF.js copiado a public/pdfjs (${FILES.length} archivo y ${DIRS.length} carpetas).`);
