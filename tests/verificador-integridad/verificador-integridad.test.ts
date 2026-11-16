import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_BYTES,
  bytesAHex,
  compararHash,
  esHashValido,
  normalizarHash,
  validarTamano,
} from '../../src/shared/verificador-integridad.ts';

/** Vector estándar de SHA-256 para la cadena «abc» (FIPS 180-2). */
const SHA256_ABC = 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad';

test('bytesAHex convierte el digest de Web Crypto al hash esperado', async () => {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode('abc'));
  assert.equal(bytesAHex(digest), SHA256_ABC);
});

test('normalizarHash quita espacios y pasa a minúsculas', () => {
  assert.equal(normalizarHash(`  BA78 16BF\n8f01 `), 'ba7816bf8f01');
});

test('esHashValido exige 64 caracteres hexadecimales', () => {
  assert.equal(esHashValido(SHA256_ABC), true);
  assert.equal(esHashValido(SHA256_ABC.slice(0, 63)), false);
  assert.equal(esHashValido(SHA256_ABC.replace('a', 'g')), false);
});

test('compararHash distingue coincidencia, diferencia, vacío y formato inválido', () => {
  assert.equal(compararHash(SHA256_ABC, SHA256_ABC.toUpperCase()), 'coincide');
  assert.equal(compararHash(SHA256_ABC, '0'.repeat(64)), 'no-coincide');
  assert.equal(compararHash(SHA256_ABC, '   '), 'vacio');
  assert.equal(compararHash(SHA256_ABC, 'no-es-un-hash'), 'formato-invalido');
});

test('validarTamano rechaza archivos vacíos y los que superan el límite', () => {
  assert.notEqual(validarTamano(0), null);
  assert.notEqual(validarTamano(MAX_BYTES + 1), null);
  assert.equal(validarTamano(1024), null);
  assert.equal(validarTamano(MAX_BYTES), null);
});
