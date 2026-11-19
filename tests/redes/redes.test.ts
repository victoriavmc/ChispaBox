import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  calcularSubred,
  describirNavegador,
  esHostValido,
  interpretarRespuestaDns,
  mascaraAPrefijo,
  normalizarHost,
  parseIPv4,
  prefijoAMascara,
  validarPuertos,
} from '../../src/shared/redes.ts';

test('parseIPv4 acepta direcciones válidas y rechaza formatos ambiguos', () => {
  assert.equal(parseIPv4('192.168.1.10'), 0xc0a8010a);
  assert.equal(parseIPv4('255.255.255.255'), 0xffffffff);
  assert.equal(parseIPv4('256.1.1.1'), null);
  assert.equal(parseIPv4('010.1.1.1'), null);
  assert.equal(parseIPv4('1.2.3'), null);
  assert.equal(parseIPv4('a.b.c.d'), null);
});

test('prefijoAMascara y mascaraAPrefijo son inversas', () => {
  assert.equal(prefijoAMascara(0), 0);
  assert.equal(prefijoAMascara(24), parseIPv4('255.255.255.0'));
  assert.equal(prefijoAMascara(32), parseIPv4('255.255.255.255'));
  assert.equal(mascaraAPrefijo('255.255.255.0'), 24);
  assert.equal(mascaraAPrefijo('255.255.192.0'), 18);
  assert.equal(mascaraAPrefijo('0.0.0.0'), 0);
  assert.equal(mascaraAPrefijo('255.0.255.0'), null);
});

test('calcularSubred calcula red, broadcast y rango de hosts de un /24', () => {
  const r = calcularSubred('192.168.1.10/24');
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(r.datos.red, '192.168.1.0');
  assert.equal(r.datos.broadcast, '192.168.1.255');
  assert.equal(r.datos.primeraIp, '192.168.1.1');
  assert.equal(r.datos.ultimaIp, '192.168.1.254');
  assert.equal(r.datos.hosts, 254);
  assert.equal(r.datos.mascara, '255.255.255.0');
  assert.equal(r.datos.wildcard, '0.0.0.255');
  assert.equal(r.datos.clase, 'C');
  assert.equal(r.datos.tipo, 'Privada (RFC 1918, uso interno)');
});

test('calcularSubred acepta máscara decimal y prefijo con espacios', () => {
  const decimal = calcularSubred('10.0.5.7 255.255.0.0');
  const prefijo = calcularSubred('10.0.5.7 / 16');
  assert.equal(decimal.ok && decimal.datos.red, '10.0.0.0');
  assert.equal(prefijo.ok && prefijo.datos.broadcast, '10.0.255.255');
  assert.equal(decimal.ok && decimal.datos.hosts, 65534);
});

test('calcularSubred maneja /31 y /32 sin restar broadcast', () => {
  const p31 = calcularSubred('10.0.0.0/31');
  const p32 = calcularSubred('10.0.0.5/32');
  assert.equal(p31.ok && p31.datos.hosts, 2);
  assert.equal(p31.ok && p31.datos.primeraIp, '10.0.0.0');
  assert.equal(p31.ok && p31.datos.ultimaIp, '10.0.0.1');
  assert.equal(p32.ok && p32.datos.hosts, 1);
  assert.equal(p32.ok && p32.datos.primeraIp, '10.0.0.5');
});

test('calcularSubred cubre /0 y el borde de un /8 en clase A pública', () => {
  const todo = calcularSubred('8.8.8.8/0');
  assert.equal(todo.ok && todo.datos.red, '0.0.0.0');
  assert.equal(todo.ok && todo.datos.broadcast, '255.255.255.255');
  const a = calcularSubred('8.8.8.8/8');
  assert.equal(a.ok && a.datos.clase, 'A');
  assert.equal(a.ok && a.datos.tipo, 'Pública');
});

