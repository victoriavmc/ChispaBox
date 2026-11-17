import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ErrorFormato,
  NODO,
  comprobarJson,
  construirVistaError,
  declaracionXml,
  detectarTipo,
  errorXmlDesdeMensaje,
  formatearJson,
  repararJson,
  formatearXml,
  localizarErrorJson,
  ordenarClaves,
  rechazarDtd,
  sangriaXml,
  ubicar,
  type NodoXmlFormato,
} from '../../src/lib/formato-json-xml.ts';

const texto = (valor: string): NodoXmlFormato => ({ nodeType: NODO.TEXTO, nodeName: '#text', nodeValue: valor, childNodes: [] });
const elemento = (nombre: string, hijos: NodoXmlFormato[] = [], atributos: Record<string, string> = {}): NodoXmlFormato => ({
  nodeType: NODO.ELEMENTO,
  nodeName: nombre,
  nodeValue: null,
  childNodes: hijos,
  attributes: Object.entries(atributos).map(([name, value]) => ({ name, value })),
});
const documento = (hijos: NodoXmlFormato[]): NodoXmlFormato => ({
  nodeType: NODO.DOCUMENTO,
  nodeName: '#document',
  nodeValue: null,
  childNodes: hijos,
});

// ---------------- JSON ----------------

test('formatearJson indenta con 2 espacios por defecto', () => {
  const r = formatearJson('{"a":1,"b":[1,2]}', { sangria: 2, ordenarClaves: false });
  assert.equal(r, '{\n  "a": 1,\n  "b": [\n    1,\n    2\n  ]\n}');
});

test('formatearJson minifica con sangría 0 y acepta tabulador', () => {
  assert.equal(formatearJson('{ "a" : [ 1 , 2 ] }', { sangria: 0, ordenarClaves: false }), '{"a":[1,2]}');
  assert.equal(formatearJson('{"a":1}', { sangria: 'tab', ordenarClaves: false }), '{\n\t"a": 1\n}');
});

test('ordenarClaves ordena las claves de forma recursiva, también dentro de listas', () => {
  const r = formatearJson('{"z":1,"a":{"y":2,"b":[{"d":4,"c":3}]}}', { sangria: 0, ordenarClaves: true });
  assert.equal(r, '{"a":{"b":[{"c":3,"d":4}],"y":2},"z":1}');
});

test('una clave llamada __proto__ se trata como clave normal', () => {
  const r = ordenarClaves(JSON.parse('{"__proto__":{"x":1},"a":2}')) as Record<string, unknown>;
  assert.deepEqual(Object.keys(r).sort(), ['__proto__', 'a']);
  assert.equal(({} as Record<string, unknown>).x, undefined);
});

test('JSON válidos de todo tipo pasan la validación', () => {
  for (const ok of ['0', '-1.5e+10', '"hola \\u00e1 \\n"', 'true', 'null', '[]', '{}', ' [ {"a": [null]} ] \n']) {
    assert.equal(comprobarJson(ok), null, ok);
  }
});

test('marca la línea y la columna de una coma sobrante', () => {
  const origen = '{\n  "a": 1,\n}';
  const error = comprobarJson(origen);
  assert.ok(error instanceof ErrorFormato);
  assert.equal(error.linea, 3);
  assert.equal(error.columna, 1);
  assert.match(error.message, /Sobra una coma/);
});

test('detecta comillas sin cerrar y señala donde empezó la cadena', () => {
  const error = comprobarJson('{"nombre": "Ana}');
  assert.ok(error);
  assert.equal(error.linea, 1);
  assert.equal(error.columna, 12);
  assert.match(error.message, /comillas/);
});

test('detecta palabras mal escritas y contenido después del final', () => {
  assert.match(comprobarJson('{"a": tru}')?.message ?? '', /Palabra no válida/);
  assert.match(comprobarJson('{} {}')?.message ?? '', /después del final/);
});

test('detecta llave o corchete sin cerrar', () => {
  assert.match(comprobarJson('{"a": [1, 2}')?.message ?? '', /«\]»|Se esperaba/);
  assert.match(comprobarJson('[1, 2')?.message ?? '', /termina antes de tiempo/);
});

test('detecta escapes inválidos y saltos de línea dentro de cadenas', () => {
  assert.match(comprobarJson('"\\x"')?.message ?? '', /Escape no válido/);
  assert.match(comprobarJson('"\\u12G4"')?.message ?? '', /4 dígitos/);
  assert.match(comprobarJson('"uno\ndos"')?.message ?? '', /salto de línea/);
});

test('texto vacío y nombres de clave sin comillas', () => {
  assert.equal(comprobarJson('   ')?.message, 'El texto está vacío.');
  assert.match(comprobarJson('{a: 1}')?.message ?? '', /clave entre comillas/);
});

