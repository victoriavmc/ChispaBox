import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CONJUNTOS,
  entropiaBits,
  enteroAleatorio,
  evaluarFortaleza,
  generarContrasena,
  type OpcionesContrasena,
} from '../../src/shared/generador-contrasenas.ts';

const base: OpcionesContrasena = {
  longitud: 16,
  mayusculas: true,
  minusculas: true,
  numeros: true,
  simbolos: true,
  sinAmbiguos: false,
};

test('genera la longitud pedida y solo usa los conjuntos elegidos', () => {
  const soloNumeros: OpcionesContrasena = { ...base, mayusculas: false, minusculas: false, simbolos: false };
  for (let i = 0; i < 200; i++) {
    const r = generarContrasena(soloNumeros);
    assert.equal(r.ok, true);
    if (!r.ok) return;
    assert.equal(r.contrasena.length, 16);
    assert.match(r.contrasena, /^[0-9]{16}$/);
  }
});

test('incluye al menos un carácter de cada conjunto elegido', () => {
  for (let i = 0; i < 300; i++) {
    const r = generarContrasena({ ...base, longitud: 8 });
    assert.equal(r.ok, true);
    if (!r.ok) return;
    assert.match(r.contrasena, /[A-Z]/);
    assert.match(r.contrasena, /[a-z]/);
    assert.match(r.contrasena, /[0-9]/);
    assert.ok([...r.contrasena].some((c) => CONJUNTOS.simbolos.includes(c)));
  }
});

test('sin ambiguos no contiene 0, O, 1, l ni I', () => {
  for (let i = 0; i < 300; i++) {
    const r = generarContrasena({ ...base, sinAmbiguos: true, longitud: 128 });
    assert.equal(r.ok, true);
    if (!r.ok) return;
    assert.doesNotMatch(r.contrasena, /[0O1lI]/);
  }
});

test('rechaza longitudes fuera de rango y ningún conjunto elegido', () => {
  assert.equal(generarContrasena({ ...base, longitud: 7 }).ok, false);
  assert.equal(generarContrasena({ ...base, longitud: 129 }).ok, false);
  assert.equal(generarContrasena({ ...base, longitud: 12.5 }).ok, false);
  const ninguno = generarContrasena({ ...base, mayusculas: false, minusculas: false, numeros: false, simbolos: false });
  assert.equal(ninguno.ok, false);
});

test('usa el generador de números aleatorios inyectado (determinista con un fake)', () => {
  const fijo = (buf: Uint32Array) => {
    buf[0] = 0;
    return buf;
  };
  const r = generarContrasena({ ...base, longitud: 8, mayusculas: false, minusculas: false, numeros: true, simbolos: false }, fijo);
  assert.deepEqual(r, { ok: true, contrasena: '00000000' });
});

test('enteroAleatorio descarta valores que causarían sesgo', () => {
  // max = 3: el límite es 4294967295 (múltiplo de 3). Ese valor se descarta y se usa el siguiente.
  const limite = Math.floor(0x100000000 / 3) * 3;
  assert.equal(limite, 4294967295);
  const valores = [limite, limite - 1];
  const random = (buf: Uint32Array) => {
    buf[0] = valores.shift() ?? 0;
    return buf;
  };
  assert.equal(enteroAleatorio(3, random), (limite - 1) % 3);
});

test('la entropía crece con la longitud y con el tamaño del alfabeto', () => {
  const corta = entropiaBits({ ...base, longitud: 8 });
  const larga = entropiaBits({ ...base, longitud: 16 });
  const solo = entropiaBits({ ...base, longitud: 16, minusculas: false, mayusculas: false, simbolos: false });
  assert.ok(larga > corta);
  assert.ok(larga > solo);
  assert.equal(Math.round(solo), Math.round(16 * Math.log2(10)));
});

test('evaluarFortaleza clasifica por bits', () => {
  assert.equal(evaluarFortaleza(20).nivel, 'muy-debil');
  assert.equal(evaluarFortaleza(35).nivel, 'debil');
  assert.equal(evaluarFortaleza(50).nivel, 'aceptable');
  assert.equal(evaluarFortaleza(70).nivel, 'fuerte');
  assert.equal(evaluarFortaleza(105).nivel, 'muy-fuerte');
  assert.equal(evaluarFortaleza(500).porcentaje, 100);
});
