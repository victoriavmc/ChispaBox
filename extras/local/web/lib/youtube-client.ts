/*
 * Cliente del API de descargas de YouTube (server/youtube) para las páginas de video y música.
 * No contiene reglas de seguridad: el servidor valida todo. Aquí solo se llama al API,
 * se sigue el progreso, se guarda el archivo en la computadora y se formatean datos.
 */
import type {
  AnalysisResponse,
  AnalysisResult,
  ApiErrorBody,
  BatchAnalysis,
  BatchJobRequest,
  JobCreated,
  JobRequest,
  JobStatus,
  StatusResponse,
} from '../shared/youtube-types';

const BASE = '/api/youtube';
const POLL_MS = 800;
const UNAVAILABLE = 'Esta herramienta no está disponible en este entorno.';

export class YoutubeApiError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'YoutubeApiError';
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers: HeadersInit | undefined = init.body ? { 'Content-Type': 'application/json' } : undefined;
  let response: Response;
  try {
    response = await fetch(`${BASE}${path}`, {
      ...init,
      cache: 'no-store',
      credentials: 'same-origin',
      ...(headers ? { headers } : {}),
    });
  } catch {
    throw new YoutubeApiError('No se pudo conectar con el servidor. Revisá la conexión e intentá de nuevo.');
  }

  const text = await response.text();
  let body: unknown = null;
  try {
    body = text ? (JSON.parse(text) as unknown) : null;
  } catch {
    body = null;
  }

  if (!response.ok) {
    const message = (body as Partial<ApiErrorBody> | null)?.error;
    if (response.status === 404 && !message) throw new YoutubeApiError(UNAVAILABLE);
    throw new YoutubeApiError(message ?? 'Ocurrió un error inesperado.');
  }
  return body as T;
}

export function getStatus(): Promise<StatusResponse> {
  return request<StatusResponse>('/estado');
}

export async function analyze(url: string): Promise<AnalysisResult> {
  const body = await request<AnalysisResponse>('/analizar', { method: 'POST', body: JSON.stringify({ url }) });
  return body.analisis;
}

export function createJob(job: JobRequest): Promise<JobCreated> {
  return request<JobCreated>('/trabajos', { method: 'POST', body: JSON.stringify(job) });
}

export function jobStatus(id: string): Promise<JobStatus> {
  return request<JobStatus>(`/trabajos/${encodeURIComponent(id)}`);
}

