import { test } from 'node:test';
import assert from 'node:assert/strict';
import { agruparEnLineas, bloquesADocx, lineasABloques } from '../../server/documentos-pdf/pdf-texto.ts';

test('agrupa fragmentos de la misma base en una línea, en orden de lectura', () => {
  const lineas = agruparEnLineas(
    [
      { str: 'mundo', x: 68, y: 700, ancho: 30, alto: 10 },
      { str: 'Hola', x: 40, y: 700, ancho: 25, alto: 10 },
      { str: 'Otra', x: 40, y: 680, ancho: 25, alto: 10 },
    ],
    1,
  );
  assert.deepEqual(
    lineas.map((l) => l.texto),
    ['Hola mundo', 'Otra'],
  );
});

test('detecta títulos por tamaño, viñetas y une párrafos sin cortes falsos', () => {
  const bloques = lineasABloques([
    { texto: 'Título grande', tamano: 24, y: 760, pagina: 1 },
    { texto: 'Primera línea del', tamano: 10, y: 700, pagina: 1 },
    { texto: 'párrafo', tamano: 10, y: 688, pagina: 1 },
    { texto: '• un elemento', tamano: 10, y: 670, pagina: 1 },
    { texto: 'Subtítulo', tamano: 14, y: 640, pagina: 1 },
  ]);
  assert.deepEqual(bloques, [
    { tipo: 'titulo1', texto: 'Título grande' },
    { tipo: 'parrafo', texto: 'Primera línea del párrafo' },
    { tipo: 'vineta', texto: 'un elemento' },
    { tipo: 'titulo2', texto: 'Subtítulo' },
  ]);
});

test('une palabras cortadas con guion al final de línea', () => {
  const bloques = lineasABloques([
    { texto: 'La inteligen-', tamano: 10, y: 700, pagina: 1 },
    { texto: 'cia es útil.', tamano: 10, y: 688, pagina: 1 },
  ]);
  assert.deepEqual(bloques, [{ tipo: 'parrafo', texto: 'La inteligencia es útil.' }]);
});

test('el .docx generado es un ZIP con document.xml y escapa caracteres especiales', () => {
  const docx = bloquesADocx([{ tipo: 'parrafo', texto: 'A & B <c>' }]);
  assert.equal(docx.subarray(0, 2).toString('latin1'), 'PK');
  assert.ok(docx.includes(Buffer.from('word/document.xml')));
  assert.ok(docx.includes(Buffer.from('A &amp; B &lt;c&gt;')));
});
