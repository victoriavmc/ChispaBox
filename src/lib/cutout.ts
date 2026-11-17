/*
 * Quitar fondo con algoritmos clásicos (sin IA, sin modelos entrenados).
 *
 * Diseño: el ImageData guarda los RGB originales intactos; el canal alfa es la
 * máscara. Solo se asigna alfa 0 (quitar) o 255 (restaurar), así el original
 * siempre puede recuperarse. Cada operación se registra para poder deshacerla.
 */
import { GrowableUint32 } from './growable';

const MAX_UNDO = 20;
const MAX_DISTANCE = Math.sqrt(3) * 255;

/** Tolerancia 0–100 → distancia euclídea RGB máxima. */
export function toleranceToDistance(tolerance: number): number {
  return (Math.max(0, Math.min(100, tolerance)) / 100) * MAX_DISTANCE;
}

/** Registro de cambios: índice de píxel y alfa anterior, en buffers tipados. */
class ChangeLog {
  readonly idx = new GrowableUint32();
  private old = new Uint8Array(1024);

  get length(): number {
    return this.idx.length;
  }

  record(pixel: number, previousAlpha: number): void {
    if (this.idx.length >= this.old.length) {
      const next = new Uint8Array(this.old.length * 2);
      next.set(this.old);
      this.old = next;
    }
    this.old[this.idx.length] = previousAlpha;
    this.idx.push(pixel);
  }

  oldValues(): Uint8Array {
    return this.old.slice(0, this.idx.length);
  }
}

interface Entry {
  idx: Uint32Array;
  old: Uint8Array;
}

export class CutoutSession {
  readonly width: number;
  readonly height: number;
  /** RGBA: RGB original; alfa = máscara actual. */
  readonly data: Uint8ClampedArray<ArrayBuffer>;
  private readonly undoStack: Entry[] = [];
  /** Trazo de pincel en curso: todos sus segmentos forman un único paso de deshacer. */
  private stroke: ChangeLog | null = null;

  constructor(image: ImageData) {
    this.width = image.width;
    this.height = image.height;
    this.data = image.data;
  }

  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  /** Color RGB de un píxel (para el cuentagotas). */
  colorAt(x: number, y: number): [number, number, number] {
    const i = (y * this.width + x) * 4;
    return [this.data[i] ?? 0, this.data[i + 1] ?? 0, this.data[i + 2] ?? 0];
  }

  /** Color medio de las cuatro esquinas (bloques de 5×5). */
  cornerColor(): [number, number, number] {
    const s = 5;
    const w = this.width;
    const h = this.height;
    const starts: Array<[number, number]> = [
      [0, 0],
      [Math.max(0, w - s), 0],
      [0, Math.max(0, h - s)],
      [Math.max(0, w - s), Math.max(0, h - s)],
    ];
    let r = 0;
    let g = 0;
    let b = 0;
    let n = 0;
    for (const [x0, y0] of starts) {
      for (let y = y0; y < Math.min(h, y0 + s); y++) {
        for (let x = x0; x < Math.min(w, x0 + s); x++) {
          const i = (y * w + x) * 4;
          r += this.data[i] ?? 0;
          g += this.data[i + 1] ?? 0;
          b += this.data[i + 2] ?? 0;
          n++;
        }
      }
    }
    return [Math.round(r / n), Math.round(g / n), Math.round(b / n)];
  }

  /** Quita todos los píxeles de color parecido al indicado, en toda la imagen. */
  removeColor(target: readonly [number, number, number], tolerance: number): number {
    const maxD = toleranceToDistance(tolerance);
    const maxD2 = maxD * maxD;
    const [tr, tg, tb] = target;
    const d = this.data;
    const log = new ChangeLog();
    const total = this.width * this.height;
    for (let p = 0; p < total; p++) {
      const i = p * 4;
      if (d[i + 3] === 0) continue;
      const dr = (d[i] ?? 0) - tr;
      const dg = (d[i + 1] ?? 0) - tg;
      const db = (d[i + 2] ?? 0) - tb;
      if (dr * dr + dg * dg + db * db <= maxD2) {
        log.record(p, d[i + 3] ?? 255);
        d[i + 3] = 0;
      }
    }
    return this.commit(log);
  }

