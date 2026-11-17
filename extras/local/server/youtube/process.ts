/*
 * Ejecución controlada de procesos externos (yt-dlp, FFmpeg, ffprobe).
 *
 * - Sin shell: el programa y sus argumentos van como lista (spawn con shell: false).
 * - Sin argumentos construidos a partir de texto libre del usuario: lo valida el llamador.
 * - Tiempo máximo y cancelación que terminan todo el árbol de procesos (yt-dlp llama a FFmpeg).
 * - Salida acotada en memoria; las líneas se entregan a medida que llegan (progreso).
 */
import { execFile, spawn, type ChildProcess } from 'node:child_process';

export interface ProcessResult {
  code: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  cancelled: boolean;
  /** Error al lanzar el programa (por ejemplo, no encontrado). Nunca incluye rutas completas. */
  spawnError: string | null;
}

export interface ProcessOptions {
  command: string;
  args: readonly string[];
  cwd?: string;
  timeoutMs: number;
  maxOutputBytes: number;
  onLine?: (line: string) => void;
}

export interface ProcessHandle {
  /** Termina el proceso y sus descendientes. Seguro de llamar varias veces. */
  kill(): void;
  /** Marca la terminación como cancelación del usuario (no como fallo). */
  cancel(): void;
  result: Promise<ProcessResult>;
}

const IS_WINDOWS = process.platform === 'win32';

function killTree(child: ChildProcess): void {
  const pid = child.pid;
  if (pid === undefined) return;
  if (IS_WINDOWS) {
    // taskkill /T recorre el árbol de procesos; los argumentos van como lista, sin shell.
    execFile('taskkill', ['/pid', String(pid), '/T', '/F'], { windowsHide: true }, () => undefined);
    return;
  }
  try {
    process.kill(-pid, 'SIGKILL'); // grupo de procesos (el proceso se lanzó con detached: true)
  } catch {
    child.kill('SIGKILL');
  }
}

export function startProcess(options: ProcessOptions): ProcessHandle {
  let cancelled = false;
  let timedOut = false;
  let killed = false;
  let stdout = '';
  let stderr = '';
  let stdoutBytes = 0;
  let stderrBytes = 0;
  let stdoutPending = '';
  let stderrPending = '';

  const child = spawn(options.command, [...options.args], {
    shell: false,
    windowsHide: true,
    cwd: options.cwd,
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: !IS_WINDOWS,
  });

  const kill = (): void => {
    if (killed) return;
    killed = true;
    killTree(child);
  };

  const timer = setTimeout(() => {
    timedOut = true;
    kill();
  }, options.timeoutMs);

  const emitLines = (chunk: string, pending: string): string => {
    const parts = (pending + chunk).split(/\r?\n|\r/);
    const rest = parts.pop() ?? '';
    for (const line of parts) {
      if (line.length > 0) options.onLine?.(line);
    }
    return rest;
  };

  const collect = (chunk: Buffer, which: 'out' | 'err'): void => {
    const text = chunk.toString('utf8');
    if (which === 'out') {
      if (stdoutBytes < options.maxOutputBytes) {
        stdout += text;
        stdoutBytes += chunk.length;
      }
      stdoutPending = emitLines(text, stdoutPending);
    } else {
      if (stderrBytes < options.maxOutputBytes) {
        stderr += text;
        stderrBytes += chunk.length;
      }
      stderrPending = emitLines(text, stderrPending);
    }
  };

  child.stdout?.on('data', (chunk: Buffer) => collect(chunk, 'out'));
  child.stderr?.on('data', (chunk: Buffer) => collect(chunk, 'err'));

  const result = new Promise<ProcessResult>((resolve) => {
    let spawnError: string | null = null;
    child.on('error', (err: NodeJS.ErrnoException) => {
      spawnError = err.code === 'ENOENT' ? 'Programa no encontrado' : 'No se pudo iniciar el programa';
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (stdoutPending) options.onLine?.(stdoutPending);
      if (stderrPending) options.onLine?.(stderrPending);
      resolve({ code, stdout, stderr, timedOut, cancelled, spawnError });
    });
  });

  return {
    kill,
    cancel() {
      cancelled = true;
      kill();
    },
    result,
  };
}
