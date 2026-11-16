/*
 * Ejecución aislada de LibreOffice para convertir documentos a PDF (RG-06, sección 9).
 *
 * Controles:
 * - Se ejecuta con execFile/spawn y argumentos fijos. Nunca se usa shell: true ni se
 *   concatenan entradas del usuario en una cadena de comando.
 * - Perfil de usuario temporal y propio de cada trabajo (-env:UserInstallation), que se borra al terminar.
 * - Macros desactivadas (nivel de seguridad máximo) y vínculos externos sin actualizar.
 * - Entorno mínimo: no se hereda el entorno del proceso padre (solo lo imprescindible en Windows).
 * - Tiempo máximo; al cumplirse, o al cancelar, se termina todo el árbol de procesos.
 * - Directorio de trabajo único; el nombre del archivo de entrada es fijo («entrada.<ext>»),
 *   nunca el nombre que trae el usuario (evita rutas maliciosas y colisiones).
 *
 * Nota: el modo headless NO es por sí mismo un entorno seguro. Por eso se combinan estas
 * medidas con validación previa y, antes de un despliegue público, con un contenedor.
 */
import { execFile, spawn, type ChildProcess } from 'node:child_process';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

export type PdfFilter = 'writer_pdf_Export' | 'calc_pdf_Export' | 'impress_pdf_Export';

export type SofficeErrorCode = 'missing' | 'timeout' | 'cancelled' | 'failed' | 'no-output';

export class SofficeError extends Error {
  readonly code: SofficeErrorCode;

  constructor(code: SofficeErrorCode, message: string) {
    super(message);
    this.code = code;
  }
}

/** Perfil mínimo de LibreOffice: desactiva macros, vínculos externos, actualizaciones y guardado automático. */
const REGISTRY = `<?xml version="1.0" encoding="UTF-8"?>
<oor:items xmlns:oor="http://openoffice.org/2001/registry" xmlns:xs="http://www.w3.org/2001/XMLSchema" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
<item oor:path="/org.openoffice.Office.Common/Security/Scripting"><prop oor:name="MacroSecurityLevel" oor:op="fuse"><value>3</value></prop></item>
<item oor:path="/org.openoffice.Office.Common/Security/Scripting"><prop oor:name="DisableMacrosExecution" oor:op="fuse"><value>true</value></prop></item>
<item oor:path="/org.openoffice.Office.Writer/Content/Update"><prop oor:name="Link" oor:op="fuse"><value>2</value></prop></item>
<item oor:path="/org.openoffice.Office.Calc/Content/Update"><prop oor:name="Link" oor:op="fuse"><value>2</value></prop></item>
<item oor:path="/org.openoffice.Office.Impress/Content/Update"><prop oor:name="Link" oor:op="fuse"><value>2</value></prop></item>
<item oor:path="/org.openoffice.Office.Recovery/AutoSave"><prop oor:name="Enabled" oor:op="fuse"><value>false</value></prop></item>
<item oor:path="/org.openoffice.Office.Common/Misc"><prop oor:name="ShowTipOfTheDay" oor:op="fuse"><value>false</value></prop></item>
</oor:items>
`;

/** Entorno mínimo del proceso hijo. No se hereda el entorno completo del servidor. */
function childEnv(workDir: string): NodeJS.ProcessEnv {
  const keep = ['SystemRoot', 'SYSTEMROOT', 'windir', 'PATH'];
  const env: NodeJS.ProcessEnv = {};
  for (const key of keep) {
    if (process.env[key] !== undefined) env[key] = process.env[key];
  }
  env.TEMP = workDir;
  env.TMP = workDir;
  env.TMPDIR = workDir;
  env.HOME = workDir;
  env.USERPROFILE = workDir;
  env.LANG = 'es_ES.UTF-8';
  return env;
}

/** Crea el perfil temporal de LibreOffice con la configuración restrictiva. */
export async function writeProfile(profileDir: string): Promise<string> {
  const userDir = join(profileDir, 'user');
  await mkdir(userDir, { recursive: true });
  await writeFile(join(userDir, 'registrymodifications.xcu'), REGISTRY, 'utf8');
  return pathToFileURL(profileDir).href;
}

