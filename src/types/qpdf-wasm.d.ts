// Tipos mínimos de @neslinesli93/qpdf-wasm (QPDF compilado a WebAssembly).
// El paquete trae sus propios tipos, pero no los expone como "types", así que se declaran aquí.
declare module '@neslinesli93/qpdf-wasm' {
  export interface QpdfInstance {
    callMain(args: string[]): number;
    FS: {
      writeFile(path: string, data: Uint8Array): void;
      readFile(path: string): Uint8Array;
      unlink(path: string): void;
    };
  }

  export interface QpdfOptions {
    locateFile?: (path: string) => string;
    noInitialRun?: boolean;
    /** Evita que QPDF termine el proceso (o lance excepción) al fallar: callMain devuelve el código. */
    noExitRuntime?: boolean;
    print?: (texto: string) => void;
    printErr?: (texto: string) => void;
  }

  export default function createQpdf(opciones: QpdfOptions): Promise<QpdfInstance>;
}
