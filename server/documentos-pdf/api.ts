/*
 * API local de «Documentos a PDF» (solo en `npm run dev` y `npm run preview`).
 *
 * Rutas:
 * - GET  /api/documentos-pdf/estado     → si el servicio está habilitado y LibreOffice responde.
 * - POST /api/documentos-pdf/convertir  → cuerpo = bytes del documento (application/octet-stream).
 *     ?tipo=docx|doc|xlsx|xls|pptx|ppt
 *     &orientacion=original|vertical|horizontal   (solo Excel)
 *     &papel=original|a4|letter|legal            (solo Excel)
 *     &ajuste=original|ancho                     (solo Excel)
 *   Responde application/pdf. Parámetros fuera de lista blanca → 400.
 * - POST /api/documentos-pdf/pdf-a-documento → cuerpo = bytes de un PDF.
 *     ?tipo=docx|odt|rtf  → texto del PDF en párrafos (docx directo; odt y rtf, desde ese docx con LibreOffice).
 *
 * Controles (RG-03, RG-05, RG-06, sección 9 y 10):
 * - Solo se acepta la misma origen (Origin, si llega, debe coincidir con Host).
 * - Tamaño máximo verificado al recibir el cuerpo (no solo por Content-Length).
 * - Validación de firma y estructura antes de LibreOffice; macros y vínculos no se ejecutan ni actualizan.
 * - Un trabajo por cliente y límite de conversiones simultáneas; tiempo máximo por trabajo.
 * - Si el cliente cancela (cierra la conexión), se termina LibreOffice y se borran los temporales.
 * - Cada trabajo usa su propia carpeta temporal; nunca se usa el nombre del archivo del usuario.
 * - No se escriben originales ni se guarda contenido: solo se usan temporales que se borran al final.
 * - No se registra el contenido de los documentos en los logs.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { mkdir, mkdtemp, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import type { Plugin, ViteDevServer } from 'vite';
import { OFFICE_FORMAT_KEYS, OFFICE_FORMATS, type OfficeFormat } from '../../src/shared/documentos-limits.ts';
import type { DocumentosConfig } from './config.ts';
import { applyExcelPageOptions, type ExcelPageOptions } from './excel-page.ts';
import { OfficeValidationError, validateOffice } from './office-check.ts';
import { convertToPdf, sofficeVersion, SofficeError, type PdfFilter } from './soffice.ts';
import { bloquesADocx, pdfABloques, PdfTextoError } from './pdf-texto.ts';

export const API_PREFIX = '/api/documentos-pdf';
const WORK_PREFIX = 'chispabox-docs-';
const VERSION_TTL_MS = 5 * 60_000;

const FILTER: Record<OfficeFormat, PdfFilter> = {
  docx: 'writer_pdf_Export',
  doc: 'writer_pdf_Export',
  xlsx: 'calc_pdf_Export',
  xls: 'calc_pdf_Export',
  pptx: 'impress_pdf_Export',
  ppt: 'impress_pdf_Export',
};

const ORIENTACIONES = ['original', 'vertical', 'horizontal'] as const;
const PAPELES = ['original', 'a4', 'letter', 'legal'] as const;
const AJUSTES = ['original', 'ancho'] as const;

/**
 * PDF a documento editable (LibreOffice importa el PDF con Writer y lo exporta al formato elegido).
 * La firma de salida se comprueba antes de entregar: ZIP para OOXML/ODF, texto RTF para RTF.
 */
export const PDF_TARGETS = {
  docx: {
    convertTo: 'docx:MS Word 2007 XML',
    mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    signature: 'zip',
  },
  odt: { convertTo: 'odt:writer8', mime: 'application/vnd.oasis.opendocument.text', signature: 'zip' },
  rtf: { convertTo: 'rtf:Rich Text Format', mime: 'application/rtf', signature: 'rtf' },
} as const;
export type PdfTarget = keyof typeof PDF_TARGETS;
export const PDF_TARGET_KEYS = Object.keys(PDF_TARGETS) as PdfTarget[];

