import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calificarDescarga, fluctuacion, mbps, mediana, usosRecomendados } from '../../src/shared/velocidad.ts';

test('mbps convierte bytes y milisegundos a megabits por segundo', () => {
  // 10 MB en 1 s = 80 Mbps
  assert.equal(mbps(10_000_000, 1000), 80);
  assert.equal(mbps(0, 1000), 0);
  assert.equal(mbps(1000, 0), 0);
});

test('mediana y fluctuación', () => {
  assert.equal(mediana([3, 1, 2]), 2);
  assert.equal(mediana([1, 2, 3, 4]), 2.5);
  assert.equal(mediana([]), 0);
  assert.equal(fluctuacion([10, 12, 10]), 2); // (2 + 2) / 2
  assert.equal(fluctuacion([5]), 0);
});

test('calificarDescarga usa los umbrales', () => {
  assert.equal(calificarDescarga(376), 'excelente');
  assert.equal(calificarDescarga(50), 'buena');
  assert.equal(calificarDescarga(10), 'regular');
  assert.equal(calificarDescarga(1), 'lenta');
});

test('usosRecomendados marca juegos como pobres con latencia alta', () => {
  const u = usosRecomendados(376, 50.7, 9.68);
  assert.equal(u.find((x) => x.uso === 'Ver video')?.nivel, 'bueno');
  assert.equal(u.find((x) => x.uso === 'Juegos en línea')?.nivel, 'promedio');
  const lento = usosRecomendados(1, 300, 80);
  assert.ok(lento.every((x) => x.nivel === 'pobre'));
});
