/*
 * Página «Generador de contraseñas». Toda la lógica corre en el navegador con crypto.getRandomValues.
 * La contraseña no se guarda ni se envía; se pierde al cerrar o regenerar la página.
 */
import '../styles/image-tools.css';
import '../styles/generador-contrasenas.css';
import {
  LONGITUD_DEFAULT,
  LONGITUD_MAX,
  LONGITUD_MIN,
  alfabetoDe,
  conjuntosElegidos,
  entropiaBits,
  evaluarFortaleza,
  generarContrasena,
  tiempoDeCrackeo,
  type NombreConjunto,
  type OpcionesContrasena,
} from '../shared/generador-contrasenas.ts';
import { clearError, requireEl, setStatus, showError } from '../lib/ui-common.ts';

const E = {
  rango: requireEl<HTMLInputElement>('pw-longitud-rango'),
  valor: requireEl<HTMLElement>('pw-longitud-valor'),
  mayusculas: requireEl<HTMLInputElement>('pw-mayusculas'),
  minusculas: requireEl<HTMLInputElement>('pw-minusculas'),
  numeros: requireEl<HTMLInputElement>('pw-numeros'),
  simbolos: requireEl<HTMLInputElement>('pw-simbolos'),
  sinAmbiguos: requireEl<HTMLInputElement>('pw-sin-ambiguos'),
  error: requireEl<HTMLElement>('pw-error'),
  resultado: requireEl<HTMLDivElement>('pw-resultado'),
  copiar: requireEl<HTMLButtonElement>('pw-copiar'),
  generar: requireEl<HTMLButtonElement>('pw-generar'),
  fuerzaEtiqueta: requireEl<HTMLElement>('pw-fuerza-etiqueta'),
  barra: requireEl<HTMLElement>('pw-barra-relleno'),
  detalle: requireEl<HTMLElement>('pw-fuerza-detalle'),
  usados: requireEl<HTMLUListElement>('pw-usados'),
  status: requireEl<HTMLElement>('pw-status'),
};

const CASILLAS: Record<NombreConjunto, HTMLInputElement> = {
  mayusculas: E.mayusculas,
  minusculas: E.minusculas,
  numeros: E.numeros,
  simbolos: E.simbolos,
};

const ETIQUETAS: Record<NombreConjunto, string> = {
  mayusculas: 'ABC',
  minusculas: 'abc',
  numeros: '123',
  simbolos: '#$&',
};

const COLORES = {
  'muy-debil': '#E61932',
  debil: '#F97316',
  aceptable: '#EAB308',
  fuerte: '#22C55E',
  'muy-fuerte': '#15803D',
} as const;

function leerOpciones(): OpcionesContrasena {
  return {
    longitud: Number(E.rango.value),
    mayusculas: E.mayusculas.checked,
    minusculas: E.minusculas.checked,
    numeros: E.numeros.checked,
    simbolos: E.simbolos.checked,
    sinAmbiguos: E.sinAmbiguos.checked,
  };
}

function pintarUsados(opciones: OpcionesContrasena): void {
  const elegidos = conjuntosElegidos(opciones);
  const alfabeto = alfabetoDe(opciones);
  E.usados.replaceChildren(
    ...elegidos.map((nombre, i) => {
      const li = document.createElement('li');
      li.className = 'pw-usados__item';
      const code = document.createElement('code');
      code.textContent = ETIQUETAS[nombre];
      const detalle = document.createElement('span');
      detalle.textContent = `${alfabeto[i]?.length ?? 0} caracteres`;
      li.append(code, detalle);
      return li;
    }),
  );
}

function pintarFortaleza(opciones: OpcionesContrasena): void {
  const bits = entropiaBits(opciones);
  const fuerza = evaluarFortaleza(bits);
  E.fuerzaEtiqueta.textContent = fuerza.etiqueta;
  E.fuerzaEtiqueta.dataset.nivel = fuerza.nivel;
  E.barra.style.width = `${fuerza.porcentaje}%`;
  E.barra.style.background = COLORES[fuerza.nivel];
  E.detalle.textContent =
    `Entropía aproximada: ${Math.round(bits)} bits. ` +
    `Un atacante que probara 10 mil millones de contraseñas por segundo tardaría ${tiempoDeCrackeo(bits)} en probarlas todas.`;
}

/** Regenera la contraseña con la configuración actual. Si no hay nada elegido, avisa sin generar. */
function generar(): void {
  const opciones = leerOpciones();
  E.valor.textContent = String(opciones.longitud);
  const r = generarContrasena(opciones);
  if (!r.ok) {
    E.resultado.replaceChildren();
    E.copiar.disabled = true;
    E.fuerzaEtiqueta.textContent = '—';
    delete E.fuerzaEtiqueta.dataset.nivel;
    E.barra.style.width = '0%';
    E.detalle.textContent = '';
    E.usados.replaceChildren();
    showError(E.error, r.error);
    return;
  }
  clearError(E.error);
  E.copiar.disabled = false;
  pintarContrasena(r.contrasena);
  pintarUsados(opciones);
  pintarFortaleza(opciones);
  setStatus(E.status, '');
}

/** Muestra la contraseña con un color por tipo de carácter (mayúscula, minúscula, número, símbolo). */
function pintarContrasena(texto: string): void {
  E.resultado.replaceChildren(
    ...[...texto].map((c) => {
      const span = document.createElement('span');
      span.textContent = c;
      span.className = /[A-Z]/.test(c)
        ? 'pw-char pw-char--mayus'
        : /[a-z]/.test(c)
          ? 'pw-char pw-char--minus'
          : /[0-9]/.test(c)
            ? 'pw-char pw-char--num'
            : 'pw-char pw-char--sim';
      return span;
    }),
  );
}

async function copiar(): Promise<void> {
  const texto = E.resultado.textContent ?? '';
  if (!texto) return;
  try {
    await navigator.clipboard.writeText(texto);
    setStatus(E.status, 'Contraseña copiada al portapapeles.');
  } catch {
    // Sin permiso de portapapeles: se selecciona el texto para copiarlo a mano.
    const rango = document.createRange();
    rango.selectNodeContents(E.resultado);
    const seleccion = window.getSelection();
    seleccion?.removeAllRanges();
    seleccion?.addRange(rango);
    setStatus(E.status, 'No se pudo copiar automáticamente. El texto quedó seleccionado: copialo con Ctrl+C.');
  }
}

/** Evita dejar todas las casillas vacías: la última activa no se puede desmarcar. */
function casillaCambiada(origen: HTMLInputElement): void {
  const activas = (Object.keys(CASILLAS) as NombreConjunto[]).filter((n) => CASILLAS[n].checked);
  if (activas.length === 0) origen.checked = true;
  generar();
}

E.rango.min = String(LONGITUD_MIN);
E.rango.max = String(LONGITUD_MAX);
E.rango.value = String(LONGITUD_DEFAULT);

E.rango.addEventListener('input', generar);
for (const casilla of Object.values(CASILLAS)) {
  casilla.addEventListener('change', () => casillaCambiada(casilla));
}
E.sinAmbiguos.addEventListener('change', generar);
E.generar.addEventListener('click', generar);
E.copiar.addEventListener('click', () => void copiar());

generar();
