/** Lista numérica de capacidad creciente (evita arrays JS enormes para deshacer y para pilas). */
export class GrowableUint32 {
  private buf = new Uint32Array(1024);
  length = 0;

  push(v: number): void {
    if (this.length === this.buf.length) {
      const next = new Uint32Array(this.buf.length * 2);
      next.set(this.buf);
      this.buf = next;
    }
    this.buf[this.length++] = v;
  }

  /** Quita y devuelve el último valor (0 si está vacía). */
  pop(): number {
    if (this.length === 0) return 0;
    this.length -= 1;
    return this.buf[this.length] ?? 0;
  }

  toArray(): Uint32Array {
    return this.buf.slice(0, this.length);
  }
}
