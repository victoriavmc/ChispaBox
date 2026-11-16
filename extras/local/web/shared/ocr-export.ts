/*
 * Exportación del texto reconocido por OCR a TXT y DOCX. Sin dependencias y sin DOM:
 * el DOCX es un paquete OOXML mínimo (document.xml) empaquetado con el escritor ZIP compartido.
 *
 * Convención de páginas: cuando hay varias páginas, el texto lleva una línea separadora
 * «--- Página N ---». En el DOCX esa línea se convierte en un salto de página real.
 */
import { buildZipStore } from '../../../../src/shared/zip-store.ts';

export const PAGE_SEPARATOR_RE = /^--- Página \d+ ---$/;

/** Línea separadora de página (la usa la interfaz y el exportador). */
export function pageSeparator(pageNumber: number): string {
  return `--- Página ${pageNumber} ---`;
}

/** Quita caracteres de control que no son válidos en XML 1.0 (tabulador, salto de línea y retorno se conservan). */
export function stripInvalidXmlChars(text: string): string {
  // eslint-disable-next-line no-control-regex
  return text.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g, '');
}

export function escapeXml(text: string): string {
  return stripInvalidXmlChars(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/** Texto plano UTF-8 con BOM (para que Bloc de notas de Windows muestre bien tildes y ñ). */
export function buildTxtBytes(text: string): Uint8Array {
  const normalized = text.replace(/\r\n?/g, '\n');
  return new TextEncoder().encode(`﻿${normalized}`);
}

/** Un párrafo de Word por línea; las líneas separadoras de página se convierten en saltos de página. */
export function buildDocumentXml(text: string): string {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const paragraphs = lines.map((line) => {
    if (PAGE_SEPARATOR_RE.test(line.trim())) {
      return '<w:p><w:r><w:br w:type="page"/></w:r></w:p>';
    }
    if (line.length === 0) return '<w:p/>';
    return `<w:p><w:r><w:t xml:space="preserve">${escapeXml(line)}</w:t></w:r></w:p>`;
  });
  return (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
    `<w:body>${paragraphs.join('')}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/>` +
    '<w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="708" w:footer="708" w:gutter="0"/>' +
    '</w:sectPr></w:body></w:document>'
  );
}

const CONTENT_TYPES_XML =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
  '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
  '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
  '<Default Extension="xml" ContentType="application/xml"/>' +
  '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
  '</Types>';

const ROOT_RELS_XML =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
  '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
  '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
  '</Relationships>';

/** Archivo .docx (ZIP sin compresión con las tres partes mínimas de Word). */
export function buildDocxBytes(text: string): Uint8Array {
  const encoder = new TextEncoder();
  return buildZipStore([
    { name: '[Content_Types].xml', data: encoder.encode(CONTENT_TYPES_XML) },
    { name: '_rels/.rels', data: encoder.encode(ROOT_RELS_XML) },
    { name: 'word/document.xml', data: encoder.encode(buildDocumentXml(text)) },
  ]);
}

/** safeBaseName vive en un módulo compartido; se reexporta para el código OCR. */
export { safeBaseName } from '../../../../src/shared/nombre-archivo.ts';
