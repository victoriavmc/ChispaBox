/*
 * Ejecuta QPDF (WebAssembly) en el navegador. El PDF se trabaja en un sistema de archivos
 * virtual que vive solo en esta pestaña: no se envía a ningún servidor.
 */
import createQpdf from '@neslinesli93/qpdf-wasm';
import qpdfWasmUrl from '@neslinesli93/qpdf-wasm/dist/qpdf.wasm?url';
import { capturarConsola } from '../shared/capturar-consola.ts';

/** Sistema de archivos virtual de Emscripten: solo se usan estas dos operaciones. */
interface FsVirtual {
  writeFile(ruta: string, datos: Uint8Array): void;
  readFile(ruta: string): Uint8Array;
}

export interface ResultadoQpdf {
  codigo: number;
  salida: string;
}

/**
 * Crea una instancia nueva (memoria limpia en cada operación), carga los archivos, ejecuta QPDF
 * y devuelve el código, el texto que escribió y, si pidió una salida, sus bytes.
 */
export async function ejecutarQpdf(
  archivos: Record<string, Uint8Array>,
  args: string[],
  archivoSalida?: string,
): Promise<{ resultado: ResultadoQpdf; bytesSalida: Uint8Array | null }> {
  const { valor, lineas } = await capturarConsola(async () => {
    const qpdf = await createQpdf({ locateFile: () => qpdfWasmUrl, noInitialRun: true, noExitRuntime: true });
    const fs = qpdf.FS as unknown as FsVirtual;
    for (const [ruta, datos] of Object.entries(archivos)) fs.writeFile(ruta, datos);
    let codigo: number;
    try {
      codigo = qpdf.callMain(args);
    } catch (error) {
      // Emscripten puede lanzar una excepción en vez de devolver un código: se trata como error.
      return { codigo: 2, bytes: null as Uint8Array | null, extra: error instanceof Error ? error.message : String(error) };
    }
    // 0 = correcto; 3 = correcto con advertencias (el archivo de salida sí se generó).
    const exito = codigo === 0 || codigo === 3;
    const bytes = exito && archivoSalida ? fs.readFile(archivoSalida) : null;
    return { codigo, bytes, extra: '' };
  });
  const salida = [...lineas, valor.extra].filter(Boolean).join('\n');
  return { resultado: { codigo: valor.codigo, salida }, bytesSalida: valor.bytes };
}
