/*
 * Pruebas de integración de «Documentos a PDF» con LibreOffice real.
 * Requiere LibreOffice instalado: variable SOFFICE_PATH o la ruta local por defecto.
 * Si no existe, las pruebas se omiten con un aviso. No se inventan resultados.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, request as httpRequest, type Server } from 'node:http';
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { createDocumentosApi, type DocumentosApi } from '../../server/documentos-pdf/api.ts';
import type { DocumentosConfig } from '../../server/documentos-pdf/config.ts';
import { buildZip } from '../../server/documentos-pdf/zip.ts';
import { makeDocx, makeDocxWithExternal, makePptx, makeXlsx } from './fixtures.ts';
import { buildZipDeflated } from './zip-deflate.ts';

const SOFFICE = process.env.SOFFICE_PATH || 'C:/ruta/a/LibreOffice/program/soffice.com';
const skip = existsSync(SOFFICE) ? false : `LibreOffice no encontrado en ${SOFFICE}`;
const exec = promisify(execFile);

let api: DocumentosApi;
let server: Server;
let base = '';
let tempDir = '';
let listener: Server;
let listenerUrl = '';
let listenerHits = 0;

function makeConfig(overrides: Partial<DocumentosConfig> = {}): DocumentosConfig {
  return {
    enabled: true,
    sofficePath: SOFFICE,
    tempDir,
    maxBytes: 5 * 1024 * 1024,
    timeoutMs: 120_000,
    maxConcurrent: 1,
    maxPages: 500,
    warnings: [],
    ...overrides,
  };
}

interface Reply {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  body: Buffer;
}

/** Envía bytes al API del servidor de pruebas base y devuelve la respuesta completa. */
function postTo(url: string, data: Buffer, headers: Record<string, string | number> = {}): Promise<Reply> {
  return new Promise((resolve, reject) => {
    const req = httpRequest(url, { method: 'POST', headers: { 'Content-Type': 'application/octet-stream', ...headers } }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks) }));
    });
    req.on('error', reject);
    req.end(data);
  });
}

function convert(data: Buffer, query: string, headers: Record<string, string | number> = {}): Promise<Reply> {
  return postTo(`${base}/api/documentos-pdf/convertir?${query}`, data, { 'Content-Length': data.length, ...headers });
}

/** Mensaje de error del API, o el inicio del cuerpo si no es JSON. Se usa solo al fallar. */
function errorOf(reply: Reply): string {
  const text = reply.body.toString('utf8');
  try {
    return (JSON.parse(text) as { error: string }).error;
  } catch {
    return `(${reply.status}) ${text.slice(0, 80)}`;
  }
}

/** Lee texto y tamaños de página con PDF.js (versión de Node, sin worker). */
async function readPdf(bytes: Buffer): Promise<{ pages: number; text: string; boxes: number[][] }> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const task = pdfjs.getDocument({ data: new Uint8Array(bytes), isEvalSupported: false, disableFontFace: true });
  const doc = await task.promise;
  let text = '';
  const boxes: number[][] = [];
  for (let i = 1; i <= doc.numPages; i += 1) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    text += content.items.map((item) => ('str' in item ? item.str : '')).join(' ') + '\n';
    boxes.push([...page.view]);
  }
  const pages = doc.numPages;
  await task.destroy();
  return { pages, text, boxes };
}

async function sofficeCount(): Promise<number> {
  if (process.platform !== 'win32') return 0;
  const { stdout } = await exec('tasklist', ['/FI', 'IMAGENAME eq soffice.bin', '/NH'], { windowsHide: true }).catch(() => ({ stdout: '' }));
  return stdout.split('\n').filter((line) => /soffice\.bin/i.test(line)).length;
}

/** Crea un formato binario antiguo (.doc/.xls/.ppt) a partir de un documento OOXML, con LibreOffice. */
async function legacy(source: Buffer, sourceExt: string, target: 'doc' | 'xls' | 'ppt'): Promise<Buffer> {
  const dir = await mkdtemp(join(tempDir, 'legacy-'));
  const input = join(dir, `origen${sourceExt}`);
  await writeFile(input, source);
  const profile = `file:///${dir.replace(/\\/g, '/')}/perfil`;
  await exec(SOFFICE, [`-env:UserInstallation=${profile}`, '--headless', '--norestore', '--nolockcheck', '--nodefault', '--convert-to', target, '--outdir', dir, input], {
    windowsHide: true,
    timeout: 180_000,
  });
  const out = await readFile(join(dir, `origen.${target}`));
  await rm(dir, { recursive: true, force: true });
  return out;
}

