/*
 * Método Sharp de «Mejorar calidad»: endpoint local que usa libvips (vía Sharp).
 *
 * Existe solo en el servidor de desarrollo y de vista previa de Vite (npm run dev / preview).
 * La imagen de producción (Nginx estático) no incluye este endpoint: la interfaz lo detecta
 * y deshabilita el método Sharp.
 *
 * Controles (RG-07): solo acepta peticiones desde 127.0.0.1 / localhost con el mismo origen,
 * rechaza cuerpos más grandes que el límite, valida parámetros con listas blancas, limita a
 * un procesamiento simultáneo y responde con tiempo máximo. No escribe archivos en disco
 * y no registra contenido de imágenes.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Plugin, ViteDevServer } from 'vite';
import sharp, { type Sharp } from 'sharp';
import { IMAGE_LIMITS, TOOL_LIMITS } from '../src/shared/image-limits.ts';
import { sniffInputFormat, type OutputFormat } from '../src/shared/image-format.ts';

const STATUS_PATH = '/api/imagen/estado';
const ENHANCE_PATH = '/api/imagen/mejorar';
const LOCAL_HOST = /^(127\.0\.0\.1|localhost):\d{2,5}$/;
const INTENSITIES = ['suave', 'media', 'intensa'] as const;
type SharpIntensity = (typeof INTENSITIES)[number];
const FORMATS: readonly OutputFormat[] = ['jpeg', 'png', 'webp'];
const MIME: Record<OutputFormat, string> = {
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  ico: 'application/octet-stream',
};

// Un solo hilo de libvips y sin caché: menos memoria y resultados predecibles.
sharp.concurrency(1);
sharp.cache(false);

let busy = false;

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Content-Length': Buffer.byteLength(text),
  });
  res.end(text);
}

/** Acepta solo peticiones del propio equipo y del mismo origen (protección frente a sitios ajenos). */
function isLocalSameOrigin(req: IncomingMessage): boolean {
  const host = req.headers.host ?? '';
  if (!LOCAL_HOST.test(host)) return false;
  const origin = req.headers.origin;
  if (origin !== undefined && origin !== `http://${host}`) return false;
  const site = req.headers['sec-fetch-site'];
  if (site !== undefined && site !== 'same-origin' && site !== 'none') return false;
  return true;
}

