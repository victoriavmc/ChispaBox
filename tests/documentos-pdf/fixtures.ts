/*
 * Generador de documentos de prueba mínimos (OOXML válidos) para las pruebas automáticas.
 * Se crean en memoria; no se versionan binarios de terceros.
 */
import { buildZip, type ZipFile } from '../../server/documentos-pdf/zip.ts';

const CT_HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>';
const ROOT_RELS = (target: string) =>
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="${target}"/></Relationships>`;

const txt = (name: string, content: string): ZipFile => ({ name, data: Buffer.from(content, 'utf8') });

export function makeDocx(paragraphs: string[]): Buffer {
  const body = paragraphs.map((p) => `<w:p><w:r><w:t xml:space="preserve">${p}</w:t></w:r></w:p>`).join('');
  return buildZip([
    txt('[Content_Types].xml', `${CT_HEAD}<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`),
    txt('_rels/.rels', ROOT_RELS('word/document.xml')),
    txt('word/document.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr></w:body></w:document>`),
  ]);
}

/** Libro con hojas { name, rows } (celdas de texto inline). */
export function makeXlsx(sheets: Array<{ name: string; rows: string[][]; hidden?: boolean }>, extraSheetXml = ''): Buffer {
  const sheetEls = sheets
    .map((s, i) => `<sheet name="${s.name}" sheetId="${i + 1}"${s.hidden ? ' state="hidden"' : ''} r:id="rId${i + 1}"/>`)
    .join('');
  const overrides = sheets
    .map((_s, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`)
    .join('');
  const rels = sheets
    .map((_s, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`)
    .join('');
  const files: ZipFile[] = [
    txt('[Content_Types].xml', `${CT_HEAD}<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>${overrides}</Types>`),
    txt('_rels/.rels', ROOT_RELS('xl/workbook.xml')),
    txt('xl/workbook.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheetEls}</sheets></workbook>`),
    txt('xl/_rels/workbook.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rels}</Relationships>`),
  ];
  sheets.forEach((s, i) => {
    const rows = s.rows
      .map((cells, r) => `<row r="${r + 1}">${cells.map((c, col) => `<c r="${String.fromCharCode(65 + (col % 26))}${r + 1}" t="inlineStr"><is><t>${c}</t></is></c>`).join('')}</row>`)
      .join('');
    files.push(txt(`xl/worksheets/sheet${i + 1}.xml`, `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheetData>${rows}</sheetData>${i === 0 ? extraSheetXml : ''}</worksheet>`));
  });
  return buildZip(files);
}

/** Presentación con una diapositiva por texto (distintos tamaños de fuente opcionales). */
export function makePptx(slides: string[]): Buffer {
  const ids = slides.map((_s, i) => `<p:sldId id="${256 + i}" r:id="rId${i + 2}"/>`).join('');
  const overrides = slides
    .map((_s, i) => `<Override PartName="/ppt/slides/slide${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>`)
    .join('');
  const rels = slides
    .map((_s, i) => `<Relationship Id="rId${i + 2}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide${i + 1}.xml"/>`)
    .join('');
  const files: ZipFile[] = [
    txt('[Content_Types].xml', `${CT_HEAD}<Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>${overrides}</Types>`),
    txt('_rels/.rels', ROOT_RELS('ppt/presentation.xml')),
    txt('ppt/presentation.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<p:presentation xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:sldIdLst>${ids}</p:sldIdLst><p:sldSz cx="9144000" cy="6858000"/><p:notesSz cx="6858000" cy="9144000"/></p:presentation>`),
    txt('ppt/_rels/presentation.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rels}</Relationships>`),
  ];
  slides.forEach((text, i) => {
    files.push(
      txt(
        `ppt/slides/slide${i + 1}.xml`,
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/><p:sp><p:nvSpPr><p:cNvPr id="2" name="Texto"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="457200" y="457200"/><a:ext cx="8229600" cy="1000000"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr><p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr lang="es-ES" sz="3200"/><a:t>${text}</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>`,
      ),
    );
  });
  return buildZip(files);
}

/** Documento Word con un vínculo de imagen externa (TargetMode="External") y macros opcionales. */
export function makeDocxWithExternal(externalUrl: string, withMacro = false): Buffer {
  const rels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId9" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="${externalUrl}" TargetMode="External"/></Relationships>`;
  const body = `<w:p><w:r><w:t>Documento con vínculo externo</w:t></w:r></w:p><w:p><w:r><w:drawing><wp:inline xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"><wp:extent cx="952500" cy="952500"/><a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:blipFill><a:blip xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" r:embed="rId9"/></pic:blipFill></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>`;
  const files: ZipFile[] = [
    txt('[Content_Types].xml', `${CT_HEAD}<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`),
    txt('_rels/.rels', ROOT_RELS('word/document.xml')),
    txt('word/_rels/document.xml.rels', rels),
    txt('word/document.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><w:body>${body}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/></w:sectPr></w:body></w:document>`),
  ];
  if (withMacro) files.push(txt('word/vbaProject.bin', 'MACRO-DE-PRUEBA-NO-EJECUTAR'));
  return buildZip(files);
}