before(async () => {
  if (skip) return;
  tempDir = await mkdtemp(join(tmpdir(), 'chispabox-prueba-'));
  listener = createServer((_req, res) => {
    listenerHits += 1;
    res.writeHead(200, { 'Content-Type': 'image/png' });
    res.end(Buffer.alloc(0));
  });
  await new Promise<void>((resolve) => listener.listen(0, '127.0.0.1', () => resolve()));
  listenerUrl = `http://127.0.0.1:${(listener.address() as { port: number }).port}/imagen-externa.png`;

  api = createDocumentosApi(makeConfig());
  await api.start();
  server = createServer((req, res) => api.handle(req, res));
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});

after(async () => {
  if (skip) return;
  api.dispose();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await new Promise<void>((resolve) => listener.close(() => resolve()));
  await rm(tempDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 500 });
});

test('estado: LibreOffice disponible y formatos listados', { skip }, async () => {
  const res = await fetch(`${base}/api/documentos-pdf/estado`);
  const json = (await res.json()) as { disponible: boolean; version: string; formatos: string[] };
  assert.equal(res.status, 200);
  assert.equal(json.disponible, true);
  assert.match(json.version, /LibreOffice/);
  assert.deepEqual(json.formatos, ['docx', 'doc', 'xlsx', 'xls', 'pptx', 'ppt']);
});

test('Word: documento simple se convierte y el PDF contiene el texto', { skip }, async () => {
  const res = await convert(makeDocx(['Hola mundo ñandú', 'Segundo párrafo con tildes áéíóú']), 'tipo=docx');
  assert.equal(res.status, 200, errorOf(res));
  assert.equal(res.body.subarray(0, 5).toString('latin1'), '%PDF-');
  const pdf = await readPdf(res.body);
  assert.equal(pdf.pages, 1);
  assert.match(pdf.text, /Hola mundo/);
  assert.match(pdf.text, /tildes/);
});

test('Word: documento de varias páginas genera varias páginas', { skip }, async () => {
  const paragraphs = Array.from({ length: 220 }, (_v, i) => `Párrafo número ${i + 1} con texto suficiente para ocupar espacio en la página.`);
  const res = await convert(makeDocx(paragraphs), 'tipo=docx');
  assert.equal(res.status, 200, errorOf(res));
  assert.ok(Number(res.headers['x-paginas']) > 1, `páginas: ${res.headers['x-paginas']}`);
});

test('Word: formato binario .doc se convierte', { skip }, async () => {
  const doc = await legacy(makeDocx(['Texto binario antiguo']), '.docx', 'doc');
  const res = await convert(doc, 'tipo=doc');
  assert.equal(res.status, 200, errorOf(res));
  assert.match((await readPdf(res.body)).text, /binario antiguo/);
});

test('Word: vínculo externo no genera conexiones y se informa', { skip }, async () => {
  listenerHits = 0;
  const res = await convert(makeDocxWithExternal(listenerUrl), 'tipo=docx');
  assert.equal(res.status, 200, errorOf(res));
  assert.equal(res.headers['x-vinculos-externos'], 'si');
  await new Promise((resolve) => setTimeout(resolve, 1500));
  assert.equal(listenerHits, 0, 'LibreOffice no debe descargar recursos remotos');
});

test('Word: macros presentes se informan y no se ejecutan', { skip }, async () => {
  const res = await convert(makeDocxWithExternal('https://example.invalid/no-existe.png', true), 'tipo=docx');
  assert.equal(res.status, 200, errorOf(res));
  assert.equal(res.headers['x-macros-detectadas'], 'si');
  assert.doesNotMatch((await readPdf(res.body)).text, /MACRO-DE-PRUEBA/);
});

test('PowerPoint: cada diapositiva es una página con proporción 4:3', { skip }, async () => {
  const res = await convert(makePptx(['Diapositiva uno', 'Diapositiva dos', 'Diapositiva tres']), 'tipo=pptx');
  assert.equal(res.status, 200, errorOf(res));
  const pdf = await readPdf(res.body);
  assert.equal(pdf.pages, 3);
  assert.match(pdf.text, /Diapositiva dos/);
  const [x0, y0, x1, y1] = pdf.boxes[0];
  assert.ok(Math.abs((x1 - x0) / (y1 - y0) - 4 / 3) < 0.01);
});

test('PowerPoint: formato binario .ppt se convierte', { skip }, async () => {
  const ppt = await legacy(makePptx(['Diapositiva binaria']), '.pptx', 'ppt');
  const res = await convert(ppt, 'tipo=ppt');
  assert.equal(res.status, 200, errorOf(res));
  assert.match((await readPdf(res.body)).text, /binaria/);
});

