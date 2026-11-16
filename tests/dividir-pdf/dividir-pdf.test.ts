import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PDFDocument } from 'pdf-lib';
import {
  DIVIDIR_LIMITS,
  cargarPdf,
  dividirPdf,
  etiquetaIntervalo,
  intervalosDePaginas,
  intervalosPorPagina,
  parseIntervalos,
  unirPaginas,
} from '../../src/shared/dividir-pdf.ts';

async function pdfDeN(paginas: number): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < paginas; i += 1) doc.addPage([200, 300]);
  return doc.save();
}

test('parseIntervalos acepta rangos, páginas sueltas y espacios', () => {
  assert.deepEqual(parseIntervalos('3-8', 10), { ok: true, intervalos: [{ desde: 3, hasta: 8 }] });
  assert.deepEqual(parseIntervalos(' 1, 4 , 6 – 9 ,10', 10), {
    ok: true,
    intervalos: [
      { desde: 1, hasta: 1 },
      { desde: 4, hasta: 4 },
      { desde: 6, hasta: 9 },
      { desde: 10, hasta: 10 },
    ],
  });
});

test('parseIntervalos rechaza vacío, formatos inválidos, fuera de rango y rangos al revés', () => {
  for (const texto of ['', '   ', 'abc', '3-', '-5', '1..4', '2;3', '0-3', '5-11', '8-3', '1,,2']) {
    const r = parseIntervalos(texto, 10);
    assert.equal(r.ok, false, `debería rechazar «${texto}»`);
  }
});

test('parseIntervalos limita la cantidad de intervalos y el largo del texto', () => {
  const muchos = Array.from({ length: DIVIDIR_LIMITS.maxIntervalos + 1 }, () => '1').join(',');
  assert.equal(parseIntervalos(muchos, 10).ok, false);
  assert.equal(parseIntervalos('1'.repeat(301), 10).ok, false);
});

test('intervalosPorPagina genera una entrada por página', () => {
  assert.deepEqual(intervalosPorPagina(3), [
    { desde: 1, hasta: 1 },
    { desde: 2, hasta: 2 },
    { desde: 3, hasta: 3 },
  ]);
});

test('intervalosDePaginas usa solo las páginas elegidas, ordenadas y sin repetir', () => {
  assert.deepEqual(intervalosDePaginas([5, 2, 5, 9], 10), [
    { desde: 2, hasta: 2 },
    { desde: 5, hasta: 5 },
    { desde: 9, hasta: 9 },
  ]);
  assert.deepEqual(intervalosDePaginas([], 10), []);
  assert.throws(() => intervalosDePaginas([0], 10));
  assert.throws(() => intervalosDePaginas([11], 10));
  assert.throws(() => intervalosDePaginas([1.5], 10));
});

test('unirPaginas crea un solo PDF con las páginas elegidas, en orden', async () => {
  const origen = await cargarPdf(await pdfDeN(10));
  const unido = await unirPaginas(origen, [9, 2, 2, 5]);
  assert.equal((await PDFDocument.load(unido)).getPageCount(), 3);
});

test('etiquetaIntervalo distingue página única y rango', () => {
  assert.equal(etiquetaIntervalo({ desde: 5, hasta: 5 }, 2), 'página 05');
  assert.equal(etiquetaIntervalo({ desde: 3, hasta: 8 }, 2), 'páginas 3-8');
});

test('dividirPdf por páginas individuales produce un PDF de una página por cada una', async () => {
  const origen = await cargarPdf(await pdfDeN(4));
  const salidas = await dividirPdf(origen, intervalosPorPagina(4));
  assert.equal(salidas.length, 4);
  for (const bytes of salidas) {
    assert.equal((await PDFDocument.load(bytes)).getPageCount(), 1);
  }
});

test('dividirPdf por intervalo copia exactamente las páginas pedidas (3 a 8)', async () => {
  const origen = await cargarPdf(await pdfDeN(10));
  const r = parseIntervalos('3-8', 10);
  assert.equal(r.ok, true);
  if (!r.ok) return;
  const [salida] = await dividirPdf(origen, r.intervalos);
  assert.equal((await PDFDocument.load(salida!)).getPageCount(), 6);
});

test('la salida no lleva metadatos del documento de origen', async () => {
  const doc = await PDFDocument.create();
  doc.setTitle('Secreto');
  doc.setAuthor('Persona');
  doc.addPage();
  const origen = await cargarPdf(await doc.save());
  const [salida] = await dividirPdf(origen, [{ desde: 1, hasta: 1 }]);
  const leido = await PDFDocument.load(salida!);
  assert.equal(leido.getTitle(), undefined);
  assert.equal(leido.getAuthor(), undefined);
});

test('cargarPdf rechaza bytes que no son un PDF', async () => {
  await assert.rejects(cargarPdf(new TextEncoder().encode('esto no es un pdf')), /no es un PDF válido/);
});
