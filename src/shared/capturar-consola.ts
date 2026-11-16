/*
 * Captura lo que una operación escribe en la consola (stdout y stderr).
 * QPDF (WebAssembly) imprime sus mensajes directamente en la consola y las opciones
 * print/printErr del módulo no los reciben, así que hay que capturarlos aquí.
 * Las operaciones se ejecutan una por una, por eso es seguro cambiar la consola durante ellas.
 */
export async function capturarConsola<T>(operacion: () => Promise<T>): Promise<{ valor: T; lineas: string[] }> {
  const lineas: string[] = [];
  const log = console.log;
  const error = console.error;
  const registrar = (...partes: unknown[]) => {
    lineas.push(partes.map((p) => String(p)).join(' '));
  };
  console.log = registrar;
  console.error = registrar;
  try {
    const valor = await operacion();
    return { valor, lineas };
  } finally {
    console.log = log;
    console.error = error;
  }
}