test('Excel: cada hoja aparece en el PDF', { skip }, async () => {
  const xlsx = makeXlsx([
    { name: 'Ventas', rows: [['Producto', 'Monto'], ['Pan', '100']] },
    { name: 'Gastos', rows: [['Concepto', 'Importe'], ['Luz', '50']] },
  ]);
  const res = await convert(xlsx, 'tipo=xlsx');
  assert.equal(res.status, 200, errorOf(res));
  const pdf = await readPdf(res.body);
  assert.ok(pdf.pages >= 2);
  assert.match(pdf.text, /Pan/);
  assert.match(pdf.text, /Luz/);
});

test('Excel: orientación horizontal y papel Carta aplicados a la copia', { skip }, async () => {
  const xlsx = makeXlsx([{ name: 'Hoja', rows: [['Columna A', 'Columna B', 'Columna C']] }]);
  const res = await convert(xlsx, 'tipo=xlsx&orientacion=horizontal&papel=letter&ajuste=original');
  assert.equal(res.status, 200, errorOf(res));
  const [x0, y0, x1, y1] = (await readPdf(res.body)).boxes[0];
  assert.equal(Math.round(x1 - x0), 792);
  assert.equal(Math.round(y1 - y0), 612);
});

test('Excel: ajuste de ancho no aumenta las páginas con muchas columnas', { skip }, async () => {
  const cols = Array.from({ length: 30 }, (_v, i) => `Col${i + 1}`);
  const xlsx = makeXlsx([{ name: 'Ancha', rows: [cols, cols.map((_c, i) => String(i))] }]);
  const plain = await convert(xlsx, 'tipo=xlsx&ajuste=original');
  const fitted = await convert(xlsx, 'tipo=xlsx&ajuste=ancho');
  assert.equal(plain.status, 200, errorOf(plain));
  assert.equal(fitted.status, 200, errorOf(fitted));
  assert.ok((await readPdf(fitted.body)).pages <= (await readPdf(plain.body)).pages);
});

test('Excel: formato binario .xls se convierte', { skip }, async () => {
  const xls = await legacy(makeXlsx([{ name: 'Legado', rows: [['texto-xls']] }]), '.xlsx', 'xls');
  const res = await convert(xls, 'tipo=xls');
  assert.equal(res.status, 200, errorOf(res));
  assert.match((await readPdf(res.body)).text, /texto-xls/);
});

test('Excel: hoja oculta queda registrada en la respuesta', { skip }, async () => {
  const xlsx = makeXlsx([
    { name: 'Visible', rows: [['visible']] },
    { name: 'Oculta', rows: [['oculta']], hidden: true },
  ]);
  const res = await convert(xlsx, 'tipo=xlsx');
  assert.equal(res.status, 200, errorOf(res));
  assert.equal(res.headers['x-hojas-ocultas'], '1');
  // LibreOffice exporta solo la hoja visible: el PDF tiene una página y no contiene el texto de la oculta.
  const pdf = await readPdf(res.body);
  assert.equal(pdf.pages, 1);
  assert.match(pdf.text, /visible/);
  assert.doesNotMatch(pdf.text, /oculta/);
});

test('Rechazo: archivo corrupto con firma ZIP', { skip }, async () => {
  const res = await convert(Buffer.from('PK\u0003\u0004 contenido sin estructura válida'), 'tipo=docx');
  assert.equal(res.status, 422);
});

test('Rechazo: xlsx enviado como docx no se acepta', { skip }, async () => {
  const res = await convert(makeXlsx([{ name: 'A', rows: [['x']] }]), 'tipo=docx');
  assert.equal(res.status, 422);
  assert.match(errorOf(res), /no corresponde/);
});

test('Rechazo: texto plano enviado como .doc', { skip }, async () => {
  const res = await convert(Buffer.from('solo texto, no es un documento binario de Word'), 'tipo=doc');
  assert.equal(res.status, 422);
});

test('Rechazo: ruta peligrosa dentro del ZIP', { skip }, async () => {
  const res = await convert(buildZip([{ name: '../../escape.xml', data: Buffer.from('x') }]), 'tipo=docx');
  assert.equal(res.status, 422);
  assert.match(errorOf(res), /rutas internas/);
});

test('Rechazo: archivo comprimido de forma anómala (zip bomb)', { skip }, async () => {
  const bomb = buildZipDeflated([
    { name: '[Content_Types].xml', data: Buffer.from('<Types/>') },
    { name: 'word/document.xml', data: Buffer.alloc(20 * 1024 * 1024) },
  ]);
  const res = await convert(bomb, 'tipo=docx');
  assert.equal(res.status, 422);
  assert.match(errorOf(res), /anómala|límite/);
});

test('Límite: archivo mayor que el máximo se rechaza por Content-Length', { skip }, async () => {
  const res = await convert(Buffer.alloc(6 * 1024 * 1024, 1), 'tipo=docx');
  assert.equal(res.status, 413);
});

