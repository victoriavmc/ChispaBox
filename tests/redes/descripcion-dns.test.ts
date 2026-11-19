import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DESCRIPCION_TIPO_DNS, TIPOS_DNS } from '../../src/shared/redes.ts';

test('cada tipo DNS del selector tiene una descripción no vacía', () => {
  for (const tipo of TIPOS_DNS) {
    assert.ok(DESCRIPCION_TIPO_DNS[tipo].length > 20, `falta descripción para ${tipo}`);
  }
});
