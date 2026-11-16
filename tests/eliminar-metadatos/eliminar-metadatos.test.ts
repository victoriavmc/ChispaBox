import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PDFDocument } from 'pdf-lib';
import { leerMetadatos, limpiarMetadatos } from '../../src/shared/eliminar-metadatos.ts';

async function pdfConMetadatos(): Promise<Uint8Array> {
  const doc = await PDFDocument.create({ updateMetadata: false });
  doc.setTitle('Informe secreto');
  doc.setAuthor('Persona Real');
  doc.setSubject('Asunto privado');
  doc.setKeywords(['interno', 'borrador']);
  doc.setCreator('Programa X');
  doc.setProducer('Productor Y');
  doc.setCreationDate(new Date('2020-01-02T03:04:05Z'));
  doc.setModificationDate(new Date('2021-02-03T04:05:06Z'));
  doc.addPage([300, 400]).drawText('Contenido visible');
  doc.addPage([200, 200]);
  await doc.attach(new TextEncoder().encode('adjunto'), 'secreto.txt', { mimeType: 'text/plain' });
  return doc.save({ updateMetadata: false });
}

test('leerMetadatos muestra autor, programa, fechas y adjuntos', async () => {
  const m = await leerMetadatos(await pdfConMetadatos());
  assert.equal(m.autor, 'Persona Real');
  assert.equal(m.creador, 'Programa X');
  assert.equal(m.productor, 'Productor Y');
  assert.equal(m.titulo, 'Informe secreto');
  assert.equal(m.adjuntos, 1);
});

test('limpiarMetadatos borra todas las propiedades y conserva las páginas', async () => {
  const limpio = await limpiarMetadatos(await pdfConMetadatos());
  assert.equal(limpio.paginas, 2);
  const m = await leerMetadatos(limpio.bytes);
  assert.equal(m.titulo, '—');
  assert.equal(m.autor, '—');
  assert.equal(m.asunto, '—');
  assert.equal(m.palabrasClave, '—');
  assert.equal(m.creador, '—');
  assert.equal(m.productor, '—');
  assert.equal(m.creado, '—');
  assert.equal(m.modificado, '—');
  assert.equal(m.adjuntos, 0);
  const doc = await PDFDocument.load(limpio.bytes, { updateMetadata: false });
  assert.equal(doc.getPageCount(), 2);
  assert.equal(doc.getPage(0).getWidth(), 300);
});
