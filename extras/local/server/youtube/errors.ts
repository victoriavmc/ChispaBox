/*
 * Errores del módulo de YouTube. El mensaje es el único texto que llega al navegador:
 * nunca incluye rutas del sistema, salida de yt-dlp ni de FFmpeg.
 */

export class YoutubeError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'YoutubeError';
    this.status = status;
  }
}

/**
 * Traduce la salida de yt-dlp a un mensaje claro en español.
 * Solo se usan patrones conocidos; cualquier otro caso recibe un mensaje genérico.
 */
export function describeYtDlpFailure(stderr: string, timedOut: boolean): string {
  if (timedOut) return 'Se superó el tiempo máximo de descarga. Probá de nuevo o con una calidad menor.';
  const text = stderr.toLowerCase();
  if (text.includes('file is larger than max-filesize')) return 'El archivo supera el tamaño máximo permitido.';
  if (/video unavailable|private video|this video has been removed|no longer available/.test(text)) {
    return 'El video no está disponible o es privado.';
  }
  if (/sign in to confirm|age-restricted|confirm your age|members-only|members only|requires authentication/.test(text)) {
    return 'Este video requiere iniciar sesión o tiene restricciones de edad. No se admite.';
  }
  if (/drm|widevine|protected content/.test(text)) return 'El contenido está protegido por DRM y no se puede descargar.';
  if (/not available in your country|blocked it in your country|geo.?restricted/.test(text)) {
    return 'El video no está disponible desde el servidor donde se ejecuta la aplicación.';
  }
  if (/is_live|this live event|live stream|premieres in|upcoming/.test(text)) {
    return 'Las transmisiones en vivo y los estrenos pendientes no se admiten.';
  }
  if (/http error 429|too many requests/.test(text)) {
    return 'YouTube limitó las solicitudes por ahora. Esperá unos minutos e intentá de nuevo.';
  }
  if (/playlist type is unviewable|mix/.test(text)) {
    return 'Esta lista automática (Mix de YouTube) no se puede leer. Usá una playlist normal.';
  }
  if (/playlist does not exist|the playlist (is )?private|private playlist/.test(text)) {
    return 'La playlist no existe o es privada.';
  }
  if (/unsupported url|no suitable extractor/.test(text)) return 'Enlace no compatible con el descargador.';
  if (/unable to download|timed out|connection|temporary failure|name or service not known|getaddrinfo|network/.test(text)) {
    return 'Error de conexión con YouTube. Revisá la red e intentá de nuevo.';
  }
  return 'No se pudo completar la descarga.';
}
