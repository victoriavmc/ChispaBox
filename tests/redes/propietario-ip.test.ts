import { test } from 'node:test';
import assert from 'node:assert/strict';
import { interpretarRdapIp, registroRegional } from '../../src/shared/propietario-ip.ts';

const LACNIC = {
  objectClassName: 'ip network',
  handle: '190.226.126.0/23',
  startAddress: '190.226.126.0',
  endAddress: '190.226.127.255',
  name: 'REALLOCATED',
  type: 'REALLOCATED',
  cidr0_cidrs: [{ v4prefix: '190.226.126.0', length: 23 }],
  events: [
    { eventAction: 'registration', eventDate: '2008-05-09T20:23:33Z' },
    { eventAction: 'last changed', eventDate: '2024-12-26T13:48:55Z' },
  ],
  entities: [
    {
      roles: ['registrant'],
      vcardArray: ['vcard', [['fn', {}, 'text', 'Apolo -Gold-Telecom-Per'], ['adr', {}, 'text', ['', 'piso 3', 'Dorrego', 'Capital Federal', '', '1425', 'AR']]]],
    },
    {
      roles: ['administrative', 'technical', 'abuse'],
      vcardArray: ['vcard', [['fn', {}, 'text', 'Administrador IP'], ['email', {}, 'text', 'abuse@teco.com.ar'], ['tel', {}, 'text', '+54 11 0000']]],
    },
  ],
};

test('interpretarRdapIp arma el bloque, el titular y el contacto de abuso', () => {
  const r = interpretarRdapIp(LACNIC, 'https://rdap.lacnic.net/rdap/ip/190.226.127.15');
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(r.datos.bloque, '190.226.126.0/23');
  assert.equal(r.datos.rango, '190.226.126.0 – 190.226.127.255');
  assert.equal(r.datos.titular, 'Apolo -Gold-Telecom-Per');
  assert.equal(r.datos.pais, 'Argentina');
  assert.equal(r.datos.abuso, 'abuse@teco.com.ar');
  assert.equal(r.datos.registrado, '2008-05-09');
  assert.equal(r.datos.modificado, '2024-12-26');
  assert.equal(r.datos.registro, 'LACNIC (Latinoamérica y Caribe)');
});

test('interpretarRdapIp no muestra teléfonos ni nombres de personas', () => {
  const r = interpretarRdapIp(LACNIC, 'https://rdap.lacnic.net/rdap/ip/190.226.127.15');
  assert.equal(r.ok && JSON.stringify(r.datos).includes('Administrador IP'), false);
  assert.equal(r.ok && JSON.stringify(r.datos).includes('+54'), false);
});

test('interpretarRdapIp rechaza respuestas que no son un bloque de IP', () => {
  assert.equal(interpretarRdapIp({ objectClassName: 'domain' }, 'x').ok, false);
  assert.equal(interpretarRdapIp(null, 'x').ok, false);
});

test('registroRegional identifica el registro por el servidor que respondió', () => {
  assert.equal(registroRegional('https://rdap.arin.net/registry/ip/8.8.8.8'), 'ARIN (América del Norte)');
  assert.equal(registroRegional('https://rdap.ripe.net/ip/1.1.1.1'), 'RIPE NCC (Europa, Medio Oriente, Asia central)');
  assert.equal(registroRegional('https://example.com'), 'No identificado');
});