export async function cancelJob(id: string): Promise<void> {
  await request<unknown>(`/trabajos/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

/** Analiza una playlist y/o varios enlaces (uno por línea). */
export async function analyzeBatch(texto: string): Promise<BatchAnalysis> {
  const body = await request<{ analisis: BatchAnalysis }>('/lote/analizar', {
    method: 'POST',
    body: JSON.stringify({ texto }),
  });
  return body.analisis;
}

export function createBatchJob(job: BatchJobRequest): Promise<JobCreated> {
  return request<JobCreated>('/lote/trabajos', { method: 'POST', body: JSON.stringify(job) });
}

export function fileUrl(id: string): string {
  return `${BASE}/trabajos/${encodeURIComponent(id)}/archivo`;
}

/** Destino elegido por el usuario en el diálogo «Guardar como». */
export interface SaveTarget {
  writable: WritableStream<Uint8Array>;
  /** Cierra el destino sin escribir nada (el archivo temporal del navegador se descarta). */
  abort(): Promise<void>;
}

/** Resultado de elegir dónde guardar antes de empezar la descarga. */
export type PickOutcome =
  | { kind: 'destino'; target: SaveTarget }
  | { kind: 'navegador'; motivo: string } // sin diálogo de carpetas: descarga normal del navegador
  | { kind: 'error'; mensaje: string } // eligió carpeta pero el navegador no permite escribir ahí
  | { kind: 'cancelado' };

interface FileSystemWritableLike {
  write(data: Uint8Array): Promise<void>;
  close(): Promise<void>;
  abort(): Promise<void>;
}

interface FileSystemHandleLike {
  createWritable(): Promise<FileSystemWritableLike>;
}

type ShowSaveFilePicker = (options: unknown) => Promise<FileSystemHandleLike>;

/**
 * Abre el diálogo «Guardar como». DEBE llamarse de forma sincrónica desde el clic del usuario
 * (antes de cualquier await): los navegadores bloquean el diálogo fuera de un gesto del usuario.
 * Solo Chromium (Chrome, Edge) lo ofrece; en otros navegadores se devuelve 'navegador'.
 */
export function pickSaveTarget(suggestedName: string): Promise<PickOutcome> {
  const picker = (window as unknown as { showSaveFilePicker?: ShowSaveFilePicker }).showSaveFilePicker;
  if (typeof picker !== 'function') {
    return Promise.resolve({ kind: 'navegador', motivo: 'Tu navegador no ofrece el diálogo para elegir carpeta.' });
  }

  const ext = suggestedName.split('.').pop()?.toLowerCase() ?? '';
  const mime = MIME_BY_EXT[ext] ?? 'application/octet-stream';
  const pending = picker({
    suggestedName,
    types: [{ description: 'Archivo', accept: { [mime]: [`.${ext}`] } }],
  });

  return pending.then(
    async (handle): Promise<PickOutcome> => {
      let writable: FileSystemWritableLike;
      try {
        writable = await handle.createWritable();
      } catch {
        // Ya se eligió carpeta y el navegador no permite escribir ahí. No se abre otra descarga
        // (provocaría un segundo diálogo): se informa y el usuario puede volver a pulsar Descargar.
        return {
          kind: 'error',
          mensaje: 'El navegador no permitió escribir en la carpeta que elegiste. Pulsá «Descargar video» para intentarlo de nuevo.',
        };
      }
      const stream = new WritableStream<Uint8Array>({
        write: (chunk) => writable.write(chunk),
        close: () => writable.close(),
        abort: () => writable.abort(),
      });
      return {
        kind: 'destino',
        target: { writable: stream, abort: () => writable.abort() },
      };
    },
    (err: unknown) => {
      if (err instanceof DOMException && err.name === 'AbortError') return { kind: 'cancelado' } as PickOutcome;
      throw err;
    },
  );
}

/** Escribe el archivo final del servidor en el destino elegido. Lanza si no se puede leer o escribir. */
export async function writeToTarget(id: string, target: SaveTarget): Promise<void> {
  const response = await fetch(fileUrl(id), { cache: 'no-store', credentials: 'same-origin' });
  if (!response.ok || !response.body) {
    await target.abort();
    throw new YoutubeApiError('No se pudo obtener el archivo desde el servidor.');
  }
  try {
    await response.body.pipeTo(target.writable);
  } catch {
    throw new YoutubeApiError('No se pudo escribir el archivo en la carpeta elegida.');
  }
}

/** Sin diálogo del navegador: descarga normal, que va a su carpeta de descargas. */
export function downloadWithBrowser(id: string, name: string): void {
  const a = document.createElement('a');
  a.href = fileUrl(id);
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
}

/** Tipos MIME para el diálogo «Guardar como». */
const MIME_BY_EXT: Record<string, string> = {
  mp4: 'video/mp4',
  webm: 'video/webm',
  mkv: 'video/x-matroska',
  mp3: 'audio/mpeg',
  m4a: 'audio/mp4',
  wav: 'audio/wav',
  flac: 'audio/flac',
  zip: 'application/zip',
};

/** Formato legible de bytes para estimaciones y resultados ("~45 MB"). */
export function formatSize(bytes: number | null): string {
  if (bytes === null || !Number.isFinite(bytes) || bytes <= 0) return 'tamaño no disponible';
  const mb = bytes / (1024 * 1024);
  if (mb < 1) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  if (mb < 1024) return `${mb < 10 ? mb.toFixed(1) : Math.round(mb)} MB`;
  return `${(mb / 1024).toFixed(2)} GB`;
}

export interface JobWatcher {
  /** Deja de consultar el estado (el trabajo sigue en el servidor hasta que se cancele o venza). */
  stop(): void;
}

/**
 * Consulta el estado de un trabajo hasta que termina (listo, error o cancelado).
 * Llama a onUpdate en cada respuesta y a onDone al final.
 */
export function watchJob(
  id: string,
  onUpdate: (status: JobStatus) => void,
  onDone: (status: JobStatus) => void,
  onFailure: (message: string) => void,
): JobWatcher {
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let failures = 0;

  const tick = async (): Promise<void> => {
    if (stopped) return;
    try {
      const status = await jobStatus(id);
      failures = 0;
      if (stopped) return;
      if (status.estado === 'listo' || status.estado === 'error' || status.estado === 'cancelado') {
        stopped = true;
        onDone(status);
        return;
      }
      onUpdate(status);
    } catch (err) {
      failures += 1;
      // Tolera fallos puntuales de red; tras varios seguidos se informa y se detiene.
      if (failures >= 4) {
        stopped = true;
        onFailure(err instanceof Error ? err.message : 'Se perdió la conexión con el servidor.');
        return;
      }
    }
    if (!stopped) timer = setTimeout(() => void tick(), POLL_MS);
  };

  void tick();
  return {
    stop() {
      stopped = true;
      if (timer !== undefined) clearTimeout(timer);
    },
  };
}

/** Duración legible: m:ss o h:mm:ss. */
export function formatDuration(seconds: number | null): string {
  if (seconds === null || !Number.isFinite(seconds)) return 'No informada';
  const total = Math.round(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number): string => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}
