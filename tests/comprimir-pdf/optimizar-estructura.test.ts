import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PDFDocument } from 'pdf-lib';
import { optimizarEstructura } from '../../src/shared/comprimir-pdf.ts';

test('optimizarEstructura conserva el número de páginas y sus tamaños', async () => {
  const doc = await PDFDocument.create();
  doc.addPage([595, 842]);
  doc.addPage([300, 400]);
  const salida = await optimizarEstructura(await doc.save());
  const leido = await PDFDocument.load(salida, { updateMetadata: false });
  assert.equal(leido.getPageCount(), 2);
  assert.equal(leido.getPage(1).getWidth(), 300);
});

test('optimizarEstructura reduce un PDF con objetos sobrantes', async () => {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont('Helvetica');
  for (let i = 0; i < 3; i += 1) {
    doc.addPage([200, 200]).drawText(`Hola ${i}`, { font, size: 12 });
  }
  const original = await doc.save({ useObjectStreams: false });
  const salida = await optimizarEstructura(original);
  assert.ok(salida.length <= original.length);
});