function readBody(req: IncomingMessage, max: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const declared = Number(req.headers['content-length'] ?? 0);
    if (declared > max) {
      reject(new HttpError(413, 'La imagen supera el peso máximo permitido.'));
      return;
    }
    const chunks: Buffer[] = [];
    let total = 0;
    req.on('data', (chunk: Buffer) => {
      total += chunk.length;
      if (total > max) {
        reject(new HttpError(413, 'La imagen supera el peso máximo permitido.'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', () => reject(new HttpError(400, 'No se pudo leer la imagen enviada.')));
  });
}

function intParam(value: string | null, min: number, max: number, fallback: number | null): number | null {
  if (value === null || value === '') return fallback;
  if (!/^\d+$/.test(value)) throw new HttpError(400, 'Parámetro numérico no válido.');
  const n = Number(value);
  if (n < min || n > max) throw new HttpError(400, `El valor ${n} está fuera del rango permitido (${min}–${max}).`);
  return n;
}

/** Operaciones de cada intensidad: equivalentes a las del método Canvas, con libvips. */
function applyIntensity(img: Sharp, intensity: SharpIntensity): Sharp {
  switch (intensity) {
    case 'suave':
      return img
        .modulate({ saturation: 1.04 })
        .linear(1.03, 128 * (1 - 1.03))
        .sharpen({ sigma: 0.5, m1: 0.5, m2: 0.5 });
    case 'media':
      return img
        .normalise({ lower: 1, upper: 99 })
        .modulate({ brightness: 1.02, saturation: 1.1 })
        .linear(1.1, 128 * (1 - 1.1))
        .sharpen({ sigma: 0.8, m1: 0.8, m2: 1.2 });
    case 'intensa':
      return img
        .normalise({ lower: 0.5, upper: 99.5 })
        .blur(0.3) // suavizado leve de ruido antes de enfocar
        .modulate({ brightness: 1.04, saturation: 1.2 })
        .linear(1.2, 128 * (1 - 1.2))
        .sharpen({ sigma: 1.2, m1: 1, m2: 2 });
  }
}

async function enhance(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (busy) {
    throw new HttpError(429, 'Ya hay una mejora en curso. Esperá a que termine.');
  }
  // Se ocupa el motor antes de leer el cuerpo, para que dos peticiones no pasen a la vez.
  busy = true;
  let started = false;
  try {
    await enhanceLocked(req, res, () => {
      started = true;
    });
  } finally {
    if (!started) busy = false;
  }
}

async function enhanceLocked(req: IncomingMessage, res: ServerResponse, markStarted: () => void): Promise<void> {
  const url = new URL(req.url ?? '/', 'http://127.0.0.1');
  const params = url.searchParams;
  const intensity = params.get('intensidad') as SharpIntensity | null;
  const format = params.get('formato') as OutputFormat | null;
  if (!intensity || !INTENSITIES.includes(intensity)) throw new HttpError(400, 'Intensidad no válida.');
  if (!format || !FORMATS.includes(format)) throw new HttpError(400, 'Formato de salida no admitido.');
  const quality = intParam(params.get('calidad'), 1, 100, 90) ?? 90;
  const width = intParam(params.get('ancho'), 1, IMAGE_LIMITS.maxSide, null);
  const height = intParam(params.get('alto'), 1, IMAGE_LIMITS.maxSide, null);

  const input = await readBody(req, IMAGE_LIMITS.maxBytes);
  if (input.length < IMAGE_LIMITS.minBytes) throw new HttpError(400, 'El archivo está vacío.');
  const inputFormat = sniffInputFormat(input.subarray(0, 16));
  if (!inputFormat) throw new HttpError(415, 'El contenido no es JPG, PNG o WebP válido.');

  const maxPixels = TOOL_LIMITS.mejorarSharp.maxPixels;
  const work = (async () => {
    const meta = await sharp(input, { limitInputPixels: maxPixels, failOn: 'error' }).metadata();
    const w = meta.width ?? 0;
    const h = meta.height ?? 0;
    if (w < 1 || h < 1) throw new HttpError(422, 'No se pudieron leer las dimensiones de la imagen.');
    if (w > IMAGE_LIMITS.maxSide || h > IMAGE_LIMITS.maxSide) {
      throw new HttpError(422, `La imagen supera el lado máximo de ${IMAGE_LIMITS.maxSide} px.`);
    }
    if (w * h > maxPixels) throw new HttpError(422, 'La imagen supera el límite de píxeles del método Sharp.');

    // rotate() aplica la orientación EXIF; la salida no conserva metadatos (RG-08).
    let img = applyIntensity(sharp(input, { limitInputPixels: maxPixels, failOn: 'error', sequentialRead: true }).rotate(), intensity);
    if (width !== null || height !== null) {
      img = img.resize({ width: width ?? undefined, height: height ?? undefined, fit: 'fill', kernel: 'lanczos3' });
    }
    if (format === 'jpeg') img = img.jpeg({ quality, mozjpeg: false });
    else if (format === 'webp') img = img.webp({ quality });
    else img = img.png({ compressionLevel: 9 });
    return img.toBuffer({ resolveWithObject: true });
  })();

  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new HttpError(504, 'Se superó el tiempo máximo de procesamiento.')), IMAGE_LIMITS.maxProcessingMs);
  });
  // Si vence el tiempo, la respuesta sale con error pero el trabajo sigue ocupando el motor hasta terminar.
  markStarted();
  work
    .finally(() => {
      busy = false;
    })
    .catch(() => undefined);

  try {
    const { data, info } = await Promise.race([work, timeout]);
    res.writeHead(200, {
      'Content-Type': MIME[format],
      'Content-Length': data.length,
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'X-Imagen-Dimensiones': `${info.width}x${info.height}`,
    });
    res.end(data);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function install(middlewares: ViteDevServer['middlewares']): void {
  middlewares.use((req, res, next) => {
    const path = (req.url ?? '').split('?')[0];
    if (path !== STATUS_PATH && path !== ENHANCE_PATH) return next();

    if (!isLocalSameOrigin(req)) {
      sendJson(res, 403, { error: 'Solicitud rechazada: solo desde este equipo.' });
      return;
    }
    if (path === STATUS_PATH) {
      if (req.method !== 'GET') return sendJson(res, 405, { error: 'Método no permitido.' });
      sendJson(res, 200, {
        disponible: true,
        limites: {
          maxBytes: IMAGE_LIMITS.maxBytes,
          maxSide: IMAGE_LIMITS.maxSide,
          maxPixels: TOOL_LIMITS.mejorarSharp.maxPixels,
          maxProcessingMs: IMAGE_LIMITS.maxProcessingMs,
        },
      });
      return;
    }
    if (req.method !== 'POST') return sendJson(res, 405, { error: 'Método no permitido.' });

    enhance(req, res).catch((err: unknown) => {
      if (res.headersSent) {
        res.destroy();
        return;
      }
      if (err instanceof HttpError) {
        sendJson(res, err.status, { error: err.message });
        return;
      }
      // El detalle técnico no se envía al navegador ni se registra con contenido de la imagen.
      console.error('[mejorar-sharp] error interno:', err instanceof Error ? err.name : 'desconocido');
      sendJson(res, 500, { error: 'No se pudo mejorar la imagen.' });
    });
  });
}

/** Plugin de Vite: registra el endpoint en el servidor de desarrollo y en la vista previa. */
export function imageEnhanceApi(): Plugin {
  return {
    name: 'image-enhance-api',
    configureServer(server) {
      install(server.middlewares);
    },
    configurePreviewServer(server) {
      install(server.middlewares);
    },
  };
}