  /**
   * Quita la región conectada (4 vecinos) que parte del píxel indicado y cuyo color
   * es parecido al del píxel de partida. Cada píxel se marca (alfa 0) al apilarlo,
   * así entra en la pila una sola vez.
   */
  removeRegion(x: number, y: number, tolerance: number): number {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return 0;
    const w = this.width;
    const h = this.height;
    const d = this.data;
    const start = y * w + x;
    if (d[start * 4 + 3] === 0) return 0;
    const sr = d[start * 4] ?? 0;
    const sg = d[start * 4 + 1] ?? 0;
    const sb = d[start * 4 + 2] ?? 0;
    const maxD = toleranceToDistance(tolerance);
    const maxD2 = maxD * maxD;
    const matches = (p: number): boolean => {
      const i = p * 4;
      if (d[i + 3] === 0) return false;
      const dr = (d[i] ?? 0) - sr;
      const dg = (d[i + 1] ?? 0) - sg;
      const db = (d[i + 2] ?? 0) - sb;
      return dr * dr + dg * dg + db * db <= maxD2;
    };

    const log = new ChangeLog();
    const stack = new GrowableUint32();
    log.record(start, d[start * 4 + 3] ?? 255);
    d[start * 4 + 3] = 0;
    stack.push(start);
    while (stack.length > 0) {
      const cur = stack.pop();
      const cx = cur % w;
      const cy = (cur - cx) / w;
      const candidates = [
        cx > 0 ? cur - 1 : -1,
        cx < w - 1 ? cur + 1 : -1,
        cy > 0 ? cur - w : -1,
        cy < h - 1 ? cur + w : -1,
      ];
      for (const n of candidates) {
        if (n >= 0 && matches(n)) {
          log.record(n, d[n * 4 + 3] ?? 255);
          d[n * 4 + 3] = 0;
          stack.push(n);
        }
      }
    }
    return this.commit(log);
  }

  /** Inicia un trazo de pincel: sus segmentos se deshacen juntos. */
  beginStroke(): void {
    this.stroke = new ChangeLog();
  }

  /** Cierra el trazo y lo añade al historial de deshacer. */
  endStroke(): void {
    if (!this.stroke) return;
    const log = this.stroke;
    this.stroke = null;
    this.commit(log);
  }

  /**
   * Segmento de pincel entre dos puntos (coordenadas de imagen): borra (alfa 0)
   * o restaura (alfa 255) dentro del radio. Devuelve el número de píxeles cambiados.
   */
  brushSegment(from: readonly [number, number], to: readonly [number, number], radius: number, mode: 'erase' | 'restore'): number {
    const dist = Math.hypot(to[0] - from[0], to[1] - from[1]);
    const steps = Math.max(1, Math.ceil(dist));
    const r = Math.max(0.5, radius);
    const target = mode === 'erase' ? 0 : 255;
    const log = this.stroke ?? new ChangeLog();
    let changed = 0;
    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      const cx = from[0] + (to[0] - from[0]) * t;
      const cy = from[1] + (to[1] - from[1]) * t;
      const x0 = Math.max(0, Math.floor(cx - r));
      const x1 = Math.min(this.width - 1, Math.ceil(cx + r));
      const y0 = Math.max(0, Math.floor(cy - r));
      const y1 = Math.min(this.height - 1, Math.ceil(cy + r));
      for (let y = y0; y <= y1; y++) {
        for (let x = x0; x <= x1; x++) {
          if ((x - cx) * (x - cx) + (y - cy) * (y - cy) > r * r) continue;
          const p = y * this.width + x;
          const i = p * 4 + 3;
          const current = this.data[i] ?? 0;
          if (current === target) continue;
          log.record(p, current);
          this.data[i] = target;
          changed++;
        }
      }
    }
    if (!this.stroke) this.commit(log);
    return changed;
  }

  /** Devuelve la máscara a su estado original (todo visible). Es deshacible. */
  resetMask(): number {
    const log = new ChangeLog();
    const total = this.width * this.height;
    for (let p = 0; p < total; p++) {
      const i = p * 4 + 3;
      const current = this.data[i] ?? 0;
      if (current !== 255) {
        log.record(p, current);
        this.data[i] = 255;
      }
    }
    return this.commit(log);
  }

  /** Deshace el último paso. Devuelve false si no hay nada que deshacer. */
  undo(): boolean {
    const entry = this.undoStack.pop();
    if (!entry) return false;
    for (let k = 0; k < entry.idx.length; k++) {
      this.data[(entry.idx[k] ?? 0) * 4 + 3] = entry.old[k] ?? 255;
    }
    return true;
  }

