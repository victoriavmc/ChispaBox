import { test } from 'node:test';
import assert from 'node:assert/strict';
import readXlsxFile from 'read-excel-file/node';
import { csvAXlsx, letraColumna, matrizAXlsx } from '../../src/lib/data-convert.ts';

test('letraColumna sigue el formato de Excel (A, Z, AA, AZ, BA)', () => {
  assert.equal(letraColumna(0), 'A');
  assert.equal(letraColumna(25), 'Z');
  assert.equal(letraColumna(26), 'AA');
  assert.equal(letraColumna(51), 'AZ');
  assert.equal(letraColumna(52), 'BA');
});

test('CSV a xlsx: el libro se puede leer de vuelta con los mismos valores', async () => {
  const csv = 'nombre;edad;nota\nAna;30;7,5\n"Lucas, J.";012;=A1+1\n';
  const { bytes, avisos } = csvAXlsx(csv, ';');
  assert.deepEqual(avisos, []);
  // Es un ZIP (firma PK\x03\x04).
  assert.deepEqual([...bytes.slice(0, 4)], [0x50, 0x4b, 0x03, 0x04]);

  const filas = await readXlsxFile(Buffer.from(bytes));
  assert.equal(filas.length, 1); // una hoja
  const data = filas[0]?.data ?? [];
  assert.deepEqual(data[0], ['nombre', 'edad', 'nota']);
  assert.equal(data[1]?.[0], 'Ana');
  assert.equal(data[1]?.[1], 30); // número
  assert.equal(data[2]?.[0], 'Lucas, J.');
  assert.equal(data[2]?.[1], '012'); // ceros a la izquierda: se conserva como texto
  assert.equal(data[2]?.[2], '=A1+1'); // una fórmula queda como texto, no se ejecuta
});

test('escapa caracteres XML y quita controles inválidos', async () => {
  const bytes = matrizAXlsx([['a & <b> "c"', 'x\u0001y']]);
  const filas = await readXlsxFile(Buffer.from(bytes));
  assert.deepEqual(filas[0]?.data[0], ['a & <b> "c"', 'xy']);
});

test('números con más de 15 dígitos se guardan como texto para no perder precisión', async () => {
  const bytes = matrizAXlsx([['12345678901234567890']]);
  const filas = await readXlsxFile(Buffer.from(bytes));
  assert.equal(filas[0]?.data[0]?.[0], '12345678901234567890');
});
