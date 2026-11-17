import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { centeredCrop, centerRect, clampCrop, counterpart, outputSize, presetById } from '../../src/shared/resize-crop.ts';

describe('centeredCrop', () => {
  it('sin proporción devuelve la imagen completa', () => {
    assert.deepEqual(centeredCrop(100, 80, null), { x: 0, y: 0, width: 100, height: 80 });
  });

  it('16:9 sobre 4000 × 3000 recorta alto y centra', () => {
    assert.deepEqual(centeredCrop(4000, 3000, 16 / 9), { x: 0, y: 375, width: 4000, height: 2250 });
  });

  it('1:1 sobre una imagen vertical recorta el alto y centra', () => {
    assert.deepEqual(centeredCrop(300, 500, 1), { x: 0, y: 100, width: 300, height: 300 });
  });

  it('nunca supera la imagen original aunque el redondeo lo empuje', () => {
    const r = centeredCrop(1000, 999, 4 / 3);
    assert.ok(r.width <= 1000 && r.height <= 999 && r.width >= 1 && r.height >= 1);
  });
});

describe('centerRect', () => {
  it('centra un rectángulo de su mismo tamaño', () => {
    assert.deepEqual(centerRect(200, 100, { x: 0, y: 0, width: 50, height: 40 }), { x: 75, y: 30, width: 50, height: 40 });
  });
});

describe('clampCrop', () => {
  it('acepta un recorte dentro de la imagen', () => {
    assert.deepEqual(clampCrop(200, 100, { x: 10, y: 5, width: 100, height: 90 }), {
      ok: true,
      value: { x: 10, y: 5, width: 100, height: 90 },
    });
  });

  it('rechaza un recorte que se sale por la derecha o por abajo', () => {
    assert.equal(clampCrop(200, 100, { x: 150, y: 0, width: 100, height: 10 }).ok, false);
    assert.equal(clampCrop(200, 100, { x: 0, y: 50, width: 10, height: 60 }).ok, false);
  });

  it('rechaza coordenadas negativas, tamaños de cero y valores no numéricos', () => {
    assert.equal(clampCrop(200, 100, { x: -1, y: 0, width: 10, height: 10 }).ok, false);
    assert.equal(clampCrop(200, 100, { x: 0, y: 0, width: 0, height: 10 }).ok, false);
    assert.equal(clampCrop(200, 100, { x: Number.NaN, y: 0, width: 10, height: 10 }).ok, false);
  });

  it('redondea decimales a enteros', () => {
    assert.deepEqual(clampCrop(200, 100, { x: 1.4, y: 0.6, width: 10.5, height: 9.2 }), {
      ok: true,
      value: { x: 1, y: 1, width: 11, height: 9 },
    });
  });
});

describe('counterpart y outputSize', () => {
  const crop = { width: 400, height: 300 };

  it('mantiene la proporción al cambiar el ancho o el alto', () => {
    assert.equal(counterpart(crop, 'width', 200), 150);
    assert.equal(counterpart(crop, 'height', 150), 200);
  });

  it('sin resize usa el tamaño del recorte', () => {
    assert.deepEqual(outputSize(crop, { width: null, height: null, keepRatio: true }), { ok: true, value: { width: 400, height: 300 } });
  });

  it('con proporción fija calcula el lado que falta', () => {
    assert.deepEqual(outputSize(crop, { width: 200, height: null, keepRatio: true }), { ok: true, value: { width: 200, height: 150 } });
    assert.deepEqual(outputSize(crop, { width: null, height: 600, keepRatio: true }), { ok: true, value: { width: 800, height: 600 } });
  });

  it('sin proporción fija usa los valores indicados', () => {
    assert.deepEqual(outputSize(crop, { width: 100, height: 100, keepRatio: false }), { ok: true, value: { width: 100, height: 100 } });
  });

  it('rechaza lados mayores al máximo y más píxeles que el límite', () => {
    assert.equal(outputSize(crop, { width: 9000, height: 100, keepRatio: false }).ok, false);
    assert.equal(outputSize(crop, { width: 8000, height: 3000, keepRatio: false }).ok, false);
  });

  it('rechaza dimensiones no enteras o menores a 1', () => {
    assert.equal(outputSize(crop, { width: 0, height: 10, keepRatio: false }).ok, false);
    assert.equal(outputSize(crop, { width: 10.5, height: 10, keepRatio: false }).ok, false);
  });
});

describe('presetById', () => {
  it('encuentra la proporción 16:9 y devuelve undefined para ids desconocidos', () => {
    assert.equal(presetById('16:9')?.ratio, 16 / 9);
    assert.equal(presetById('nope'), undefined);
  });
});
