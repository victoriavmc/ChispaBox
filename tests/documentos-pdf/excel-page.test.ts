import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyToSheetXml } from '../../server/documentos-pdf/excel-page.ts';

const WS = (inner: string, open = '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">') =>
  `<?xml version="1.0" encoding="UTF-8"?>\n${open}${inner}</worksheet>`;

const ALL_OFF = { orientation: 'original', paper: 'original', fit: 'original' } as const;

test('sin cambios: el XML queda igual', () => {
  const xml = WS('<sheetData/><pageMargins left="0.7" right="0.7" top="0.75" bottom="0.75" header="0.3" footer="0.3"/>');
  assert.equal(applyToSheetXml(xml, ALL_OFF), xml);
});

test('horizontal y A4 insertan pageSetup después de pageMargins', () => {
  const xml = WS('<sheetData/><pageMargins left="0.7" right="0.7" top="0.75" bottom="0.75" header="0.3" footer="0.3"/>');
  const out = applyToSheetXml(xml, { orientation: 'horizontal', paper: 'a4', fit: 'original' });
  assert.match(out, /<pageMargins[^>]*\/><pageSetup orientation="landscape" paperSize="9"\/>/);
});

test('ajuste de ancho crea sheetPr con pageSetUpPr y fitToWidth', () => {
  const xml = WS('<sheetData/>');
  const out = applyToSheetXml(xml, { orientation: 'original', paper: 'original', fit: 'ancho' });
  assert.match(out, /<sheetPr><pageSetUpPr fitToPage="1"\/><\/sheetPr>/);
  assert.match(out, /<pageSetup fitToWidth="1" fitToHeight="0"\/>/);
  assert.ok(out.indexOf('<sheetPr>') < out.indexOf('<sheetData'), 'sheetPr va antes de sheetData');
});

test('sheetPr existente conserva tabColor y añade pageSetUpPr al final', () => {
  const xml = WS('<sheetPr><tabColor rgb="FFFF0000"/></sheetPr><sheetData/>');
  const out = applyToSheetXml(xml, { orientation: 'original', paper: 'original', fit: 'ancho' });
  assert.match(out, /<sheetPr><tabColor rgb="FFFF0000"\/><pageSetUpPr fitToPage="1"\/><\/sheetPr>/);
});

test('pageSetup existente se reemplaza y se conservan sus atributos', () => {
  const xml = WS('<sheetData/><pageMargins left="0.5" right="0.5" top="0.5" bottom="0.5" header="0" footer="0"/><pageSetup paperSize="1" orientation="portrait" scale="80"/>');
  const out = applyToSheetXml(xml, { orientation: 'horizontal', paper: 'original', fit: 'original' });
  assert.equal((out.match(/<pageSetup\b/g) ?? []).length, 1, 'un único pageSetup');
  assert.match(out, /<pageSetup paperSize="1" orientation="landscape" scale="80"\/>/);
});

test('pageSetup se inserta antes de drawing si no hay pageMargins', () => {
  const xml = WS('<sheetData/><drawing r:id="rId1"/>');
  const out = applyToSheetXml(xml, { orientation: 'vertical', paper: 'letter', fit: 'original' });
  assert.ok(out.indexOf('<pageSetup') < out.indexOf('<drawing'));
  assert.match(out, /orientation="portrait" paperSize="1"/);
});

test('el id de impresora (r:id) se quita del pageSetup', () => {
  const xml = WS('<sheetData/><pageMargins left="0.7" right="0.7" top="0.75" bottom="0.75" header="0.3" footer="0.3"/><pageSetup r:id="rId3" paperSize="9"/>');
  const out = applyToSheetXml(xml, { orientation: 'horizontal', paper: 'original', fit: 'original' });
  assert.doesNotMatch(out, /r:id="rId3"/);
});

test('ajuste original desactiva fitToPage existente', () => {
  const xml = WS('<sheetPr><pageSetUpPr fitToPage="1"/></sheetPr><sheetData/><pageSetup fitToWidth="1" fitToHeight="0"/>');
  const out = applyToSheetXml(xml, { orientation: 'horizontal', paper: 'original', fit: 'original' });
  assert.match(out, /<pageSetUpPr fitToPage="0"\/>/);
  assert.doesNotMatch(out, /fitToWidth/);
});

test('prefijo de espacio de nombres (x:) se respeta', () => {
  const xml = `<?xml version="1.0"?><x:worksheet xmlns:x="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><x:sheetData/><x:pageMargins left="0.7" right="0.7" top="0.75" bottom="0.75" header="0.3" footer="0.3"/></x:worksheet>`;
  const out = applyToSheetXml(xml, { orientation: 'horizontal', paper: 'legal', fit: 'original' });
  assert.match(out, /<x:pageSetup orientation="landscape" paperSize="5"\/>/);
});
