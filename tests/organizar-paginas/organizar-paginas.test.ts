import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PDFDocument } from 'pdf-lib';
import { construirPdf, girar, leerPdfOrganizable, ORGANIZAR_LIMITS } from '../../src/shared/organizar-paginas.ts';

async function pdfDeN(paginas: number): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < paginas; i += 1) doc.addPage([200, 300]);
  return doc.save();
}

test('girar suma y resta 90° sin salirse de 0..270', () => {
  assert.equal(girar(0, 90), 90);
  assert.equal(girar(270, 90), 0);
  assert.equal(girar(0, -90), 270);
  assert.equal(girar(90, -90), 0);
});

test('leerPdfOrganizable acepta un PDF válido y rechaza lo que no lo es', async () => {
  const r = await leerPdfOrganizable(await pdfDeN(3));
  assert.equal(r.paginas, 3);
  await assert.rejects(leerPdfOrganizable(new TextEncoder().encode('no es pdf')), /no es un PDF/);
});

test('construirPdf reordena, quita (no incluye) y extrae según la lista', async () => {
  const { doc } = await leerPdfOrganizable(await pdfDeN(5));
  const bytes = await construirPdf(doc, [
    { original: 4, giro: 0 },
    { original: 1, giro: 0 },
  ]);
  const leido = await PDFDocument.load(bytes, { updateMetadata: false });
  assert.equal(leido.getPageCount(), 2);
});

test('construirPdf aplica el giro sumando al giro original de la página', async () => {
  const base = await PDFDocument.create();
  const p = base.addPage([200, 300]);
  p.setRotation({ type: 'degrees', angle: 90 } as never);
  const { doc } = await leerPdfOrganizable(await base.save());
  const bytes = await construirPdf(doc, [{ original: 1, giro: 90 }]);
  const leido = await PDFDocument.load(bytes, { updateMetadata: false });
  assert.equal(leido.getPage(0).getRotation().angle, 180);
});

test('construirPdf rechaza páginas inexistentes, giros inválidos y listas vacías', async () => {
  const { doc } = await leerPdfOrganizable(await pdfDeN(2));
  await assert.rejects(construirPdf(doc, [{ original: 3, giro: 0 }]), /no existe/);
  await assert.rejects(construirPdf(doc, [{ original: 1, giro: 45 as never }]), /Giro no válido/);
  await assert.rejects(construirPdf(doc, []), /No hay páginas/);
});

test('construirPdf no añade metadatos de la librería', async () => {
  const { doc } = await leerPdfOrganizable(await pdfDeN(1));
  const bytes = await construirPdf(doc, [{ original: 1, giro: 0 }]);
  const leido = await PDFDocument.load(bytes, { updateMetadata: false });
  assert.equal(leido.getProducer(), undefined);
  assert.ok(ORGANIZAR_LIMITS.maxPaginas >= 1);
});
