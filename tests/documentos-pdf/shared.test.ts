import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildPdf, inspectPdfStructure } from '../../src/shared/pdf-writer.ts';
import { computeLayout } from '../../src/shared/pdf-layout.ts';
import { sanitizeBaseName, dedupeBaseNames } from '../../src/shared/nombres-archivo.ts';
import { crc32, buildZipStore } from '../../src/shared/zip-store.ts';
import { readZip, buildZip } from '../../server/documentos-pdf/zip.ts';

const LIM = { maxEntries: 100, maxUncompressedBytes: 1_000_000 };
const base = { size: 'a4', orientation: 'automatica', margin: 'normal', fit: 'ajustar' } as const;

test('crc32 coincide con el valor de referencia', () => {
  assert.equal(crc32(new TextEncoder().encode('123456789')), 0xcbf43926);
});

test('ZIP escrito se lee de vuelta con el mismo contenido', () => {
  const data = buildZipStore([
    { name: 'a.pdf', data: new TextEncoder().encode('hola') },
    { name: 'carpeta/ñandú (2).pdf', data: new Uint8Array([0, 1, 2, 255]) },
  ]);
  const back = readZip(Buffer.from(data), LIM);
  assert.equal(back.length, 2);
  assert.equal(back[0].name, 'a.pdf');
  assert.equal(back[0].data.toString('utf8'), 'hola');
  assert.equal(back[1].name, 'carpeta/ñandú (2).pdf');
  assert.deepEqual([...back[1].data], [0, 1, 2, 255]);
});

test('readZip rechaza rutas peligrosas', () => {
  const backslash = 'a' + String.fromCharCode(92) + 'b.txt';
  for (const name of ['../x.txt', '/abs.txt', backslash, 'C:/x.txt']) {
    const zip = buildZip([{ name, data: Buffer.from('x') }]);
    assert.throws(() => readZip(zip, LIM), /rutas internas/, name);
  }
});

test('readZip aplica el límite de descompresión antes de inflar', () => {
  const zip = buildZip([{ name: 'a', data: Buffer.alloc(5000) }]);
  assert.throws(() => readZip(zip, { maxEntries: 10, maxUncompressedBytes: 100 }), /límite permitido/);
});

test('readZip rechaza entradas por encima del límite de cantidad', () => {
  const zip = buildZip([{ name: 'a', data: Buffer.from('1') }, { name: 'b', data: Buffer.from('2') }]);
  assert.throws(() => readZip(zip, { maxEntries: 1, maxUncompressedBytes: 100 }), /demasiadas partes/);
});

test('readZip rechaza datos que no son ZIP', () => {
  assert.throws(() => readZip(Buffer.from('esto no es un zip, es texto plano de prueba'), LIM), /ZIP válida/);
});

test('buildPdf genera un PDF con estructura verificable', () => {
  const img = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]); // contenido no decodificado: solo se prueba la estructura
  const pdf = buildPdf([
    { width: 595, height: 842, x: 36, y: 36, drawWidth: 523, drawHeight: 770, image: { width: 10, height: 10, encoding: 'jpeg', data: img } },
    { width: 842, height: 595, x: 0, y: 0, drawWidth: 842, drawHeight: 595, image: { width: 20, height: 10, encoding: 'flate', data: new Uint8Array(12) } },
    { width: 100.5, height: 200, x: 0, y: 0, drawWidth: 100.5, drawHeight: 200, image: { width: 1, height: 1, encoding: 'jpeg', data: img } },
  ]);
  const info = inspectPdfStructure(pdf);
  assert.equal(info.ok, true, info.reason);
  assert.equal(info.pages, 3);
  assert.match(new TextDecoder('latin1').decode(pdf), /\/MediaBox \[0 0 595 842\]/);
});

test('inspectPdfStructure detecta un desfase en la tabla xref', () => {
  const pdf = buildPdf([
    { width: 100, height: 100, x: 0, y: 0, drawWidth: 100, drawHeight: 100, image: { width: 1, height: 1, encoding: 'jpeg', data: new Uint8Array([1]) } },
  ]);
  const text = new TextDecoder('latin1').decode(pdf).replace(/(\d{10}) 00000 n/g, (m, off: string) => `${String(Number(off) + 1).padStart(10, '0')} 00000 n`);
  const info = inspectPdfStructure(new TextEncoder().encode(text));
  assert.equal(info.ok, false);
});

test('computeLayout: ajustar mantiene la proporción y centra', () => {
  const l = computeLayout(1000, 500, base);
  assert.equal(l.orientation, 'horizontal'); // automática: imagen apaisada
  assert.ok(Math.abs(l.width / l.height - 2) < 1e-9);
  assert.ok(l.x >= l.marginPt - 1e-9 && l.x + l.width <= l.pageWidth - l.marginPt + 1e-6);
  assert.equal(l.cropped, false);
});

test('computeLayout: vertical forzado sobre imagen apaisada usa A4 vertical', () => {
  const l = computeLayout(1000, 500, { ...base, orientation: 'vertical' });
  assert.equal(l.pageWidth, 595.28);
  assert.equal(l.orientation, 'vertical');
});

test('computeLayout: rellenar ocupa la página y recorta', () => {
  const l = computeLayout(1000, 500, { ...base, fit: 'rellenar', margin: 'normal' });
  assert.equal(l.cropped, true);
  assert.ok(l.width >= l.pageWidth - 1e-6 && l.height >= l.pageHeight - 1e-6);
});

test('computeLayout: tamaño original no amplía imágenes pequeñas', () => {
  const l = computeLayout(100, 100, { ...base, fit: 'original' });
  assert.equal(l.scale, 1);
  assert.ok(Math.abs(l.width - 75) < 1e-9);
});

test('computeLayout: ajustado a la imagen crea página del tamaño de la imagen más márgenes', () => {
  const l = computeLayout(400, 300, { size: 'ajustado', orientation: 'automatica', margin: 'reducido', fit: 'ajustar' });
  assert.ok(Math.abs(l.pageWidth - (300 + 24)) < 1e-6);
  assert.ok(Math.abs(l.pageHeight - (225 + 24)) < 1e-6);
});

test('computeLayout: imágenes enormes se limitan al máximo del PDF', () => {
  const l = computeLayout(30_000, 100, { size: 'ajustado', orientation: 'automatica', margin: 'ninguno', fit: 'ajustar' });
  assert.equal(l.clampedToPdfLimits, true);
  assert.ok(l.pageWidth <= 14400);
});

test('sanitizeBaseName conserva tildes y ñ, quita caracteres peligrosos', () => {
  assert.equal(sanitizeBaseName('Trabajo final.pdf', 'x'), 'Trabajo final');
  assert.equal(sanitizeBaseName('Año ñandú: versión 2?', 'x'), 'Año ñandú versión 2');
  assert.equal(sanitizeBaseName('../../etc/passwd', 'x'), 'etc passwd');
  assert.equal(sanitizeBaseName('   ', 'Documento'), 'Documento');
  assert.equal(sanitizeBaseName('CON', 'x'), '_CON');
});

test('dedupeBaseNames evita nombres repetidos', () => {
  assert.deepEqual(dedupeBaseNames(['foto', 'Foto', 'otra']), ['foto', 'Foto (2)', 'otra']);
});