test('calcularSubred informa errores comprensibles', () => {
  assert.equal(calcularSubred('').ok, false);
  assert.equal(calcularSubred('192.168.1.10').ok, false);
  assert.equal(calcularSubred('192.168.1.300/24').ok, false);
  assert.equal(calcularSubred('192.168.1.10/33').ok, false);
  assert.equal(calcularSubred('192.168.1.10 255.0.255.0').ok, false);
});

test('tipoIPv4 reconoce loopback y enlace local', () => {
  assert.equal(calcularSubred('127.0.0.1/8').ok && calcularSubred('127.0.0.1/8').datos.tipo, 'Loopback (esta misma máquina)');
  assert.equal(calcularSubred('169.254.10.1/16').ok && calcularSubred('169.254.10.1/16').datos.tipo, 'Enlace local (sin DHCP)');
});

test('normalizarHost quita esquema, ruta y punto final', () => {
  assert.equal(normalizarHost('https://Ejemplo.com/ruta?x=1'), 'ejemplo.com');
  assert.equal(normalizarHost('  ejemplo.com.  '), 'ejemplo.com');
  assert.equal(normalizarHost('192.168.0.1'), '192.168.0.1');
});

test('esHostValido acepta dominios y rechaza caracteres raros', () => {
  assert.equal(esHostValido('sub.ejemplo.com'), true);
  assert.equal(esHostValido('localhost'), true);
  assert.equal(esHostValido('-mal.com'), false);
  assert.equal(esHostValido('ejemplo_.com'), false);
  assert.equal(esHostValido('a'.repeat(64) + '.com'), false);
  assert.equal(esHostValido(''), false);
});

test('validarPuertos separa, deduplica y rechaza bloqueados y fuera de rango', () => {
  const ok = validarPuertos('443, 8443 443;9443');
  assert.deepEqual(ok.puertos, [443, 8443, 9443]);
  assert.deepEqual(ok.errores, []);

  const malo = validarPuertos('22 70000 abc 8080');
  assert.deepEqual(malo.puertos, [8080]);
  assert.equal(malo.errores.length, 3);
});

test('validarPuertos limita la cantidad de puertos por consulta', () => {
  const lista = Array.from({ length: 25 }, (_, i) => String(10000 + i)).join(',');
  const r = validarPuertos(lista);
  assert.equal(r.puertos.length, 25);
  assert.equal(r.errores.length, 1);
});

test('interpretarRespuestaDns lee registros válidos y descarta los incompletos', () => {
  const r = interpretarRespuestaDns({
    Status: 0,
    Answer: [
      { name: 'ejemplo.com.', type: 1, TTL: 300, data: '93.184.216.34' },
      { name: 'ejemplo.com.', type: 99, TTL: 300, data: 'raro' },
      { name: 'ejemplo.com.', type: 16, TTL: 60, data: 42 },
    ],
  });
  assert.equal(r.estado, 'Consulta correcta');
  assert.deepEqual(r.registros, [{ tipo: 'A', ttl: 300, valor: '93.184.216.34' }]);
});

test('interpretarRespuestaDns informa dominio inexistente y respuestas inválidas', () => {
  const nx = interpretarRespuestaDns({ Status: 3 });
  assert.match(nx.estado, /NXDOMAIN/);
  assert.equal(nx.registros.length, 0);
  assert.ok(interpretarRespuestaDns('basura').error);
  assert.ok(interpretarRespuestaDns({ sinStatus: true }).error);
});

test('describirNavegador identifica navegador y sistema', () => {
  const chrome =
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36';
  const edge = `${chrome} Edg/125.0`;
  const firefox = 'Mozilla/5.0 (X11; Linux x86_64; rv:126.0) Gecko/20100101 Firefox/126.0';
  const safari =
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
  assert.deepEqual(describirNavegador(chrome), { navegador: 'Chrome', sistema: 'Windows 10 u 11' });
  assert.equal(describirNavegador(edge).navegador, 'Microsoft Edge');
  assert.deepEqual(describirNavegador(firefox), { navegador: 'Firefox', sistema: 'Linux' });
  assert.deepEqual(describirNavegador(safari), { navegador: 'Safari', sistema: 'iOS / iPadOS' });
});
