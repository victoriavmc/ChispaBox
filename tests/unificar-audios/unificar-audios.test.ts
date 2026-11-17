import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  UNIFICAR_AUDIO_LIMITS,
  canalesDelResultado,
  muestrasTotales,
  posicionesInicio,
  validarListaAudio,
} from '../../src/shared/unificar-audios.ts';

test('validarListaAudio exige dos o más audios y respeta el máximo de archivos y duración', () => {
  assert.notEqual(validarListaAudio([{ bytes: 1, segundos: 1 }]), null);
  assert.equal(validarListaAudio([{ bytes: 1, segundos: 1 }, { bytes: 1, segundos: 2 }]), null);
  const muchos = Array.from({ length: UNIFICAR_AUDIO_LIMITS.maxArchivos + 1 }, () => ({ bytes: 1, segundos: 1 }));
  assert.notEqual(validarListaAudio(muchos), null);
  const largo = [
    { bytes: 1, segundos: UNIFICAR_AUDIO_LIMITS.maxSegundos },
    { bytes: 1, segundos: 1 },
  ];
  assert.notEqual(validarListaAudio(largo), null);
});

test('posicionesInicio acumula las duraciones en el orden recibido', () => {
  assert.deepEqual(posicionesInicio([2, 3.5, 1]), [0, 2, 5.5]);
  assert.deepEqual(posicionesInicio([]), []);
});

test('canalesDelResultado toma el mayor número de canales y nunca es menor que uno', () => {
  assert.equal(canalesDelResultado([1, 2, 1]), 2);
  assert.equal(canalesDelResultado([1]), 1);
});

test('muestrasTotales redondea hacia arriba según la tasa', () => {
  assert.equal(muestrasTotales([1, 0.5], 44100), 66150);
  assert.equal(muestrasTotales([0.00001], 44100), 1);
});