test('números mal formados', () => {
  assert.match(comprobarJson('[-]')?.message ?? '', /signo menos/);
  assert.match(comprobarJson('[.5]')?.message ?? '', /Carácter inesperado/);
});

test('ubicar cuenta líneas y columnas desde 1', () => {
  assert.deepEqual(ubicar('ab\ncd', 0), { linea: 1, columna: 1 });
  assert.deepEqual(ubicar('ab\ncd', 4), { linea: 2, columna: 2 });
  assert.deepEqual(ubicar('ab', 99), { linea: 1, columna: 3 });
});

test('construirVistaError muestra números de línea y marca el carácter exacto', () => {
  const origen = '{\n  "a": 1,\n  "b": "x"y\n}';
  const filas = construirVistaError(origen, 3, 11);
  assert.deepEqual(
    filas.map((f) => f.numero),
    [1, 2, 3, 4],
  );
  const err = filas.find((f) => f.errorEn !== null);
  assert.ok(err);
  assert.equal(err.numero, 3);
  assert.equal(err.texto.charAt(err.errorEn ?? -1), 'y');
});

test('construirVistaError marca un espacio cuando el error está al final de la línea', () => {
  const filas = construirVistaError('[1, 2', 1, 6);
  const err = filas[0];
  assert.ok(err);
  assert.equal(err.texto, '[1, 2 ');
  assert.equal(err.errorEn, 5);
});

test('construirVistaError recorta líneas largas alrededor del error', () => {
  const filas = construirVistaError('x'.repeat(300) + '!', 1, 301);
  const err = filas[0];
  assert.ok(err);
  assert.ok(err.texto.startsWith('…'));
  assert.equal(err.texto.charAt(err.errorEn ?? -1), '!');
});

test('detectarTipo reconoce JSON, XML y texto desconocido', () => {
  assert.equal(detectarTipo('  {"a":1}'), 'json');
  assert.equal(detectarTipo('﻿[1]'), 'json');
  assert.equal(detectarTipo('<?xml version="1.0"?><a/>'), 'xml');
  assert.equal(detectarTipo('hola'), null);
});

test('detectarTipo reconoce valores JSON sueltos y XML sin declaración', () => {
  assert.equal(detectarTipo('12'), 'json');
  assert.equal(detectarTipo('"texto"'), 'json');
  assert.equal(detectarTipo('true'), 'json');
  assert.equal(detectarTipo('<!-- nota --><raiz/>'), 'xml');
  assert.equal(detectarTipo('  \n﻿<catalogo>'), 'xml');
  assert.equal(detectarTipo('texto con <nota>algo</nota>'), 'xml');
  assert.equal(detectarTipo('{"a": 1 "b": 2}'), 'json', 'JSON roto sigue siendo JSON, para mostrar su error');
  assert.equal(detectarTipo(''), null);
  assert.equal(detectarTipo('hola mundo'), null);
});

test('repararJson quita el carácter sobrante de la captura y deja el JSON válido', () => {
  const origen = '{\n  "roles": ["admin", "editor"],\n  "tags": ["a", "b"],s\n  "lessons": {}\n}';
  const r = repararJson(origen);
  assert.equal(r.error, null);
  assert.equal(r.cambios.length, 1);
  assert.match(r.cambios[0], /Línea 3, columna 22: quité el carácter sobrante «s»/);
  assert.equal(comprobarJson(r.texto), null);
});

test('repararJson quita comas sobrantes y agrega las que faltan', () => {
  const r = repararJson('{"a": 1, "b": [1, 2,], "c": 3 "d": 4}');
  assert.equal(r.error, null);
  assert.deepEqual(JSON.parse(r.texto), { a: 1, b: [1, 2], c: 3, d: 4 });
  assert.equal(r.cambios.length, 2);
});

test('repararJson agrega comillas a claves sin comillas y cierra estructuras abiertas', () => {
  const r = repararJson('{nombre: "Ana", lista: [1, 2');
  assert.equal(r.error, null);
  assert.deepEqual(JSON.parse(r.texto), { nombre: 'Ana', lista: [1, 2] });
});

test('repararJson no inventa correcciones cuando no sabe arreglar el error', () => {
  const origen = '{"a": "sin cerrar';
  const r = repararJson(origen);
  assert.ok(r.error);
  assert.equal(r.texto, origen);
  assert.equal(r.cambios.length, 0);
});

test('repararJson sobre un JSON válido no cambia nada', () => {
  const r = repararJson('{"a":[1,2]}');
  assert.equal(r.error, null);
  assert.equal(r.cambios.length, 0);
});

