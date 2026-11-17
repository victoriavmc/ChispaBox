/* Tipos mínimos para qrcode (MIT) usados por «Generador y lector de QR». */
declare module 'qrcode' {
  export type ErrorCorrectionLevel = 'L' | 'M' | 'Q' | 'H';
  export interface QRCodeOptions {
    errorCorrectionLevel?: ErrorCorrectionLevel;
    margin?: number;
    width?: number;
    color?: { dark?: string; light?: string };
  }
  export function toCanvas(canvas: HTMLCanvasElement, text: string, options?: QRCodeOptions): Promise<void>;
  export function toString(text: string, options: QRCodeOptions & { type: 'svg' }): Promise<string>;
}
