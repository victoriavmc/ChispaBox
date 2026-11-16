/*
 * Sustituto de `worker-f/browser` (licencia MIT declarada, texto de licencia no verificado).
 *
 * `read-excel-file/browser` importa este módulo, pero su lector de .xlsx no lo invoca:
 * `parseSpreadsheetContentsInWorker()` ignora la fábrica de workers (su código lo marca como
 * «Not used») y ejecuta el análisis en el hilo principal. Por eso este sustituto nunca se llama
 * y el resultado del lector es el mismo. Si alguna función futura lo llamara, fallará de forma explícita.
 */
export default function createWorkerFunction(): never {
  throw new Error('worker-f no está disponible en esta compilación: el lector de .xlsx no lo usa.');
}
