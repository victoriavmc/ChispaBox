/*
 * Contrato de la API de descargas de YouTube (server/youtube) con la interfaz (src/).
 * Solo tipos y constantes: no contiene lógica de red ni del sistema de archivos.
 */

export type VideoContainer = 'mp4' | 'webm' | 'mkv';
export type AudioFormat = 'mp3' | 'm4a' | 'wav' | 'flac';
export type JobType = 'video' | 'audio' | 'lote';

/** Un video dentro de una lista o de un conjunto de enlaces. */
export interface BatchItem {
  videoId: string;
  url: string;
  titulo: string;
  canal: string | null;
  duracionSegundos: number | null;
}

export interface BatchAnalysis {
  loteId: string;
  /** Nombre de la playlist, si la lista viene de una playlist con nombre. */
  playlistTitulo: string | null;
  /** Si la lista viene de una playlist (con o sin nombre). */
  esPlaylist: boolean;
  items: BatchItem[];
  /** Videos que no entraron por superar el máximo de la lista. */
  omitidos: number;
  /** Líneas que no se pudieron usar, con su número. */
  errores: string[];
}

export interface BatchJobRequest {
  loteId: string;
  /** Subconjunto de videos a descargar (IDs del análisis). Si se omite, se descargan todos. */
  seleccion?: string[];
  tipo: 'video' | 'audio';
  /** Video: contenedor y altura máxima; cada video usa la mejor calidad disponible hasta ese límite. */
  contenedor?: VideoContainer;
  altura?: number;
  /** Audio: formato y bitrate máximo; cada video nunca supera el bitrate de su origen. */
  formato?: AudioFormat;
  kbps?: number;
  /** Nombre del ZIP sin extensión. */
  nombre?: string;
}

export const VIDEO_CONTAINERS: readonly VideoContainer[] = ['mp4', 'webm', 'mkv'];
export const AUDIO_FORMATS: readonly AudioFormat[] = ['mp3', 'm4a', 'wav', 'flac'];

/** Bitrates de audio con pérdida que se ofrecen; solo se muestran los que no superan el origen. */
export const AUDIO_BITRATE_STEPS: readonly number[] = [320, 256, 192, 128, 96];

export interface VideoOption {
  contenedor: VideoContainer;
  /** Alturas en píxeles realmente disponibles para este contenedor, de mayor a menor. */
  alturas: number[];
  /** Tamaño aproximado en bytes por altura (clave: altura en texto); null si no se puede estimar. */
  tamanos: Record<string, number | null>;
}

export interface AudioOption {
  formato: AudioFormat;
  /** Bitrates ofrecibles (vacío en WAV y FLAC, que no usan un bitrate elegible). */
  kbps: number[];
  /** Tamaño aproximado en bytes por bitrate; clave "0" cuando el formato no usa bitrate. */
  tamanos: Record<string, number | null>;
}

export interface AnalysisResult {
  videoId: string;
  url: string;
  titulo: string;
  /** Duración en segundos; null si YouTube no la informa. */
  duracionSegundos: number | null;
  /** Artista solo si YouTube lo informa como metadato de la pista. Nunca se toma del canal. */
  artistaSugerido: string | null;
  /** Título de la pista si YouTube lo informa; si no, el título del video. */
  tituloSugerido: string;
  /** Nombre del canal: solo informativo, no se usa como artista. */
  canal: string | null;
  /** Bitrate de la mejor fuente de audio disponible (kbps), o null si no se informa. */
  fuenteAudioKbps: number | null;
  video: VideoOption[];
  audio: AudioOption[];
}

export interface AnalysisResponse {
  analisis: AnalysisResult;
}

export interface StatusResponse {
  habilitado: boolean;
  limites: {
    duracionMaximaMinutos: number;
    tamanoMaximoMb: number;
    trabajosSimultaneos: number;
  } | null;
}

export type JobState = 'en_cola' | 'descargando' | 'procesando' | 'listo' | 'error' | 'cancelado';

export interface JobRequest {
  tipo: JobType;
  videoId: string;
  /** Video: contenedor y altura elegidos de entre los disponibles. */
  contenedor?: VideoContainer;
  altura?: number;
  /** Audio: formato y bitrate (si el formato lo admite). */
  formato?: AudioFormat;
  kbps?: number;
  /** Nombre base sin extensión. En audio se calcula con artista y título. */
  nombre: string;
  artista?: string;
  titulo?: string;
}

export interface JobCreated {
  id: string;
  nombreArchivo: string;
}

export interface JobStatus {
  id: string;
  estado: JobState;
  /** 0–100 durante la descarga y la conversión; null cuando no se puede medir. */
  progreso: number | null;
  mensaje: string;
  nombreArchivo: string;
  /** Solo presente cuando el archivo está listo y verificado. */
  bytes: number | null;
  error: string | null;
  /** Lotes: videos omitidos y el motivo de cada uno (vacío en descargas individuales). */
  avisos: string[];
}

export interface ApiErrorBody {
  error: string;
}
