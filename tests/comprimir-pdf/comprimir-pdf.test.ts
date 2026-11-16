import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PDFDocument } from 'pdf-lib';
import { COMPRIMIR_LIMITS, decidirEntrega, escalaParaDpi, NIVELES } from '../../src/shared/comprimir-pdf.ts';

test('escalaParaDpi calcula 72 puntos por pulgada y limita el lado máximo', () => {
  assert.equal(escalaParaDpi(144, 100, 100), 2);
  const grande = escalaParaDpi(600, 2000, 2000);
  assert.ok(2000 * grande <= COMPRIMIR_LIMITS.maxLadoPx + 1e-9);
});

test('los niveles de correo comprimen más que los de impresión', () => {
  assert.ok(NIVELES.correo.dpi < NIVELES.impresion.dpi);
  assert.ok(NIVELES.correo.calidad < NIVELES.impresion.calidad);
});

test('decidirEntrega solo entrega si el resultado pesa menos que el original', () => {
  const ok = decidirEntrega(1000, 400);
  assert.equal(ok.ok, true);
  if (ok.ok) assert.equal(ok.ahorro, 60);
  assert.equal(decidirEntrega(1000, 1000).ok, false);
  assert.equal(decidirEntrega(1000, 1200).ok, false);
  assert.equal(decidirEntrega(1000, 0).ok, false);
});

test('un PDF de páginas vacías se puede leer con pdf-lib (sanidad de la dependencia)', async () => {
  const doc = await PDFDocument.create();
  doc.addPage([595, 842]);
  const leido = await PDFDocument.load(await doc.save(), { updateMetadata: false });
  assert.equal(leido.getPage(0).getWidth(), 595);
});