/** Comprueba la firma «%PDF-» al inicio del archivo de entrada. */
export function isPdfBuffer(buf: Buffer): boolean {
  return buf.length >= 16 && buf.subarray(0, 5).toString('latin1') === '%PDF-';
}

/** Comprueba la firma del documento generado antes de entregarlo. */
export function isValidDocumentOutput(buf: Buffer, signature: 'zip' | 'rtf'): boolean {
  if (buf.length < 64) return false;
  if (signature === 'zip') return buf[0] === 0x50 && buf[1] === 0x4b && buf[2] === 0x03 && buf[3] === 0x04;
  return buf.subarray(0, 5).toString('latin1') === '{\\rtf';
}

export interface DocumentosApi {
  /** Limpia carpetas de trabajo de ejecuciones anteriores. Llamar una vez al arrancar. */
  start(): Promise<void>;
  handle(req: IncomingMessage, res: ServerResponse): void;
  /** Cancela los trabajos en curso (y, con ello, LibreOffice). */
  dispose(): void;
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(text),
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  res.end(text);
}

/** Acepta solo peticiones del mismo origen (protege frente a páginas ajenas que usen el navegador del usuario). */
function isSameOrigin(req: IncomingMessage): boolean {
  const origin = req.headers.origin;
  if (origin === undefined) return true;
  try {
    return new URL(origin).host === req.headers.host;
  } catch {
    return false;
  }
}

/** Comprueba la firma y la cantidad de páginas de un PDF generado. */
export function checkPdf(buf: Buffer, maxPages: number): { pages: number } | null {
  if (buf.length < 16 || buf.subarray(0, 5).toString('latin1') !== '%PDF-') return null;
  if (!buf.subarray(Math.max(0, buf.length - 2048)).toString('latin1').includes('%%EOF')) return null;
  const text = buf.toString('latin1');
  const pages = (text.match(/\/Type\s*\/Page(?!s)/g) ?? []).length;
  if (pages < 1 || pages > maxPages) return null;
  return { pages };
}

function parseOptions(params: URLSearchParams): ExcelPageOptions | null {
  const orientation = params.get('orientacion') ?? 'original';
  const paper = params.get('papel') ?? 'original';
  const fit = params.get('ajuste') ?? 'original';
  if (!(ORIENTACIONES as readonly string[]).includes(orientation)) return null;
  if (!(PAPELES as readonly string[]).includes(paper)) return null;
  if (!(AJUSTES as readonly string[]).includes(fit)) return null;
  return {
    orientation: orientation as ExcelPageOptions['orientation'],
    paper: paper as ExcelPageOptions['paper'],
    fit: fit as ExcelPageOptions['fit'],
  };
}

/**
 * Lee el cuerpo acotando el tamaño real recibido. Devuelve null si supera el límite
 * o si el cliente se desconecta antes de terminar (así no queda ningún trabajo colgado).
 */
function readBody(req: IncomingMessage, maxBytes: number): Promise<Buffer | null> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    let settled = false;
    const finish = (value: Buffer | null) => {
      if (settled) return;
      settled = true;
      if (value === null) chunks.length = 0;
      resolve(value);
    };
    req.on('data', (chunk: Buffer) => {
      if (settled) return;
      total += chunk.length;
      if (total > maxBytes) {
        finish(null);
        req.resume();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => finish(Buffer.concat(chunks, total)));
    req.on('aborted', () => finish(null));
    req.on('close', () => finish(null));
    req.on('error', (error) => {
      if (settled) return;
      settled = true;
      reject(error);
    });
  });
}

