import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ErrorDatos,
  csvAJson,
  hojaAMatriz,
  jsonAMatriz,
  matrizACsv,
  nombresDeColumna,
  protegerFormula,
  rechazarXmlPeligroso,
  xmlAJson,
  type NodoXml,
} from '../../src/lib/data-convert.ts';

const texto = (valor: string): NodoXml => ({ nodeType: 3, nodeName: '#text', nodeValue: valor, childNodes: [] });
const elemento = (nombre: string, hijos: NodoXml[] = [], atributos: Record<string, string> = {}): NodoXml => ({
  nodeType: 1,
  nodeName: nombre,
  nodeValue: null,
  childNodes: hijos,
  attributes: Object.entries(atributos).map(([name, value]) => ({ name, value })),
});

test('csvAJson usa la primera fila como claves y deja los valores como texto', () => {
  const r = csvAJson('nombre,edad\nAna,30\nLuis,25\n', { delimitador: null, primeraFilaEncabezado: true });
  assert.deepEqual(r.datos, [
    { nombre: 'Ana', edad: '30' },
    { nombre: 'Luis', edad: '25' },
  ]);
});

test('csvAJson detecta el punto y coma y respeta comillas con comas adentro', () => {
  const r = csvAJson('a;b\n"x, y";2\n', { delimitador: null, primeraFilaEncabezado: true });
  assert.deepEqual(r.datos, [{ a: 'x, y', b: '2' }]);
});

test('csvAJson sin encabezado devuelve listas y quita el BOM', () => {
  const r = csvAJson('﻿1,2\n3,4\n', { delimitador: ',', primeraFilaEncabezado: false });
  assert.deepEqual(r.datos, [
    ['1', '2'],
    ['3', '4'],
  ]);
});

test('nombresDeColumna completa vacíos y renombra repetidos', () => {
  assert.deepEqual(nombresDeColumna(['id', '', 'id', ' nombre ']), ['id', 'columna_2', 'id_2', 'nombre']);
});

test('una clave __proto__ queda como propiedad propia y no cambia el prototipo', () => {
  const r = csvAJson('__proto__,x\nmalo,1\n', { delimitador: ',', primeraFilaEncabezado: true });
  const fila = r.datos[0] as Record<string, unknown>;
  assert.equal(Object.getPrototypeOf(fila), Object.prototype);
  assert.equal(Object.prototype.hasOwnProperty.call(fila, '__proto__'), true);
  assert.equal(({} as Record<string, unknown>).x, undefined);
});

test('jsonAMatriz une las columnas de todos los objetos y rellena vacíos', () => {
  const m = jsonAMatriz('[{"a":1,"b":"x"},{"a":2,"c":true}]', false);
  assert.deepEqual(m, [
    ['a', 'b', 'c'],
    ['1', 'x', ''],
    ['2', '', 'true'],
  ]);
});

test('jsonAMatriz guarda objetos y listas anidados como JSON en una celda', () => {
  const m = jsonAMatriz('[{"a":{"k":1},"b":[1,2]}]', false);
  assert.deepEqual(m[1], ['{"k":1}', '[1,2]']);
});

test('jsonAMatriz envuelve valores sueltos en la columna valor y rechaza JSON roto', () => {
  assert.deepEqual(jsonAMatriz('[1,"dos"]', false), [['valor'], ['1'], ['dos']]);
  assert.throws(() => jsonAMatriz('[1,', false), ErrorDatos);
});

test('protegerFormula neutraliza fórmulas de Excel y deja el resto igual', () => {
  assert.equal(protegerFormula('=SUMA(A1)'), "'=SUMA(A1)");
  assert.equal(protegerFormula('+1'), "'+1");
  assert.equal(protegerFormula('@cmd'), "'@cmd");
  assert.equal(protegerFormula('-x'), "'-x");
  assert.equal(protegerFormula('normal'), 'normal');
  assert.equal(jsonAMatriz('[{"a":"=1+1"}]', true)[1][0], "'=1+1");
  assert.equal(jsonAMatriz('[{"a":"=1+1"}]', false)[1][0], '=1+1');
});

test('hojaAMatriz convierte fechas, booleanos y vacíos', () => {
  const fecha = new Date('2026-11-15T00:00:00.000Z');
  const m = hojaAMatriz(
    [
      ['nombre', 'fecha', 'ok', 'nada'],
      ['Ana', fecha, true, null],
      [42, new Date('x'), false, undefined],
    ],
    true,
  );
  assert.deepEqual(m, [
    ['nombre', 'fecha', 'ok', 'nada'],
    ['Ana', '2026-11-15T00:00:00.000Z', 'TRUE', ''],
    ['42', '', 'FALSE', ''],
  ]);
});

test('matrizACsv escapa comillas, comas y saltos de línea con el delimitador elegido', () => {
  const csv = matrizACsv(
    [
      ['a', 'b'],
      ['x,y', 'dice "hola"'],
      ['línea\nnueva', 'ok'],
    ],
    ';',
  );
  assert.equal(csv, 'a;b\r\nx,y;"dice ""hola"""\r\n"línea\nnueva";ok');
});

test('xmlAJson convierte atributos, texto, hijos repetidos y CDATA', () => {
  const raiz = elemento('libros', [
    elemento('libro', [elemento('titulo', [texto('Uno')])], { id: '1' }),
    elemento('libro', [elemento('titulo', [{ nodeType: 4, nodeName: '#cdata-section', nodeValue: 'Dos', childNodes: [] }])], { id: '2' }),
    elemento('vacio'),
    elemento('nota', [texto('hola')]),
  ]);
  assert.deepEqual(xmlAJson(raiz), {
    libros: {
      libro: [
        { '@id': '1', titulo: 'Uno' },
        { '@id': '2', titulo: 'Dos' },
      ],
      vacio: '',
      nota: 'hola',
    },
  });
});

test('xmlAJson guarda el texto mixto en #text', () => {
  const raiz = elemento('p', [texto('Hola '), elemento('b', [texto('mundo')]), texto('!')], { clase: 'x' });
  assert.deepEqual(xmlAJson(raiz), { p: { '@clase': 'x', b: 'mundo', '#text': 'Hola !' } });
});

test('xmlAJson corta XML demasiado anidado', () => {
  let nodo: NodoXml = elemento('fondo');
  for (let i = 0; i < 100; i++) nodo = elemento(`n${i}`, [nodo]);
  assert.throws(() => xmlAJson(nodo), ErrorDatos);
});

test('rechazarXmlPeligroso bloquea DOCTYPE y ENTITY, y deja pasar XML normal', () => {
  assert.throws(() => rechazarXmlPeligroso('<!DOCTYPE x [<!ENTITY a "b">]><x/>'), ErrorDatos);
  assert.throws(() => rechazarXmlPeligroso('<!entity a "b"><x/>'), ErrorDatos);
  assert.doesNotThrow(() => rechazarXmlPeligroso('<?xml version="1.0"?><x>hola</x>'));
});