test('localizarErrorJson no lanza excepciones con entradas arbitrarias', () => {
  const casos = ['', '{', '[', '"', '\\', '{"a"', '{"a":', '[1,', '-', 'tr', '{"a":1}}', '\u0000'];
  for (const c of casos) {
    assert.doesNotThrow(() => localizarErrorJson(c), c);
  }
});

test('un JSON muy anidado se rechaza sin desbordar la pila', () => {
  const profundo = '['.repeat(2000) + ']'.repeat(2000);
  assert.match(comprobarJson(profundo)?.message ?? '', /demasiada profundidad/);
});

test('formatearJson lanza ErrorFormato con posición si el texto no es válido', () => {
  assert.throws(
    () => formatearJson('{\n"a" 1}', { sangria: 2, ordenarClaves: false }),
    (err: unknown) => err instanceof ErrorFormato && err.linea === 2 && err.columna === 5,
  );
});

// ---------------- XML ----------------

test('rechazarDtd bloquea DOCTYPE y ENTITY', () => {
  assert.throws(() => rechazarDtd('<!DOCTYPE x [<!ENTITY a "b">]><x/>'), ErrorFormato);
  assert.throws(() => rechazarDtd('<!ENTITY a "b"><x/>'), ErrorFormato);
  assert.doesNotThrow(() => rechazarDtd('<x>hola</x>'));
});

test('errorXmlDesdeMensaje lee línea y columna de Chrome y de Firefox', () => {
  const chrome = errorXmlDesdeMensaje(
    'This page contains the following errors:error on line 3 at column 7: Opening and ending tag mismatch: a line 2 and b\nBelow is a rendering of the page up to the first error.',
  );
  assert.equal(chrome.linea, 3);
  assert.equal(chrome.columna, 7);
  assert.equal(chrome.message, 'El XML no está bien formado: Opening and ending tag mismatch: a line 2 and b');

  const firefox = errorXmlDesdeMensaje(
    'XML Parsing Error: mismatched tag. Expected: </a>.\nLocation: http://127.0.0.1/x.xml\nLine Number 4, Column 9:',
  );
  assert.equal(firefox.linea, 4);
  assert.equal(firefox.columna, 9);
  assert.match(firefox.message, /mismatched tag/);
});

test('declaracionXml obtiene la declaración del inicio', () => {
  assert.equal(declaracionXml('﻿<?xml version="1.0" encoding="UTF-8"?>\n<a/>'), '<?xml version="1.0" encoding="UTF-8"?>');
  assert.equal(declaracionXml('<a/>'), null);
});

test('formatearXml indenta elementos anidados y deja el texto simple en una línea', () => {
  const arbol = documento([
    elemento('libro', [
      elemento('titulo', [texto('Mi libro')]),
      elemento('autor', [elemento('nombre', [texto('Ana & Luis')])]),
      elemento('vacio'),
    ], { id: '7' }),
  ]);
  const r = formatearXml(arbol, '<?xml version="1.0"?>', '  ');
  assert.equal(
    r,
    [
      '<?xml version="1.0"?>',
      '<libro id="7">',
      '  <titulo>Mi libro</titulo>',
      '  <autor>',
      '    <nombre>Ana &amp; Luis</nombre>',
      '  </autor>',
      '  <vacio/>',
      '</libro>',
    ].join('\n'),
  );
});

test('formatearXml escapa atributos y conserva CDATA, comentarios y PI', () => {
  const arbol = documento([
    { nodeType: NODO.PI, nodeName: 'estilo', nodeValue: 'href="a.css"', childNodes: [] },
    { nodeType: NODO.COMENTARIO, nodeName: '#comment', nodeValue: ' nota ', childNodes: [] },
    elemento('raiz', [
      { nodeType: NODO.CDATA, nodeName: '#cdata-section', nodeValue: '<b>x</b>', childNodes: [] },
      elemento('hijo'),
    ], { dato: 'a"b<c\n' }),
  ]);
  const r = formatearXml(arbol, null, '');
  assert.equal(r, '<?estilo href="a.css"?><!-- nota --><raiz dato="a&quot;b&lt;c&#10;"><![CDATA[<b>x</b>]]><hijo/></raiz>');
});

test('formatearXml sin sangría no agrega espacios ni saltos entre elementos', () => {
  const arbol = documento([elemento('a', [texto('\n  '), elemento('b', [texto('1')])])]);
  assert.equal(formatearXml(arbol, null, ''), '<a><b>1</b></a>');
});

test('sangriaXml convierte la opción en texto', () => {
  assert.equal(sangriaXml(0), '');
  assert.equal(sangriaXml(4), '    ');
  assert.equal(sangriaXml('tab'), '\t');
});