export function createDocumentosApi(config: DocumentosConfig): DocumentosApi {
  let active = 0;
  let versionCache: { value: string | null; at: number } | null = null;
  const controllers = new Set<AbortController>();

  async function ensureTempRoot(): Promise<void> {
    await mkdir(config.tempDir, { recursive: true });
  }

  /** Borra solo las carpetas de trabajo de este módulo que hayan quedado de un cierre anterior. */
  async function cleanupStale(): Promise<void> {
    await ensureTempRoot();
    const entries = await readdir(config.tempDir, { withFileTypes: true }).catch(() => []);
    await Promise.all(
      entries
        .filter((e) => e.isDirectory() && e.name.startsWith(WORK_PREFIX))
        .map((e) => rm(join(config.tempDir, e.name), { recursive: true, force: true })),
    );
  }

  async function currentVersion(): Promise<string | null> {
    if (versionCache && Date.now() - versionCache.at < VERSION_TTL_MS) return versionCache.value;
    const value = await sofficeVersion(config.sofficePath, config.tempDir).catch(() => null);
    versionCache = { value, at: Date.now() };
    return value;
  }

  async function handleStatus(res: ServerResponse): Promise<void> {
    const version = config.enabled ? await currentVersion() : null;
    sendJson(res, 200, {
      habilitado: config.enabled,
      disponible: version !== null,
      version,
      formatos: OFFICE_FORMAT_KEYS,
      limites: {
        maxBytes: config.maxBytes,
        timeoutSeg: Math.round(config.timeoutMs / 1000),
        maxPaginas: config.maxPages,
        maxSimultaneas: config.maxConcurrent,
      },
    });
  }

  async function handleConvert(req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
    if (!config.enabled) return sendJson(res, 404, { error: 'La conversión de documentos está deshabilitada en este entorno.' });
    if (!isSameOrigin(req)) return sendJson(res, 403, { error: 'Origen no permitido.' });

    const tipo = url.searchParams.get('tipo') ?? '';
    if (!(OFFICE_FORMAT_KEYS as string[]).includes(tipo)) {
      return sendJson(res, 400, { error: 'Formato no admitido. Usá .docx, .doc, .xlsx, .xls, .pptx o .ppt.' });
    }
    const format = tipo as OfficeFormat;
    const options = parseOptions(url.searchParams);
    if (!options) return sendJson(res, 400, { error: 'Opción de página no válida.' });
    if (format !== 'xlsx' && url.searchParams.has('orientacion')) {
      return sendJson(res, 400, { error: 'Las opciones de página solo aplican a Excel (.xlsx).' });
    }

    const declared = Number(req.headers['content-length']);
    if (!Number.isInteger(declared) || declared <= 0) return sendJson(res, 411, { error: 'Falta el tamaño del archivo.' });
    if (declared > config.maxBytes) {
      return sendJson(res, 413, { error: `El archivo supera el tamaño máximo (${Math.round(config.maxBytes / 1024 / 1024)} MB).` });
    }
    if (active >= config.maxConcurrent) {
      return sendJson(res, 429, { error: 'Hay conversiones en curso. Esperá un momento y volvé a intentar.' });
    }

    active += 1;
    const controller = new AbortController();
    controllers.add(controller);
    let workDir: string | null = null;
    try {
      const body = await readBody(req, config.maxBytes);
      if (body === null) return sendJson(res, 413, { error: 'El archivo supera el tamaño máximo permitido.' });

      let report;
      try {
        report = validateOffice(body, format);
      } catch (error) {
        if (error instanceof OfficeValidationError) return sendJson(res, 422, { error: error.message });
        throw error;
      }

      // Solo se modifican atributos de página en una copia; el original nunca se escribe.
      let input = body;
      if (format === 'xlsx' && report.zipEntries) {
        input = applyExcelPageOptions(report.zipEntries, options);
      }

      await ensureTempRoot();
      workDir = await mkdtemp(join(config.tempDir, WORK_PREFIX));
      res.on('close', () => {
        if (!res.writableFinished) controller.abort();
      });

      let pdf: Buffer;
      try {
        pdf = await convertToPdf({
          command: config.sofficePath,
          workDir,
          inputName: `entrada${OFFICE_FORMATS[format].extension}`,
          inputBytes: input,
          filter: FILTER[format],
          timeoutMs: config.timeoutMs,
          signal: controller.signal,
        });
      } catch (error) {
        if (error instanceof SofficeError) {
          if (error.code === 'cancelled') return undefined;
          if (error.code === 'missing') return sendJson(res, 503, { error: 'LibreOffice no está disponible en el servidor.' });
          if (error.code === 'timeout') return sendJson(res, 504, { error: error.message });
          return sendJson(res, 422, { error: error.message });
        }
        throw error;
      }

      const checked = checkPdf(pdf, config.maxPages);
      if (!checked) {
        return sendJson(res, 422, {
          error: `El PDF generado supera ${config.maxPages} páginas o no es válido. Dividí el documento e intentá de nuevo.`,
        });
      }
      if (res.writableEnded || controller.signal.aborted) return undefined;

      res.writeHead(200, {
        'Content-Type': 'application/pdf',
        'Content-Length': pdf.length,
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
        'X-Paginas': String(checked.pages),
        'X-Macros-Detectadas': report.hasMacros ? 'si' : 'no',
        'X-Vinculos-Externos': report.hasExternalLinks ? 'si' : 'no',
        'X-Hojas-Ocultas': String(report.hiddenSheetCount),
      });
      res.end(pdf);
      return undefined;
    } finally {
      active -= 1;
      controllers.delete(controller);
      // Windows puede retener un archivo unos instantes tras cerrar LibreOffice: se reintenta.
      if (workDir) await rm(workDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 }).catch(() => undefined);
    }
  }

  /** PDF a documento: cuerpo = bytes del PDF; ?tipo=docx|odt|rtf. Usa los mismos límites y el mismo control de simultaneidad. */
  async function handlePdfToDocument(req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
    if (!config.enabled) return sendJson(res, 404, { error: 'La conversión de documentos está deshabilitada en este entorno.' });
    if (!isSameOrigin(req)) return sendJson(res, 403, { error: 'Origen no permitido.' });

    const tipo = url.searchParams.get('tipo') ?? '';
    if (!(PDF_TARGET_KEYS as string[]).includes(tipo)) {
      return sendJson(res, 400, { error: 'Formato de salida no admitido. Elegí Word (.docx), OpenDocument (.odt) o RTF (.rtf).' });
    }
    const target = PDF_TARGETS[tipo as PdfTarget];

    const declared = Number(req.headers['content-length']);
    if (!Number.isInteger(declared) || declared <= 0) return sendJson(res, 411, { error: 'Falta el tamaño del archivo.' });
    if (declared > config.maxBytes) {
      return sendJson(res, 413, { error: `El archivo supera el tamaño máximo (${Math.round(config.maxBytes / 1024 / 1024)} MB).` });
    }
    if (active >= config.maxConcurrent) {
      return sendJson(res, 429, { error: 'Hay conversiones en curso. Esperá un momento y volvé a intentar.' });
    }

    active += 1;
    const controller = new AbortController();
    controllers.add(controller);
    let workDir: string | null = null;
    try {
      const body = await readBody(req, config.maxBytes);
      if (body === null) return sendJson(res, 413, { error: 'El archivo supera el tamaño máximo permitido.' });
      if (!isPdfBuffer(body)) return sendJson(res, 422, { error: 'El archivo no es un PDF válido.' });

      // 1) Texto del PDF a un .docx con párrafos reales (sin cuadros flotantes). Sin LibreOffice.
      let docx: Buffer;
      try {
        docx = bloquesADocx(await pdfABloques(new Uint8Array(body)));
      } catch (error) {
        if (error instanceof PdfTextoError) return sendJson(res, 422, { error: error.message });
        throw error;
      }
      if (tipo === 'docx') {
        res.writeHead(200, {
          'Content-Type': target.mime,
          'Content-Length': docx.length,
          'Cache-Control': 'no-store',
          'X-Content-Type-Options': 'nosniff',
        });
        res.end(docx);
        return undefined;
      }

      // 2) Para ODT o RTF, LibreOffice convierte ese .docx limpio (importación de Word, sin cuadros).
      await ensureTempRoot();
      workDir = await mkdtemp(join(config.tempDir, WORK_PREFIX));
      res.on('close', () => {
        if (!res.writableFinished) controller.abort();
      });

      let output: Buffer;
      try {
        output = await convertToPdf({
          command: config.sofficePath,
          workDir,
          inputName: 'entrada.docx',
          inputBytes: docx,
          convertTo: target.convertTo,
          outputExt: tipo,
          timeoutMs: config.timeoutMs,
          signal: controller.signal,
        });
      } catch (error) {
        if (error instanceof SofficeError) {
          if (error.code === 'cancelled') return undefined;
          if (error.code === 'missing') return sendJson(res, 503, { error: 'LibreOffice no está disponible en el servidor.' });
          if (error.code === 'timeout') return sendJson(res, 504, { error: error.message });
          return sendJson(res, 422, { error: error.message });
        }
        throw error;
      }

      if (!isValidDocumentOutput(output, target.signature)) {
        return sendJson(res, 422, {
          error: 'No se pudo generar un documento válido a partir de este PDF. Puede estar protegido o ser un escaneo sin texto.',
        });
      }
      if (res.writableEnded || controller.signal.aborted) return undefined;

      res.writeHead(200, {
        'Content-Type': target.mime,
        'Content-Length': output.length,
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
      });
      res.end(output);
      return undefined;
    } finally {
      active -= 1;
      controllers.delete(controller);
      if (workDir) await rm(workDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 }).catch(() => undefined);
    }
  }

  return {
    start: cleanupStale,
    handle(req, res) {
      const url = new URL(req.url ?? '/', 'http://localhost');
      const path = url.pathname;
      const run = async () => {
        if (path === `${API_PREFIX}/estado` && req.method === 'GET') return handleStatus(res);
        if (path === `${API_PREFIX}/convertir` && req.method === 'POST') return handleConvert(req, res, url);
        if (path === `${API_PREFIX}/pdf-a-documento` && req.method === 'POST') return handlePdfToDocument(req, res, url);
        return sendJson(res, 404, { error: 'Ruta no encontrada.' });
      };
      run().catch((error: unknown) => {
        console.error('[documentos-pdf] error interno', error instanceof Error ? error.name : 'desconocido');
        if (!res.headersSent) sendJson(res, 500, { error: 'No se pudo completar la conversión.' });
        else res.end();
      });
    },
    dispose() {
      for (const controller of controllers) controller.abort();
    },
  };
}

/** Plugin de Vite: monta el API en el servidor de desarrollo y en la vista previa (no en el build estático). */
export function documentosPdfApi(config: DocumentosConfig): Plugin {
  const install = (server: Pick<ViteDevServer, 'middlewares' | 'httpServer'>): void => {
    for (const warning of config.warnings) console.warn(`[documentos-pdf] ${warning}`);
    console.info(`[documentos-pdf] conversión de Office ${config.enabled ? 'habilitada' : 'deshabilitada'} en este entorno.`);
    const api = createDocumentosApi(config);
    api.start().catch(() => console.warn('[documentos-pdf] no se pudo preparar la carpeta temporal configurada.'));
    server.middlewares.use((req, res, next) => {
      const path = (req.url ?? '').split('?')[0];
      if (path !== API_PREFIX && !path.startsWith(`${API_PREFIX}/`)) return next();
      api.handle(req, res);
    });
    server.httpServer?.once('close', () => api.dispose());
  };
  return {
    name: 'documentos-pdf-api',
    configureServer(server) {
      install(server);
    },
    configurePreviewServer(server) {
      install(server);
    },
  };
}
