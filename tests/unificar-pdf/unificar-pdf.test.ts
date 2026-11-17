import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PDFDocument } from 'pdf-lib';
import {
  UNIFICAR_LIMITS,
  esFirmaPdf,
  leerPaginas,
  unificarPdfs,
  validarLote,
} from '../../src/shared/unificar-pdf.ts';

async function pdfDeN(paginas: number): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < paginas; i += 1) doc.addPage([200, 300]);
  return doc.save();
}

test('esFirmaPdf reconoce %PDF- y rechaza otros contenidos', () => {
  assert.equal(esFirmaPdf(new TextEncoder().encode('%PDF-1.7 ...')), true);
  assert.equal(esFirmaPdf(new TextEncoder().encode('PK\u0003\u0004')), false);
  assert.equal(esFirmaPdf(new Uint8Array([0x25, 0x50])), false);
});

test('leerPaginas devuelve el número de páginas y rechaza bytes que no son PDF', async () => {
  assert.equal(await leerPaginas(await pdfDeN(4)), 4);
  await assert.rejects(leerPaginas(new TextEncoder().encode('no soy pdf')), /no es un PDF válido/);
});

test('unificarPdfs respeta el orden recibido y suma las páginas', async () => {
  const entradas = [await pdfDeN(2), await pdfDeN(1), await pdfDeN(3)];
  const r = await unificarPdfs(entradas);
  assert.equal(r.paginas, 6);
  assert.equal((await PDFDocument.load(r.bytes)).getPageCount(), 6);
});

test('unificarPdfs no añade metadatos de la librería ni del origen', async () => {
  const doc = await PDFDocument.create();
  doc.setTitle('Privado');
  doc.addPage();
  const r = await unificarPdfs([await doc.save()]);
  const leido = await PDFDocument.load(r.bytes, { updateMetadata: false });
  assert.equal(leido.getTitle(), undefined);
  assert.equal(leido.getProducer(), undefined);
});

test('validarLote exige al menos dos archivos y respeta los límites', () => {
  assert.notEqual(validarLote([{ bytes: 10, paginas: 1 }]), null);
  assert.equal(validarLote([{ bytes: 10, paginas: 1 }, { bytes: 10, paginas: 1 }]), null);
  const muchos = Array.from({ length: UNIFICAR_LIMITS.maxArchivos + 1 }, () => ({ bytes: 1, paginas: 1 }));
  assert.notEqual(validarLote(muchos), null);
  const pesado = [
    { bytes: UNIFICAR_LIMITS.maxBytesTotal, paginas: 1 },
    { bytes: 1, paginas: 1 },
  ];
  assert.notEqual(validarLote(pesado), null);
  const largo = [
    { bytes: 1, paginas: UNIFICAR_LIMITS.maxPaginasTotal },
    { bytes: 1, paginas: 1 },
  ];
  assert.notEqual(validarLote(largo), null);
});
