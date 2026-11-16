import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  MENSAJE_YA_PROTEGIDO,
  codigoCorrecto,
  mensajeDeError,
  nombreProtegido,
  ultimaLineaQpdf,
  validarClave,
} from '../../src/shared/proteger-pdf.ts';

test('codigoCorrecto acepta 0 y 3 (éxito con advertencias) y rechaza 2', () => {
  assert.equal(codigoCorrecto(0), true);
  assert.equal(codigoCorrecto(3), true);
  assert.equal(codigoCorrecto(2), false);
  assert.equal(codigoCorrecto(1), false);
});

test('ultimaLineaQpdf toma la última línea con texto y la acorta si es muy larga', () => {
  assert.equal(ultimaLineaQpdf('WARNING: a\n\nerror final\n  \n'), 'error final');
  assert.equal(ultimaLineaQpdf(''), '');
  assert.equal(ultimaLineaQpdf('x'.repeat(300)).length, 201);
});

test('mensajeDeError incluye el motivo de QPDF cuando no hay una causa conocida', () => {
  assert.equal(
    mensajeDeError('loquesea\nalgo raro del objeto 7', false),
    'No se pudo proteger el PDF. Motivo según QPDF: algo raro del objeto 7',
  );
  assert.equal(mensajeDeError('', false), 'No se pudo proteger el PDF.');
});

test('mensajeDeError mantiene los mensajes específicos de contraseña y de archivo dañado', () => {
  assert.equal(mensajeDeError('invalid password', false), MENSAJE_YA_PROTEGIDO);
  assert.equal(mensajeDeError('invalid password', true), 'La contraseña anterior del PDF no es correcta.');
  assert.equal(nombreProtegido('factura'), 'factura - protegido');
  assert.equal(nombreProtegido('factura - protegido'), 'factura - protegido');
  assert.equal(mensajeDeError('file is damaged', false), 'El archivo no es un PDF válido o está dañado.');
});

test('validarClave exige 8 caracteres y coincidencia', () => {
  assert.equal(validarClave('corta', 'corta'), 'La contraseña debe tener al menos 8 caracteres.');
  assert.equal(validarClave('Clave-123', 'Clave-124'), 'Las dos contraseñas no coinciden.');
  assert.equal(validarClave('Clave-123', 'Clave-123'), null);
});
