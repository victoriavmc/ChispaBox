/*
 * Escritor mínimo de PDF 1.7 para imágenes. Sin dependencias.
 *
 * Por qué no se usa pdf-lib: su última versión (1.17.1) se publicó el 6 nov 2021 y el
 * proyecto no tiene mantenimiento; RG-04 lo excluye. Este módulo solo necesita:
 * una página por imagen, un XObject de imagen (JPEG con DCTDecode o RGB con FlateDecode),
 * una tabla xref y el trailer. Todo está verificado con pruebas (ver tests/documentos-pdf).
 *
 * Las imágenes ya vienen codificadas (JPEG o RGB comprimido con zlib) desde el navegador.
 */

export interface PdfImage {
  width: number;
  height: number;
  /** JPEG (DCTDecode) o RGB de 8 bits comprimido en zlib (FlateDecode). */
  encoding: 'jpeg' | 'flate';
  data: Uint8Array;
}

export interface PdfPage {
  /** Tamaño de la página en puntos. */
  width: number;
  height: number;
  /** Posición y tamaño de la imagen en puntos (origen abajo a la izquierda). */
  x: number;
  y: number;
  drawWidth: number;
  drawHeight: number;
  image: PdfImage;
}

const enc = new TextEncoder();

/** Número con formato decimal fijo, sin notación científica (válido en PDF). */
function num(value: number): string {
  if (!Number.isFinite(value)) throw new Error('Valor numérico no válido en el PDF.');
  return value.toFixed(4).replace(/\.?0+$/, '') || '0';
}

class Output {
  private readonly chunks: Uint8Array[] = [];
  private length = 0;

  get position(): number {
    return this.length;
  }

  text(value: string): void {
    this.bytes(enc.encode(value));
  }

  bytes(value: Uint8Array): void {
    this.chunks.push(value);
    this.length += value.length;
  }

  toUint8Array(): Uint8Array {
    const out = new Uint8Array(this.length);
    let offset = 0;
    for (const chunk of this.chunks) {
      out.set(chunk, offset);
      offset += chunk.length;
    }
    return out;
  }
}

/** Genera el PDF con una página por entrada. Lanza error si no hay páginas. */
export function buildPdf(pages: readonly PdfPage[]): Uint8Array {
  if (pages.length === 0) throw new Error('El PDF necesita al menos una página.');

  // Numeración de objetos: 1 catálogo, 2 árbol de páginas, 3 información,
  // y por cada página: página, contenido e imagen (4 + 3·i, 5 + 3·i, 6 + 3·i).
  const pageObj = (i: number) => 4 + 3 * i;
  const contentObj = (i: number) => 5 + 3 * i;
  const imageObj = (i: number) => 6 + 3 * i;
  const lastObj = imageObj(pages.length - 1);
  const offsets = new Array<number>(lastObj + 1).fill(0);

  const out = new Output();
  out.text('%PDF-1.7\n');
  out.bytes(new Uint8Array([0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a]));

  const startObject = (n: number) => {
    offsets[n] = out.position;
    out.text(`${n} 0 obj\n`);
  };

  startObject(1);
  out.text('<< /Type /Catalog /Pages 2 0 R >>\nendobj\n');

  startObject(2);
  const kids = pages.map((_p, i) => `${pageObj(i)} 0 R`).join(' ');
  out.text(`<< /Type /Pages /Kids [${kids}] /Count ${pages.length} >>\nendobj\n`);

  startObject(3);
  out.text('<< /Producer (ChispaBox) /Creator (ChispaBox - Documentos a PDF) >>\nendobj\n');

  pages.forEach((page, i) => {
    const { image } = page;
    if (!Number.isInteger(image.width) || !Number.isInteger(image.height) || image.width < 1 || image.height < 1) {
      throw new Error('Dimensiones de imagen no válidas.');
    }
    if (page.width <= 0 || page.height <= 0 || page.width > 14400 || page.height > 14400) {
      throw new Error('Tamaño de página fuera de los límites del PDF.');
    }

    startObject(pageObj(i));
    out.text(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${num(page.width)} ${num(page.height)}] ` +
        `/Resources << /ProcSet [/PDF /ImageB /ImageC /ImageI] /XObject << /Im${i} ${imageObj(i)} 0 R >> >> ` +
        `/Contents ${contentObj(i)} 0 R >>\nendobj\n`,
    );

    const content = enc.encode(
      `q ${num(page.drawWidth)} 0 0 ${num(page.drawHeight)} ${num(page.x)} ${num(page.y)} cm /Im${i} Do Q\n`,
    );
    startObject(contentObj(i));
    out.text(`<< /Length ${content.length} >>\nstream\n`);
    out.bytes(content);
    out.text('\nendstream\nendobj\n');

    const filter = image.encoding === 'jpeg' ? '/Filter /DCTDecode' : '/Filter /FlateDecode';
    startObject(imageObj(i));
    out.text(
      `<< /Type /XObject /Subtype /Image /Width ${image.width} /Height ${image.height} ` +
        `/ColorSpace /DeviceRGB /BitsPerComponent 8 ${filter} /Length ${image.data.length} >>\nstream\n`,
    );
    out.bytes(image.data);
    out.text('\nendstream\nendobj\n');
  });

  const xrefOffset = out.position;
  const count = lastObj + 1;
  out.text(`xref\n0 ${count}\n0000000000 65535 f \n`);
  for (let n = 1; n < count; n += 1) {
    out.text(`${String(offsets[n]).padStart(10, '0')} 00000 n \n`);
  }
  out.text(`trailer\n<< /Size ${count} /Root 1 0 R /Info 3 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`);
  return out.toUint8Array();
}

/** Comprobación estructural del PDF generado (cabecera, final, páginas y xref). */
export function inspectPdfStructure(bytes: Uint8Array): { ok: boolean; pages: number; reason?: string } {
  const text = new TextDecoder('latin1').decode(bytes);
  if (!text.startsWith('%PDF-')) return { ok: false, pages: 0, reason: 'Falta la cabecera %PDF.' };
  if (!text.trimEnd().endsWith('%%EOF')) return { ok: false, pages: 0, reason: 'Falta el final %%EOF.' };
  const startxref = text.lastIndexOf('startxref');
  if (startxref < 0) return { ok: false, pages: 0, reason: 'Falta startxref.' };
  const xrefPos = Number(text.slice(startxref).split(/\s+/)[1]);
  if (!text.startsWith('xref', xrefPos)) return { ok: false, pages: 0, reason: 'startxref no apunta a la tabla xref.' };

  const tableLines = text.slice(xrefPos).split('\n');
  const [, rangeLine] = tableLines;
  const [, countStr] = (rangeLine ?? '').split(' ');
  const count = Number(countStr);
  // Líneas: [0] «xref», [1] «0 N», [2] entrada del objeto 0, [3] entrada del objeto 1, …
  for (let n = 1; n < count; n += 1) {
    const entry = tableLines[n + 2]?.match(/^(\d{10}) \d{5} n $/);
    if (!entry) return { ok: false, pages: 0, reason: `Entrada xref ${n} no válida.` };
    const at = Number(entry[1]);
    if (!text.startsWith(`${n} 0 obj`, at)) return { ok: false, pages: 0, reason: `Desfase en el objeto ${n}.` };
  }
  const pages = (text.match(/\/Type \/Page(?!s)/g) ?? []).length;
  return { ok: true, pages };
}
