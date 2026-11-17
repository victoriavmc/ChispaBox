import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ALFABETO,
  LONGITUD_CODIGO,
  MAX_ENLACES,
  agregarAlRegistro,
  codigoDesdeUrl,
  construirEnlace,
  esRegistroValido,
  generarCodigo,
  validarUrl,
  type Registro,
} from '../../src/shared/acortador-enlaces.ts';

test('acepta enlaces http y https completos', () => {
  assert.deepEqual(validarUrl('https://ejemplo.com/a/b?x=1'), { ok: true, url: 'https://ejemplo.com/a/b?x=1' });
  assert.deepEqual(validarUrl('  http://ejemplo.com  '), { ok: true, url: 'http://ejemplo.com/' });
});

test('rechaza esquemas peligrosos o que no son web', () => {
  for (const malo of ['javascript:alert(1)', 'data:text/html,hola', 'ftp://ejemplo.com', 'file:///etc/passwd']) {
    assert.equal(validarUrl(malo).ok, false, malo);
  }
});

test('rechaza vacío, texto sin esquema, credenciales y enlaces demasiado largos', () => {
  assert.equal(validarUrl('   ').ok, false);
  assert.equal(validarUrl('ejemplo.com').ok, false);
  assert.equal(validarUrl('https://usuario:clave@ejemplo.com').ok, false);
  assert.equal(validarUrl(`https://ejemplo.com/${'a'.repeat(2048)}`).ok, false);
});

test('generarCodigo produce el largo fijo y solo caracteres del alfabeto', () => {
  const bytes = [0, 255, 233, 232, 7, 100, 200, 99, 1, 2, 3, 4, 5, 6, 8, 9];
  let pos = 0;
  const aleatorio = (n: number) => Uint8Array.from(bytes.slice(pos, (pos += n)));
  const codigo = generarCodigo(aleatorio);
  assert.equal(codigo.length, LONGITUD_CODIGO);
  for (const c of codigo) assert.ok(ALFABETO.includes(c), c);
});

test('generarCodigo descarta bytes que sesgarían la distribución', () => {
  // 240..255 superan el límite (232) y deben saltarse; el resultado sigue teniendo largo correcto.
  const primero = [250, 251, 252, 253, 254, 255, 240, 241];
  const resto = [0, 1, 2, 3, 4, 5, 6];
  const cola = [...resto];
  const llamadas: number[][] = [primero, cola];
  const aleatorio = () => Uint8Array.from(llamadas.shift() ?? [0]);
  const codigo = generarCodigo(aleatorio);
  assert.equal(codigo.length, LONGITUD_CODIGO);
});

test('codigoDesdeUrl lee /s/CODIGO y, por compatibilidad, ?c=CODIGO', () => {
  assert.equal(codigoDesdeUrl('/s/abcdefg', ''), 'abcdefg');
  assert.equal(codigoDesdeUrl('/s/abcdefg/', ''), 'abcdefg');
  assert.equal(codigoDesdeUrl('/paginas/acortador-enlaces/index.html', '?c=abcdefg'), 'abcdefg');
  assert.equal(codigoDesdeUrl('/s/abc', ''), null);
  assert.equal(codigoDesdeUrl('/s/abc0defg', ''), null);
  assert.equal(codigoDesdeUrl('/s/<script>', ''), null);
  assert.equal(codigoDesdeUrl('/', ''), null);
});

test('construirEnlace arma el enlace corto /s/CODIGO', () => {
  assert.equal(construirEnlace('https://chispabox.example', 'abcdefg'), 'https://chispabox.example/s/abcdefg');
});

test('agregarAlRegistro guarda y descarta los enlaces más antiguos al llegar al límite', () => {
  let registro: Registro = {};
  for (let i = 0; i < MAX_ENLACES + 5; i++) {
    registro = agregarAlRegistro(registro, `c${String(i).padStart(6, '0')}`, `https://ejemplo.com/${i}`, i);
  }
  assert.equal(Object.keys(registro).length, MAX_ENLACES);
  assert.equal(registro['c000000'], undefined);
  assert.equal(registro[`c${String(MAX_ENLACES + 4).padStart(6, '0')}`]?.url, `https://ejemplo.com/${MAX_ENLACES + 4}`);
});

test('esRegistroValido rechaza datos guardados con forma incorrecta', () => {
  assert.equal(esRegistroValido({ abcdefg: { url: 'https://ejemplo.com', creado: 1 } }), true);
  assert.equal(esRegistroValido(null), false);
  assert.equal(esRegistroValido([]), false);
  assert.equal(esRegistroValido({ abcdefg: { url: 5, creado: 1 } }), false);
});