/**
   * Vista previa, sin modificar la imagen: marca (1) los píxeles de color parecido al indicado
   * que se quitarían con removeColor.
   */
  candidateColor(target: readonly [number, number, number], tolerance: number): Uint8Array {
    const mask = new Uint8Array(this.width * this.height);
    const maxD = toleranceToDistance(tolerance);
    const maxD2 = maxD * maxD;
    const [tr, tg, tb] = target;
    const d = this.data;
    const total = this.width * this.height;
    for (let p = 0; p < total; p++) {
      const i = p * 4;
      if (d[i + 3] === 0) continue;
      const dr = (d[i] ?? 0) - tr;
      const dg = (d[i + 1] ?? 0) - tg;
      const db = (d[i + 2] ?? 0) - tb;
      if (dr * dr + dg * dg + db * db <= maxD2) mask[p] = 1;
    }
    return mask;
  }

  /**
   * Vista previa, sin modificar la imagen: marca (1) la región conectada que partiría de (x, y)
   * y que removeRegion quitaría.
   */
  candidateRegion(x: number, y: number, tolerance: number): Uint8Array {
    const w = this.width;
    const h = this.height;
    const mask = new Uint8Array(w * h);
    if (x < 0 || y < 0 || x >= w || y >= h) return mask;
    const d = this.data;
    const start = y * w + x;
    if (d[start * 4 + 3] === 0) return mask;
    const sr = d[start * 4] ?? 0;
    const sg = d[start * 4 + 1] ?? 0;
    const sb = d[start * 4 + 2] ?? 0;
    const maxD = toleranceToDistance(tolerance);
    const maxD2 = maxD * maxD;
    const matches = (p: number): boolean => {
      const i = p * 4;
      if (d[i + 3] === 0) return false;
      const dr = (d[i] ?? 0) - sr;
      const dg = (d[i + 1] ?? 0) - sg;
      const db = (d[i + 2] ?? 0) - sb;
      return dr * dr + dg * dg + db * db <= maxD2;
    };
    const stack = new GrowableUint32();
    mask[start] = 1;
    stack.push(start);
    while (stack.length > 0) {
      const cur = stack.pop();
      const cx = cur % w;
      const cy = (cur - cx) / w;
      const candidates = [
        cx > 0 ? cur - 1 : -1,
        cx < w - 1 ? cur + 1 : -1,
        cy > 0 ? cur - w : -1,
        cy < h - 1 ? cur + w : -1,
      ];
      for (const n of candidates) {
        if (n >= 0 && mask[n] === 0 && matches(n)) {
          mask[n] = 1;
          stack.push(n);
        }
      }
    }
    return mask;
  }

  private commit(log: ChangeLog): number {
    const count = log.length;
    if (count > 0) {
      this.undoStack.push({ idx: log.idx.toArray(), old: log.oldValues() });
      if (this.undoStack.length > MAX_UNDO) this.undoStack.shift();
    }
    return count;
  }
}