/** Termina el proceso y sus descendientes. En Windows se usa taskkill /T (árbol de procesos). */
export function killTree(child: ChildProcess): void {
  if (child.pid === undefined || child.exitCode !== null) return;
  if (process.platform === 'win32') {
    execFile('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true }, () => undefined);
  } else {
    child.kill('SIGKILL');
  }
}

/** Ejecuta LibreOffice con argumentos fijos y devuelve la salida de stdout/stderr (acotada). */
function run(
  command: string,
  args: string[],
  options: { cwd: string; env: NodeJS.ProcessEnv; timeoutMs: number; signal?: AbortSignal },
): Promise<{ code: number | null; output: string; timedOut: boolean; cancelled: boolean }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env,
      shell: false,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    const collect = (chunk: Buffer) => {
      if (output.length < 4000) output += chunk.toString('utf8');
    };
    child.stdout?.on('data', collect);
    child.stderr?.on('data', collect);

    let timedOut = false;
    let cancelled = false;
    const timer = setTimeout(() => {
      timedOut = true;
      killTree(child);
    }, options.timeoutMs);
    const onAbort = () => {
      cancelled = true;
      killTree(child);
    };
    options.signal?.addEventListener('abort', onAbort, { once: true });
    if (options.signal?.aborted) onAbort();

    child.once('error', (error) => {
      clearTimeout(timer);
      options.signal?.removeEventListener('abort', onAbort);
      reject(error);
    });
    child.once('close', (code) => {
      clearTimeout(timer);
      options.signal?.removeEventListener('abort', onAbort);
      resolve({ code, output, timedOut, cancelled });
    });
  });
}

/** Consulta la versión instalada. Devuelve null si LibreOffice no está disponible. */
export async function sofficeVersion(command: string, workDir: string): Promise<string | null> {
  await mkdir(workDir, { recursive: true });
  return new Promise((resolve) => {
    execFile(
      command,
      ['--version'],
      { cwd: workDir, env: childEnv(workDir), windowsHide: true, timeout: 30_000, shell: false },
      (error, stdout) => {
        if (error) return resolve(null);
        const line = String(stdout).split(/\r?\n/).find((l) => /LibreOffice/i.test(l));
        resolve(line ? line.trim().slice(0, 120) : 'LibreOffice (versión no reconocida)');
      },
    );
  });
}

export interface ConvertOptions {
  command: string;
  /** Directorio propio del trabajo (ya creado). Se borra fuera de esta función. */
  workDir: string;
  inputName: string;
  inputBytes: Buffer;
  /** Conversión a PDF: filtro de exportación (writer_pdf_Export, etc.). */
  filter?: PdfFilter;
  /** Conversión genérica (p. ej. PDF a Word): valor de --convert-to, por ejemplo «docx:MS Word 2007 XML». */
  convertTo?: string;
  /** Filtro de importación explícito (p. ej. writer_pdf_import para leer un PDF). */
  infilter?: string;
  /** Extensión del archivo de salida. Por defecto, «pdf». */
  outputExt?: string;
  timeoutMs: number;
  signal?: AbortSignal;
}

/** Convierte un documento con LibreOffice y devuelve los bytes del archivo generado (PDF por defecto). */
export async function convertToPdf(options: ConvertOptions): Promise<Buffer> {
  const inputPath = join(options.workDir, options.inputName);
  const outDir = join(options.workDir, 'out');
  const profileDir = join(options.workDir, 'profile');
  await mkdir(outDir, { recursive: true });
  const profileUrl = await writeProfile(profileDir);
  await writeFile(inputPath, options.inputBytes);

  const args = [
    `-env:UserInstallation=${profileUrl}`,
    '--headless',
    '--invisible',
    '--norestore',
    '--nolockcheck',
    '--nodefault',
    '--nologo',
    '--nofirststartwizard',
    ...(options.infilter ? [`--infilter=${options.infilter}`] : []),
    '--convert-to',
    options.convertTo ?? `pdf:${options.filter}`,
    '--outdir',
    outDir,
    inputPath,
  ];

  let result;
  try {
    result = await run(options.command, args, {
      cwd: options.workDir,
      env: childEnv(options.workDir),
      timeoutMs: options.timeoutMs,
      signal: options.signal,
    });
  } catch {
    throw new SofficeError('missing', 'No se encontró LibreOffice en el servidor.');
  }
  if (result.cancelled) throw new SofficeError('cancelled', 'La conversión fue cancelada.');
  if (result.timedOut) throw new SofficeError('timeout', 'La conversión superó el tiempo máximo permitido.');

  const baseName = options.inputName.replace(/\.[^.]+$/, '');
  const outPath = join(outDir, `${baseName}.${options.outputExt ?? 'pdf'}`);
  const info = await stat(outPath).catch(() => null);
  if (!info || !info.isFile()) {
    throw new SofficeError(
      'no-output',
      result.code === 0
        ? 'LibreOffice terminó sin generar el archivo.'
        : 'No se pudo convertir el documento: puede estar dañado o protegido con contraseña.',
    );
  }
  return readFile(outPath);
}
