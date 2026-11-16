import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  RECORTAR_AUDIO_LIMITS,
  ajustarFin,
  formatTiempo,
  muestrasRango,
  parseTiempo,
  validarRango,
} from '../../src/shared/recortar-audio.ts';

test('parseTiempo acepta segundos, m:ss, h:mm:ss y coma decimal', () => {
  assert.equal(parseTiempo('90'), 90);
  assert.equal(parseTiempo('1:30'), 90);
  assert.equal(parseTiempo('1:30.5'), 90.5);
  assert.equal(parseTiempo('1:30,5'), 90.5);
  assert.equal(parseTiempo('1:02:03'), 3723);
  assert.equal(parseTiempo('  0:00.0 '), 0);
});

test('parseTiempo rechaza texto, negativos y minutos o segundos de 60 o más', () => {
  assert.equal(parseTiempo(''), null);
  assert.equal(parseTiempo('abc'), null);
  assert.equal(parseTiempo('-5'), null);
  assert.equal(parseTiempo('1:60'), null);
  assert.equal(parseTiempo('1:75:00'), null);
  assert.equal(parseTiempo('1:2:3:4'), null);
});

test('formatTiempo muestra m:ss.d y h:mm:ss.d', () => {
  assert.equal(formatTiempo(0), '0:00.0');
  assert.equal(formatTiempo(90.25), '1:30.3');
  assert.equal(formatTiempo(3723), '1:02:03.0');
  assert.equal(formatTiempo(-4), '0:00.0');
});

test('validarRango exige valores, orden y que el inicio esté dentro del audio', () => {
  assert.notEqual(validarRango(null, 5, 10), null);
  assert.notEqual(validarRango(5, 5, 10), null);
  assert.notEqual(validarRango(6, 5, 10), null);
  assert.notEqual(validarRango(10, 12, 10), null);
  assert.notEqual(validarRango(1, 1.05, 10), null); // menos de 0,1 s
  assert.equal(validarRango(0, 10, 10), null);
  assert.equal(validarRango(1.5, 4, 10), null);
});

test('ajustarFin no supera la duración del audio', () => {
  assert.equal(ajustarFin(99, 10), 10);
  assert.equal(ajustarFin(4, 10), 4);
});

test('muestrasRango convierte a muestras y las limita al audio', () => {
  assert.deepEqual(muestrasRango(44100, 1, 2, 10), { desde: 44100, hasta: 88200 });
  assert.deepEqual(muestrasRango(10, -1, 99, 5), { desde: 0, hasta: 50 });
  assert.deepEqual(muestrasRango(10, 4, 2, 5), { desde: 40, hasta: 40 });
});

test('los límites de la herramienta son 100 MB y 60 minutos', () => {
  assert.equal(RECORTAR_AUDIO_LIMITS.maxBytes, 100 * 1024 * 1024);
  assert.equal(RECORTAR_AUDIO_LIMITS.maxSegundos, 3600);
});
