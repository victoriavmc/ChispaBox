/*
 * Selector visual de rango sobre la forma de onda de un audio.
 * Dibuja la onda en un canvas, muestra la parte conservada y permite arrastrar
 * los bordes de inicio y final. No conoce los campos de texto: avisa con onChange
 * y la página se encarga de sincronizarlos.
 */
import { formatTiempo } from '../shared/recortar-audio.ts';

/** Separación mínima entre inicio y final, en segundos (igual que la validación). */
const MIN_SEL = 0.1;
/** Paso de las flechas del teclado, en segundos. */
const PASO = 0.1;
const PASO_GRANDE = 1;

export interface OpcionesSelectorOnda {
  stage: HTMLElement;
  canvas: HTMLCanvasElement;
  sel: HTMLElement;
  handleInicio: HTMLElement;
  handleFin: HTMLElement;
  tipInicio: HTMLElement;
  tipFin: HTMLElement;
  /** Se llama cuando el usuario mueve un borde (arrastre o teclado). */
  onChange: (inicio: number, fin: number) => void;
}

export interface SelectorOnda {
  /** Carga un audio (o lo quita con null) y dibuja su forma de onda. */
  setAudio(buffer: AudioBuffer | null): void;
  /** Muestra un rango (en segundos) sin disparar onChange. */
  setRango(inicio: number, fin: number): void;
  /** Redibuja la onda (por ejemplo, al cambiar el ancho de la pantalla). */
  redibujar(): void;
}

