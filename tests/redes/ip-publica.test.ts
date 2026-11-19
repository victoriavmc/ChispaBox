import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  hostnameDesdePtr,
  interpretarIpinfo,
  interpretarIpwhois,
  ipADecimal,
  nombreArpaIPv4,
} from '../../src/shared/ip-publica.ts';

test('ipADecimal convierte IPv4 a su valor decimal', () => {
  assert.equal(ipADecimal('190.226.127.15'), 3202514703);
  assert.equal(ipADecimal('0.0.0.1'), 1);
  assert.equal(ipADecimal('no-es-ip'), null);
});

test('nombreArpaIPv4 invierte los octetos', () => {
  assert.equal(nombreArpaIPv4('190.226.127.15'), '15.127.226.190.in-addr.arpa');
  assert.equal(nombreArpaIPv4('999.1.1.1'), null);
});

test('hostnameDesdePtr lee el registro PTR y quita el punto final', () => {
  const respuesta = { Status: 0, Answer: [{ name: '15.127.226.190.in-addr.arpa.', type: 12, TTL: 300, data: 'host15.telecom.net.ar.' }] };
  assert.equal(hostnameDesdePtr(respuesta), 'host15.telecom.net.ar');
  assert.equal(hostnameDesdePtr({ Status: 3 }), null);
  assert.equal(hostnameDesdePtr('x'), null);
});

test('interpretarIpwhois valida la respuesta y arma los datos', () => {
  const r = interpretarIpwhois({
    ip: '190.226.127.15',
    success: true,
    type: 'IPv4',
    country: 'Argentina',
    region: 'Formosa Province',
    city: 'Formosa',
    latitude: -26.18,
    longitude: -58.17,
    connection: { asn: 7303, isp: 'Telecom Argentina S.A.' },
  });
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(r.datos.asn, 'AS7303');
  assert.equal(r.datos.proveedor, 'Telecom Argentina S.A.');
  assert.equal(r.datos.ciudad, 'Formosa');
});

test('interpretarIpinfo separa ASN y proveedor y convierte loc en coordenadas', () => {
  const r = interpretarIpinfo({
    ip: '190.226.127.15',
    city: 'Formosa',
    region: 'Formosa',
    country: 'AR',
    loc: '-26.1849,-58.1731',
    org: 'AS7303 Telecom Argentina S.A.',
  });
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(r.datos.latitud, -26.1849);
  assert.equal(r.datos.longitud, -58.1731);
  assert.equal(r.datos.asn, 'AS7303');
  assert.equal(r.datos.proveedor, 'Telecom Argentina S.A.');
  assert.equal(r.datos.pais, 'Argentina');
  assert.equal(interpretarIpinfo({ ip: '1.1.1.1' }).ok, false);
});

test('interpretarIpwhois informa cuando el servicio falla o no trae coordenadas', () => {
  assert.equal(interpretarIpwhois({ success: false }).ok, false);
  const sinCoordenadas = interpretarIpwhois({ ip: '1.1.1.1', success: true });
  assert.equal(sinCoordenadas.ok, false);
  assert.equal(interpretarIpwhois(null).ok, false);
});