test('Límite: sin Content-Length (transferencia por partes) se rechaza', { skip }, async () => {
  // Se fuerza chunked con dos escrituras: Node no añade Content-Length en ese caso.
  const data = makeDocx(['x']);
  const half = Math.floor(data.length / 2);
  const res = await new Promise<Reply>((resolve, reject) => {
    const req = httpRequest(`${base}/api/documentos-pdf/convertir?tipo=docx`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream', 'Transfer-Encoding': 'chunked' },
    }, (r) => {
      const chunks: Buffer[] = [];
      r.on('data', (c: Buffer) => chunks.push(c));
      r.on('end', () => resolve({ status: r.statusCode ?? 0, headers: r.headers, body: Buffer.concat(chunks) }));
    });
    req.on('error', reject);
    req.write(data.subarray(0, half));
    req.end(data.subarray(half));
  });
  assert.equal(res.status, 411);
});

test('Seguridad: origen ajeno rechazado', { skip }, async () => {
  const res = await convert(makeDocx(['x']), 'tipo=docx', { Origin: 'https://sitio-ajeno.example' });
  assert.equal(res.status, 403);
});

test('Parámetros fuera de la lista blanca se rechazan', { skip }, async () => {
  assert.equal((await convert(makeDocx(['x']), 'tipo=docx&orientacion=diagonal')).status, 400);
  assert.equal((await convert(makeDocx(['x']), 'tipo=sh')).status, 400);
  assert.equal((await convert(makeDocx(['x']), 'tipo=docx&papel=a3')).status, 400);
});

test('Límite de páginas: más páginas que el máximo se rechaza', { skip }, async () => {
  const limited = createDocumentosApi(makeConfig({ maxPages: 1 }));
  const srv = createServer((req, res) => limited.handle(req, res));
  await new Promise<void>((resolve) => srv.listen(0, '127.0.0.1', () => resolve()));
  try {
    const port = (srv.address() as { port: number }).port;
    const paragraphs = Array.from({ length: 220 }, (_v, i) => `Línea ${i} para forzar varias páginas en el documento.`);
    const data = makeDocx(paragraphs);
    const res = await postTo(`http://127.0.0.1:${port}/api/documentos-pdf/convertir?tipo=docx`, data, { 'Content-Length': data.length });
    assert.equal(res.status, 422);
    assert.match(errorOf(res), /supera 1 páginas/);
  } finally {
    limited.dispose();
    await new Promise<void>((resolve) => srv.close(() => resolve()));
  }
});

test('Simultaneidad: una segunda conversión en curso recibe 429', { skip }, async () => {
  const paragraphs = Array.from({ length: 400 }, (_v, i) => `Párrafo ${i} de la prueba de simultaneidad con texto de relleno.`);
  const first = convert(makeDocx(paragraphs), 'tipo=docx');
  await new Promise((resolve) => setTimeout(resolve, 400));
  const second = await convert(makeDocx(['b']), 'tipo=docx');
  assert.equal(second.status, 429);
  assert.equal((await first).status, 200);
});

test('Cancelación: cerrar la conexión detiene LibreOffice y borra los temporales', { skip }, async () => {
  const processesBefore = await sofficeCount();
  const paragraphs = Array.from({ length: 600 }, (_v, i) => `Cancelar ${i} ${'texto '.repeat(30)}`);
  const data = makeDocx(paragraphs);
  await new Promise<void>((resolve) => {
    const req = httpRequest(`${base}/api/documentos-pdf/convertir?tipo=docx`, {
      method: 'POST',
      headers: { 'Content-Length': data.length, 'Content-Type': 'application/octet-stream' },
    });
    req.on('error', () => resolve());
    req.end(data);
    setTimeout(() => {
      req.destroy();
      resolve();
    }, 2500);
  });
  await new Promise((resolve) => setTimeout(resolve, 8000));
  const leftovers = (await readdir(tempDir)).filter((name) => name.startsWith('chispabox-docs-'));
  assert.equal(leftovers.length, 0, `temporales restantes: ${leftovers.length}`);
  assert.ok((await sofficeCount()) <= processesBefore, 'no deben quedar procesos de LibreOffice');
});

test('Tiempo máximo: al superarlo responde 504 y limpia', { skip }, async () => {
  const slow = createDocumentosApi(makeConfig({ timeoutMs: 1000 }));
  const srv = createServer((req, res) => slow.handle(req, res));
  await new Promise<void>((resolve) => srv.listen(0, '127.0.0.1', () => resolve()));
  try {
    const port = (srv.address() as { port: number }).port;
    const data = makeDocx(['tiempo']);
    const res = await postTo(`http://127.0.0.1:${port}/api/documentos-pdf/convertir?tipo=docx`, data, { 'Content-Length': data.length });
    assert.equal(res.status, 504);
  } finally {
    slow.dispose();
    await new Promise<void>((resolve) => srv.close(() => resolve()));
  }
});
