// Copia Tesseract.js (worker, núcleo WASM y datos de idioma) a public/ocr/.
// Así el OCR funciona sin conexión y sin CDN: el navegador solo pide archivos del mismo origen.
// Se ejecuta antes de `dev` y `build` (igual que copy-pdfjs.mjs).
// Uso (desde extras/local): npm run copy:ocr

import { access, copyFile, mkdir, readdir, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const LOCAL = join(dirname(fileURLToPath(import.meta.url)), '..');
// Los archivos del OCR se sirven desde public/ del repositorio (raíz), no desde extras/local.
const ROOT = join(LOCAL, '..', '..');
// Dependencias de OCR: paquete local independiente (ignorado por Git). OCR_NODE_MODULES permite otra ruta.
const NM = process.env.OCR_NODE_MODULES ?? join(LOCAL, 'node_modules');
const TESSERACT = join(NM, 'tesseract.js');
const CORE = join(NM, 'tesseract.js-core');
const TARGET = join(ROOT, 'public', 'ocr');
const TARGET_CORE = join(TARGET, 'core');
const TARGET_LANG = join(TARGET, 'lang');

// Idiomas incluidos: variante «best_int» (modelo LSTM entero, ~2-3 MB por idioma).
const LANG_PACKAGES = [
  { code: 'spa', source: join(NM, '@tesseract.js-data', 'spa', '4.0.0_best_int', 'spa.traineddata.gz') },
  { code: 'eng', source: join(NM, '@tesseract.js-data', 'eng', '4.0.0_best_int', 'eng.traineddata.gz') },
];

await access(join(TESSERACT, 'package.json')).catch(() => {
  console.error('Falta node_modules/tesseract.js. Ejecutá `npm ci` primero.');
  process.exit(1);
});

await rm(TARGET, { recursive: true, force: true });
await mkdir(TARGET_CORE, { recursive: true });
await mkdir(TARGET_LANG, { recursive: true });

// Worker de Tesseract.js (se carga con importScripts desde un Blob del mismo origen).
await copyFile(join(TESSERACT, 'dist', 'worker.min.js'), join(TARGET, 'worker.min.js'));

// Núcleos WASM con LSTM (los que usa Tesseract.js 7). Se copian todas las variantes para que
// el navegador elija la que soporta (SIMD / relaxed-SIMD / básica).
const coreFiles = (await readdir(CORE)).filter((name) => /^tesseract-core.*lstm.*\.(js|wasm)$/.test(name));
if (coreFiles.length === 0) {
  console.error('No se encontraron los núcleos LSTM de tesseract.js-core.');
  process.exit(1);
}
for (const file of coreFiles) await copyFile(join(CORE, file), join(TARGET_CORE, file));

// Datos de idioma: Tesseract.js pide `<langPath>/<idioma>.traineddata.gz`.
for (const lang of LANG_PACKAGES) {
  await copyFile(lang.source, join(TARGET_LANG, `${lang.code}.traineddata.gz`));
}

console.log(`Tesseract.js copiado a public/ocr (worker, ${coreFiles.length} núcleos y ${LANG_PACKAGES.length} idiomas).`);
