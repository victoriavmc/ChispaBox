import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  enlaceSeguro,
  escaparWifi,
  fechaValida,
  sitioWebValido,
  textoContacto,
  textoWifi,
  type DatosContacto,
} from '../../src/shared/qr-contenido.ts';

const B = String.fromCharCode(92);

const base: DatosContacto = {
  nombre: 'Ana',
  telefono: '',
  email: '',
  organizacion: '',
  sitioWeb: '',
  fechaNacimiento: '',
  direccion: { calle: '', ciudad: '', codigoPostal: '', pais: '' },
};

test('escaparWifi antepone barra a los separadores del formato WIFI', () => {
  assert.equal(escaparWifi('a;b,c:d"e' + B + 'f'), 'a' + B + ';b' + B + ',c' + B + ':d' + B + '"e' + B + B + 'f');
});

test('textoWifi arma el formato estándar con escape y sin contraseña cuando es abierta', () => {
  assert.equal(
    textoWifi({ ssid: 'Casa;1', password: 'pa:ss', cifrado: 'WPA', oculta: false }),
    'WIFI:T:WPA;S:Casa' + B + ';1;P:pa' + B + ':ss;H:false;;',
  );
  assert.equal(textoWifi({ ssid: 'Cafe', password: '', cifrado: 'nopass', oculta: true }), 'WIFI:T:nopass;S:Cafe;H:true;;');
});

test('textoContacto con solo nombre no incluye campos opcionales', () => {
  const v = textoContacto(base);
  assert.equal(v, 'BEGIN:VCARD\nVERSION:3.0\nFN:Ana\nN:Ana;;;;\nEND:VCARD');
});

test('textoContacto incluye sitio web, fecha de nacimiento y dirección cuando se completan', () => {
  const v = textoContacto({
    ...base,
    nombre: 'Ana, García',
    telefono: '+54 11 1234',
    email: 'ana@example.com',
    sitioWeb: 'https://ana.example.com/perfil',
    fechaNacimiento: '1990-05-17',
    direccion: { calle: 'Av. Siempre Viva 742', ciudad: 'Springfield', codigoPostal: '1234', pais: 'Argentina' },
  });
  assert.ok(v.includes('FN:Ana' + B + ', García'));
  assert.ok(v.includes('URL:https://ana.example.com/perfil'));
  assert.ok(v.includes('BDAY:1990-05-17'));
  assert.ok(v.includes('ADR;TYPE=HOME:;;Av. Siempre Viva 742;Springfield;;1234;Argentina'));
  assert.ok(v.endsWith('END:VCARD'));
});

test('una dirección con solo el país sigue incluyendo ADR', () => {
  const v = textoContacto({ ...base, direccion: { calle: '', ciudad: '', codigoPostal: '', pais: 'Chile' } });
  assert.ok(v.includes('ADR;TYPE=HOME:;;;;;;Chile'));
});

test('sitioWebValido acepta http y https, vacío, y rechaza otros esquemas', () => {
  assert.equal(sitioWebValido(''), true);
  assert.equal(sitioWebValido('https://example.com'), true);
  assert.equal(sitioWebValido('http://example.com'), true);
  assert.equal(sitioWebValido('javascript:alert(1)'), false);
  assert.equal(sitioWebValido('ejemplo sin esquema'), false);
});

test('fechaValida exige AAAA-MM-DD y una fecha real del calendario', () => {
  assert.equal(fechaValida('1990-05-17'), true);
  assert.equal(fechaValida('2024-02-29'), true);
  assert.equal(fechaValida('2023-02-29'), false);
  assert.equal(fechaValida('17/05/1990'), false);
  assert.equal(fechaValida(''), false);
});

test('enlaceSeguro solo acepta http y https', () => {
  assert.equal(enlaceSeguro('https://example.com/a?b=1')?.hostname, 'example.com');
  assert.equal(enlaceSeguro('http://example.com')?.protocol, 'http:');
  assert.equal(enlaceSeguro('javascript:alert(1)'), null);
  assert.equal(enlaceSeguro('data:text/html,hola'), null);
  assert.equal(enlaceSeguro('texto libre'), null);
});
