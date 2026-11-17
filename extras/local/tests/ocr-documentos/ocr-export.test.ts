import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildDocumentXml,
  buildDocxBytes,
  buildTxtBytes,
  escapeXml,
  pageSeparator,
  safeBaseName,
} from '../../web/shared/ocr-export.ts';

const decoder = new TextDecoder('utf-8');

describe('escapeXml', () => {
  it('escapa los caracteres especiales de XML', () => {
    assert.equal(escapeXml(`a & b < c > d "e" 'f'`), 'a &amp; b &lt; c &gt; d &quot;e&quot; &apos;f&apos;');
  });

  it('quita caracteres de control no válidos en XML y conserva tildes y ñ', () => {
    assert.equal(escapeXml('Año\u0000\u0007 niño\tfin'), 'Año niño\tfin');
  });
});

describe('buildDocumentXml', () => {
  it('convierte cada línea en un párrafo con el texto escapado', () => {
    const xml = buildDocumentXml('Hola & chau\n\nSegunda <línea>');
    assert.match(xml, /<w:t xml:space="preserve">Hola &amp; chau<\/w:t>/);
    assert.match(xml, /<w:t xml:space="preserve">Segunda &lt;línea&gt;<\/w:t>/);
    assert.match(xml, /<w:p\/>/, 'la línea vacía se conserva como párrafo vacío');
  });

  it('convierte el separador de página en un salto de página real', () => {
    const xml = buildDocumentXml(`${pageSeparator(1)}\n\nTexto uno\n\n${pageSeparator(2)}\n\nTexto dos`);
    assert.equal((xml.match(/<w:br w:type="page"\/>/g) ?? []).length, 2);
    assert.ok(!xml.includes('--- Página'), 'el separador no debe aparecer como texto');
  });

  it('no deja ampersands sin escapar', () => {
    const xml = buildDocumentXml('AT&T y Q&A');
    assert.equal(/&(?!amp;|lt;|gt;|quot;|apos;|#)/.test(xml), false);
  });
});

describe('buildTxtBytes', () => {
  it('antepone BOM UTF-8 y normaliza los saltos de línea de Windows', () => {
    const bytes = buildTxtBytes('línea 1\r\nlínea 2\rfin');
    assert.equal(bytes[0], 0xef);
    assert.equal(bytes[1], 0xbb);
    assert.equal(bytes[2], 0xbf);
    assert.equal(decoder.decode(bytes.subarray(3)), 'línea 1\nlínea 2\nfin');
  });
});

describe('buildDocxBytes', () => {
  it('genera un ZIP con las tres partes mínimas de Word', () => {
    const bytes = buildDocxBytes('Texto de prueba');
    assert.equal(bytes[0], 0x50); // P
    assert.equal(bytes[1], 0x4b); // K
    assert.equal(bytes[2], 0x03);
    assert.equal(bytes[3], 0x04);

    const text = decoder.decode(bytes);
    assert.ok(text.includes('[Content_Types].xml'));
    assert.ok(text.includes('_rels/.rels'));
    assert.ok(text.includes('word/document.xml'));
    assert.ok(text.includes('Texto de prueba'));

    // Registro de fin de directorio central: 3 entradas.
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let eocd = -1;
    for (let i = bytes.length - 22; i >= 0; i -= 1) {
      if (view.getUint32(i, true) === 0x06054b50) {
        eocd = i;
        break;
      }
    }
    assert.ok(eocd >= 0, 'falta el registro de fin de directorio');
    assert.equal(view.getUint16(eocd + 10, true), 3);
  });
});

describe('safeBaseName', () => {
  it('quita la extensión y los caracteres prohibidos en nombres de archivo', () => {
    assert.equal(safeBaseName('Factura: 2026/03?.pdf', 'Texto OCR'), 'Factura 202603');
  });

  it('usa el nombre de respaldo cuando no queda nada útil', () => {
    assert.equal(safeBaseName('???.png', 'Texto OCR'), 'Texto OCR');
    assert.equal(safeBaseName('', 'Texto OCR'), 'Texto OCR');
  });
});
