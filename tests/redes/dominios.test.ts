import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  dominioAscii,
  dominioUnicode,
  esRegistroDkim,
  estadoDisponibilidad,
  generarNombres,
  limpiarPalabra,
  valorarDominio,
  validarDominio,
} from '../../src/shared/dominios.ts';

test('dominioUnicode decodifica punycode (münchen.de)', () => {
  assert.equal(dominioUnicode('xn--mnchen-3ya.de'), 'münchen.de');
  assert.equal(dominioUnicode('ejemplo.com'), 'ejemplo.com');
});

test('dominioAscii codifica tildes y ñ', () => {
  assert.equal(dominioAscii('münchen.de'), 'xn--mnchen-3ya.de');
  assert.equal(dominioAscii('ejemplo.com'), 'ejemplo.com');
});

test('validarDominio acepta URLs y normaliza, rechaza basura', () => {
  const r = validarDominio('https://Ejemplo.com/ruta');
  assert.equal(r.ok && r.ascii, 'ejemplo.com');
  assert.equal(validarDominio('').ok, false);
  assert.equal(validarDominio('sin-punto').ok, false);
  assert.equal(validarDominio('-mal.com').ok, false);
});

test('estadoDisponibilidad: 404 libre, 200 registrado, otro desconocido', () => {
  assert.equal(estadoDisponibilidad(404), 'libre');
  assert.equal(estadoDisponibilidad(200), 'registrado');
  assert.equal(estadoDisponibilidad(500), 'desconocido');
});

test('generarNombres combina palabras con prefijos y sufijos sin repetir', () => {
  const n = generarNombres(['café', 'luna'], ['mi'], ['app'], 100);
  assert.ok(n.includes('cafe'));
  assert.ok(n.includes('miluna'));
  assert.ok(n.includes('lunaapp'));
  assert.ok(n.includes('cafeluna'));
  assert.equal(new Set(n).size, n.length);
  assert.ok(n.every((x) => /^[a-z0-9-]+$/.test(x)));
});

test('limpiarPalabra quita tildes y símbolos', () => {
  assert.equal(limpiarPalabra('Año Nuevo!'), 'anonuevo');
});

test('valorarDominio da más puntos a un nombre corto, sin guiones y .com', () => {
  const bueno = valorarDominio('luna.com');
  const malo = valorarDominio('mi-super-tienda-2026.xyz');
  assert.ok(bueno.puntaje > malo.puntaje);
  assert.ok(bueno.puntaje <= 100 && bueno.puntaje >= 0);
  assert.equal(bueno.criterios.length, 4);
});

test('esRegistroDkim reconoce v=DKIM1 y claves p=', () => {
  assert.equal(esRegistroDkim('v=DKIM1; k=rsa; p=MIIBIjAN'), true);
  assert.equal(esRegistroDkim('v=spf1 -all'), false);
});