export function crearSelectorOnda(op: OpcionesSelectorOnda): SelectorOnda {
  let buffer: AudioBuffer | null = null;
  let duracion = 0;
  let inicio = 0;
  let fin = 0;
  let arrastrando: 'inicio' | 'fin' | null = null;
  let envolvente: { min: Float32Array; max: Float32Array; pico: number } | null = null;
  let envolventeAncho = 0;

  const ctx2d = op.canvas.getContext('2d');

  /**
   * Para cada columna de píxeles, el valor mínimo y máximo de la señal (combinando canales).
   * Así se dibuja el recorrido real de la onda, con sus subidas y bajadas, no un bloque plano.
   */
  function calcularEnvolvente(ancho: number): { min: Float32Array; max: Float32Array; pico: number } {
    const min = new Float32Array(ancho);
    const max = new Float32Array(ancho);
    let pico = 0;
    if (!buffer) return { min, max, pico };
    const muestras = buffer.length;
    const porColumna = muestras / ancho;
    for (let c = 0; c < buffer.numberOfChannels; c++) {
      const datos = buffer.getChannelData(c);
      for (let x = 0; x < ancho; x++) {
        const desde = Math.floor(x * porColumna);
        const hasta = Math.max(desde + 1, Math.min(muestras, Math.floor((x + 1) * porColumna)));
        let mn = c === 0 ? 0 : min[x];
        let mx = c === 0 ? 0 : max[x];
        for (let i = desde; i < hasta; i++) {
          const v = datos[i];
          if (v < mn) mn = v;
          if (v > mx) mx = v;
        }
        min[x] = mn;
        max[x] = mx;
        pico = Math.max(pico, Math.abs(mn), Math.abs(mx));
      }
    }
    return { min, max, pico };
  }

  function dibujarOnda(): void {
    if (!ctx2d) return;
    const rect = op.stage.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const ancho = Math.max(1, Math.round(rect.width));
    const alto = Math.max(1, Math.round(rect.height));
    op.canvas.width = Math.round(ancho * dpr);
    op.canvas.height = Math.round(alto * dpr);
    ctx2d.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx2d.clearRect(0, 0, ancho, alto);
    if (!buffer) return;

    if (!envolvente || envolventeAncho !== ancho) {
      envolvente = calcularEnvolvente(ancho);
      envolventeAncho = ancho;
    }
    const { min, max, pico } = envolvente;

    // El color resuelto del escenario (var(--accent)) cambia solo con el tema claro/oscuro.
    const color = getComputedStyle(op.stage).color;
    const centro = alto / 2;
    // Escala por el pico del audio: lo más fuerte llega casi al borde y lo bajo se ve bajo.
    const escala = pico > 0 ? (alto * 0.45) / pico : 0;

    // Línea de referencia del cero.
    ctx2d.fillStyle = color;
    ctx2d.globalAlpha = 0.35;
    ctx2d.fillRect(0, centro, ancho, 1);
    ctx2d.globalAlpha = 1;

    // Una línea vertical por columna, desde el mínimo hasta el máximo de esa parte del audio.
    for (let x = 0; x < ancho; x++) {
      const arriba = centro - max[x] * escala;
      const abajo = centro - min[x] * escala;
      ctx2d.fillRect(x, arriba, 1, Math.max(1, abajo - arriba));
    }
  }

  function pintarPosiciones(): void {
    const pct = (t: number) => (duracion > 0 ? (t / duracion) * 100 : 0);
    op.handleInicio.style.left = `${pct(inicio)}%`;
    op.handleFin.style.left = `${pct(fin)}%`;
    op.sel.style.left = `${pct(inicio)}%`;
    op.sel.style.width = `${Math.max(0, pct(fin) - pct(inicio))}%`;
    op.tipInicio.textContent = formatTiempo(inicio);
    op.tipFin.textContent = formatTiempo(fin);
    op.handleInicio.setAttribute('aria-valuemax', String(fin));
    op.handleInicio.setAttribute('aria-valuenow', String(inicio));
    op.handleFin.setAttribute('aria-valuemin', String(inicio));
    op.handleFin.setAttribute('aria-valuemax', String(duracion));
    op.handleFin.setAttribute('aria-valuenow', String(fin));
    op.handleFin.setAttribute('aria-valuetext', formatTiempo(fin));
    op.handleInicio.setAttribute('aria-valuetext', formatTiempo(inicio));
  }

  function tiempoDesdePuntero(clientX: number): number {
    const rect = op.stage.getBoundingClientRect();
    if (rect.width <= 0) return 0;
    const r = (clientX - rect.left) / rect.width;
    return Math.min(1, Math.max(0, r)) * duracion;
  }

  function moverBorde(cual: 'inicio' | 'fin', t: number): void {
    if (cual === 'inicio') {
      inicio = Math.min(Math.max(0, t), Math.max(0, fin - MIN_SEL));
    } else {
      fin = Math.max(Math.min(duracion, t), Math.min(duracion, inicio + MIN_SEL));
    }
    pintarPosiciones();
    op.onChange(inicio, fin);
  }

  function bordeMasCercano(t: number): 'inicio' | 'fin' {
    return Math.abs(t - inicio) <= Math.abs(t - fin) ? 'inicio' : 'fin';
  }

  // Clic o arrastre sobre la onda: mueve el borde más cercano y sigue el puntero.
  op.stage.addEventListener('pointerdown', (e) => {
    if (!buffer) return;
    const t = tiempoDesdePuntero(e.clientX);
    const destino = e.target instanceof HTMLElement && e.target.closest('.wf-handle');
    arrastrando = destino
      ? destino === op.handleInicio ? 'inicio' : 'fin'
      : bordeMasCercano(t);
    op.stage.setPointerCapture(e.pointerId);
    op.stage.classList.add('is-dragging');
    moverBorde(arrastrando, t);
    e.preventDefault();
  });

  op.stage.addEventListener('pointermove', (e) => {
    if (!arrastrando) return;
    moverBorde(arrastrando, tiempoDesdePuntero(e.clientX));
  });

  const terminarArrastre = (e: PointerEvent) => {
    if (!arrastrando) return;
    arrastrando = null;
    op.stage.classList.remove('is-dragging');
    if (op.stage.hasPointerCapture(e.pointerId)) op.stage.releasePointerCapture(e.pointerId);
  };
  op.stage.addEventListener('pointerup', terminarArrastre);
  op.stage.addEventListener('pointercancel', terminarArrastre);

  // Teclado sobre los bordes: flechas para ajustar de a 0,1 s (Mayús: 1 s).
  for (const [el, cual] of [
    [op.handleInicio, 'inicio'],
    [op.handleFin, 'fin'],
  ] as const) {
    el.addEventListener('keydown', (e) => {
      if (!buffer) return;
      const paso = e.shiftKey ? PASO_GRANDE : PASO;
      let delta = 0;
      if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') delta = -paso;
      else if (e.key === 'ArrowRight' || e.key === 'ArrowUp') delta = paso;
      else return;
      e.preventDefault();
      moverBorde(cual, (cual === 'inicio' ? inicio : fin) + delta);
    });
  }

  const observador = new ResizeObserver(() => {
    envolvente = null;
    dibujarOnda();
  });
  observador.observe(op.stage);

  return {
    setAudio(nuevo) {
      buffer = nuevo;
      duracion = nuevo?.duration ?? 0;
      inicio = 0;
      fin = duracion;
      envolvente = null;
      op.stage.classList.toggle('is-disabled', !nuevo);
      pintarPosiciones();
      dibujarOnda();
    },
    setRango(nuevoInicio, nuevoFin) {
      inicio = nuevoInicio;
      fin = nuevoFin;
      pintarPosiciones();
    },
    redibujar() {
      envolvente = null;
      dibujarOnda();
    },
  };
}
