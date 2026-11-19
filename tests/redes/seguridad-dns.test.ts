import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chequearDns, politicaDmarc, type RegistrosDominio } from '../../src/shared/seguridad-dns.ts';
import { interpretarRespuestaDns } from '../../src/shared/redes.ts';

const VACIO: RegistrosDominio = { mx: [], ns: [], txtRaiz: [], txtDmarc: [], caa: [], ds: [] };
const estado = (lista: ReturnType<typeof chequearDns>, id: string) => lista.find((c) => c.id === id)?.estado;

test('politicaDmarc lee la política p=', () => {
  assert.equal(politicaDmarc('v=DMARC1; p=reject; rua=mailto:x@y.com'), 'reject');
  assert.equal(politicaDmarc('v=DMARC1; p=none'), 'none');
  assert.equal(politicaDmarc('v=DMARC1; sp=none'), null);
});

test('un dominio bien configurado obtiene ok en todo', () => {
  const r = chequearDns({
    mx: ['10 mail.ejemplo.com.'],
    ns: ['a.ns.', 'b.ns.'],
    txtRaiz: ['v=spf1 include:_spf.google.com ~all'],
    txtDmarc: ['v=DMARC1; p=reject'],
    caa: ['0 issue "letsencrypt.org"'],
    ds: ['12345 13 2 ABCD'],
  });
  assert.ok(r.every((c) => c.estado === 'ok'));
});

test('sin registros de seguridad marca faltantes y alertas', () => {
  const r = chequearDns(VACIO);
  assert.equal(estado(r, 'mx'), 'alerta');
  assert.equal(estado(r, 'spf'), 'falta');
  assert.equal(estado(r, 'dmarc'), 'falta');
  assert.equal(estado(r, 'caa'), 'falta');
  assert.equal(estado(r, 'dnssec'), 'alerta');
  assert.equal(estado(r, 'ns'), 'alerta');
});

test('DMARC en p=none y SPF duplicado se marcan como alerta', () => {
  const r = chequearDns({ ...VACIO, txtDmarc: ['v=DMARC1; p=none'], txtRaiz: ['v=spf1 -all', 'v=spf1 ~all'] });
  assert.equal(estado(r, 'dmarc'), 'alerta');
  assert.equal(estado(r, 'spf'), 'alerta');
});

test('interpretarRespuestaDns reconoce CAA, DS y PTR', () => {
  const r = interpretarRespuestaDns({
    Status: 0,
    Answer: [
      { type: 257, TTL: 60, data: '0 issue "letsencrypt.org"' },
      { type: 43, TTL: 60, data: '1 13 2 ABCD' },
      { type: 12, TTL: 60, data: 'host.ejemplo.com.' },
    ],
  });
  assert.deepEqual(r.registros.map((x) => x.tipo), ['CAA', 'DS', 'PTR']);
});
