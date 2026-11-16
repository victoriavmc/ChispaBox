/*
 * Configuración de «Documentos a PDF», leída solo de variables de entorno (RG-03, sección 10).
 * Ninguna ruta de Windows ni host/puerto está fijado en el código.
 *
 * - DOCUMENTOS_PDF_ENABLED: true/false. Por defecto, habilitado fuera de producción.
 *   Un valor no reconocido se trata como false (cerrado por seguridad).
 * - SOFFICE_PATH: ruta al ejecutable de LibreOffice (por defecto «soffice» del PATH).
 *   Usar la consola (soffice.com) en Windows si el ejecutable gráfico no imprime --version.
 * - DOCUMENTOS_TEMP_DIR: carpeta de trabajo temporal. Por defecto, la temporal del sistema.
 * - DOCUMENTOS_MAX_MB, DOCUMENTOS_TIMEOUT_SEG, DOCUMENTOS_MAX_CONCURRENT: límites de recursos.
 */
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DOCUMENTOS_LIMITS } from '../../src/shared/documentos-limits.ts';

export type Env = Record<string, string | undefined>;

export interface DocumentosConfig {
  enabled: boolean;
  sofficePath: string;
  tempDir: string;
  maxBytes: number;
  timeoutMs: number;
  maxConcurrent: number;
  maxPages: number;
  warnings: string[];
}

function parseBoolean(raw: string | undefined, fallback: boolean, warnings: string[]): boolean {
  if (raw === undefined || raw.trim() === '') return fallback;
  const value = raw.trim().toLowerCase();
  if (value === 'true' || value === '1') return true;
  if (value === 'false' || value === '0') return false;
  warnings.push(`DOCUMENTOS_PDF_ENABLED="${raw}" no es válido; se usa "false" (cerrado por seguridad).`);
  return false;
}

function parseIntegerInRange(raw: string | undefined, fallback: number, min: number, max: number, name: string, warnings: string[]): number {
  if (raw === undefined || raw.trim() === '') return fallback;
  const value = Number(raw.trim());
  if (!Number.isInteger(value) || value < min || value > max) {
    warnings.push(`${name}="${raw}" fuera de rango (${min}–${max}); se usa ${fallback}.`);
    return fallback;
  }
  return value;
}

export function loadDocumentosConfig(env: Env): DocumentosConfig {
  const warnings: string[] = [];
  const isProduction = env.NODE_ENV === 'production';
  const sofficePath = env.SOFFICE_PATH?.trim() ? env.SOFFICE_PATH.trim() : 'soffice';
  const tempRaw = env.DOCUMENTOS_TEMP_DIR?.trim();

  return {
    enabled: parseBoolean(env.DOCUMENTOS_PDF_ENABLED, !isProduction, warnings),
    sofficePath,
    tempDir: tempRaw ? tempRaw : join(tmpdir(), 'chispabox-documentos'),
    maxBytes:
      parseIntegerInRange(env.DOCUMENTOS_MAX_MB, DOCUMENTOS_LIMITS.officeMaxBytes / (1024 * 1024), 1, 100, 'DOCUMENTOS_MAX_MB', warnings) *
      1024 *
      1024,
    timeoutMs:
      parseIntegerInRange(env.DOCUMENTOS_TIMEOUT_SEG, DOCUMENTOS_LIMITS.officeTimeoutMs / 1000, 10, 600, 'DOCUMENTOS_TIMEOUT_SEG', warnings) *
      1000,
    maxConcurrent: parseIntegerInRange(env.DOCUMENTOS_MAX_CONCURRENT, DOCUMENTOS_LIMITS.officeMaxConcurrent, 1, 4, 'DOCUMENTOS_MAX_CONCURRENT', warnings),
    maxPages: DOCUMENTOS_LIMITS.officeMaxPages,
    warnings,
  };
}
