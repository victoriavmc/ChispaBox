import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatosColor, rgbAHex, rgbAHsl, rgbAHsv } from '../../src/shared/selector-color.ts';

test('rgbAHex escribe dos dígitos hexadecimales por canal en mayúsculas', () => {
  assert.equal(rgbAHex({ r: 255, g: 0, b: 0 }), '#FF0000');
  assert.equal(rgbAHex({ r: 0, g: 10, b: 255 }), '#000AFF');
});

test('rojo puro, gris y azul apagado en HSL y HSV', () => {
  assert.deepEqual(rgbAHsl({ r: 255, g: 0, b: 0 }), { h: 0, s: 100, l: 50 });
  assert.deepEqual(rgbAHsv({ r: 255, g: 0, b: 0 }), { h: 0, s: 100, v: 100 });
  assert.deepEqual(rgbAHsl({ r: 128, g: 128, b: 128 }), { h: 0, s: 0, l: 50 });
  assert.deepEqual(rgbAHsv({ r: 128, g: 128, b: 128 }), { h: 0, s: 0, v: 50 });
  assert.deepEqual(rgbAHsl({ r: 51, g: 102, b: 204 }), { h: 220, s: 60, l: 50 });
  assert.deepEqual(rgbAHsv({ r: 51, g: 102, b: 204 }), { h: 220, s: 75, v: 80 });
});

test('negro y blanco no tienen matiz ni saturación', () => {
  assert.deepEqual(rgbAHsl({ r: 0, g: 0, b: 0 }), { h: 0, s: 0, l: 0 });
  assert.deepEqual(rgbAHsv({ r: 255, g: 255, b: 255 }), { h: 0, s: 0, v: 100 });
});

test('el matiz se mantiene entre 0 y 359 aunque el rojo domine con verde mayor que azul', () => {
  const hsl = rgbAHsl({ r: 255, g: 1, b: 0 });
  assert.ok(hsl.h >= 0 && hsl.h < 360);
  assert.equal(rgbAHsl({ r: 255, g: 0, b: 1 }).h, 360 % 360);
});

test('formatosColor devuelve los cuatro textos esperados', () => {
  const f = formatosColor({ r: 51, g: 102, b: 204 });
  assert.equal(f.hex, '#3366CC');
  assert.equal(f.rgb, 'rgb(51, 102, 204)');
  assert.equal(f.hsl, 'hsl(220, 60%, 50%)');
  assert.equal(f.hsv, 'hsv(220, 75%, 80%)');
});
