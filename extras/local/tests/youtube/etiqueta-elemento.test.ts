import { test } from 'node:test';
import assert from 'node:assert/strict';
import { etiquetaElemento } from '../../server/youtube/batch.ts';

test('el progreso dice Audio cuando la descarga es de audio y Video cuando es de video', () => {
  assert.equal(etiquetaElemento('audio', 0, 13, 'Rain'), 'Audio 1 de 13: Rain');
  assert.equal(etiquetaElemento('video', 2, 13, 'Rain'), 'Video 3 de 13: Rain');
});
