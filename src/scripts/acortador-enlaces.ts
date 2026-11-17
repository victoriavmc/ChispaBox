/*
 * Página «Acortador de enlaces»: crea enlaces cortos guardados en este navegador y redirige
 * cuando la dirección trae ?c=código. Sin IA, sin servidor y sin enviar datos a terceros.
 */
import '../styles/image-tools.css';
import '../styles/documentos-pdf.css';
import '../styles/acortador-enlaces.css';
import {
  agregarAlRegistro,
  codigoDesdeUrl,
  construirEnlace,
  esRegistroValido,
  generarCodigo,
  validarUrl,
  type Registro,
} from '../shared/acortador-enlaces.ts';

const CLAVE = 'chispabox-acortador-enlaces';

function requireEl<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Falta el elemento #${id}`);
  return el as T;
}

const E = {
  redirect: requireEl<HTMLElement>('short-redirect'),
  redirectText: requireEl<HTMLElement>('short-redirect-text'),
  form: requireEl<HTMLElement>('short-form'),
  create: requireEl<HTMLFormElement>('short-create'),
  url: requireEl<HTMLInputElement>('short-url'),
  error: requireEl<HTMLElement>('short-error'),
  result: requireEl<HTMLElement>('short-result'),
  resultLink: requireEl<HTMLAnchorElement>('short-result-link'),
  copy: requireEl<HTMLButtonElement>('short-copy'),
  copyStatus: requireEl<HTMLElement>('short-copy-status'),
  status: requireEl<HTMLElement>('short-status'),
};

/** Lee el registro guardado en este navegador; si está dañado o bloqueado, devuelve uno vacío. */
function leerRegistro(): Registro {
  try {
    const raw = localStorage.getItem(CLAVE);
    if (!raw) return {};
    const valor: unknown = JSON.parse(raw);
    return esRegistroValido(valor) ? valor : {};
  } catch {
    return {};
  }
}

function guardarRegistro(registro: Registro): boolean {
  try {
    localStorage.setItem(CLAVE, JSON.stringify(registro));
    return true;
  } catch {
    return false;
  }
}

function mostrarError(mensaje: string): void {
  E.error.textContent = mensaje;
  E.error.hidden = false;
}

function limpiarError(): void {
  E.error.textContent = '';
  E.error.hidden = true;
}

/** Comprueba la clave sin heredar propiedades de Object.prototype (p. ej. «valueOf»). */
function tieneCodigo(registro: Registro, codigo: string): boolean {
  return Object.prototype.hasOwnProperty.call(registro, codigo);
}

/** Busca un código libre (evita colisiones con los ya guardados). */
function codigoLibre(registro: Registro): string {
  const aleatorio = (n: number) => crypto.getRandomValues(new Uint8Array(n));
  let codigo = generarCodigo(aleatorio);
  while (tieneCodigo(registro, codigo)) codigo = generarCodigo(aleatorio);
  return codigo;
}

function crearEnlace(event: SubmitEvent): void {
  event.preventDefault();
  limpiarError();
  const validacion = validarUrl(E.url.value);
  if (!validacion.ok) {
    E.result.hidden = true;
    mostrarError(validacion.error);
    return;
  }

  const registro = leerRegistro();
  const codigo = codigoLibre(registro);
  const actualizado = agregarAlRegistro(registro, codigo, validacion.url, Date.now());
  if (!guardarRegistro(actualizado)) {
    mostrarError('No se pudo guardar el enlace en este navegador. Revisá si el almacenamiento está bloqueado.');
    return;
  }

  const enlace = construirEnlace(location.origin, codigo);
  E.resultLink.href = enlace;
  E.resultLink.textContent = enlace;
  E.copyStatus.textContent = '';
  E.result.hidden = false;
  E.status.textContent = 'Enlace corto creado.';
}

async function copiarEnlace(): Promise<void> {
  const enlace = E.resultLink.href;
  try {
    await navigator.clipboard.writeText(enlace);
    E.copyStatus.textContent = 'Enlace copiado.';
  } catch {
    E.copyStatus.textContent = 'No se pudo copiar automáticamente. Seleccioná el enlace y copialo a mano.';
  }
}

/** Si la dirección trae un código guardado en este navegador, redirige al enlace original. */
function resolverRedireccion(): boolean {
  const codigo = codigoDesdeUrl(location.pathname, location.search);
  if (codigo === null) return false;

  E.redirect.hidden = false;
  const registro = leerRegistro();
  const entrada = tieneCodigo(registro, codigo) ? registro[codigo] : undefined;
  // Se vuelve a validar antes de redirigir: solo http o https, nunca otro esquema.
  const destino = entrada ? validarUrl(entrada.url) : null;
  if (destino?.ok) {
    E.redirectText.textContent = 'Te estamos llevando al enlace original…';
    location.replace(destino.url);
    return true;
  }

  E.redirectText.textContent =
    'No encontramos este enlace en este navegador. Los enlaces cortos solo funcionan en el navegador donde se crearon.';
  return false;
}

function iniciar(): void {
  E.create.addEventListener('submit', crearEnlace);
  E.copy.addEventListener('click', () => void copiarEnlace());

  if (resolverRedireccion()) {
    E.form.hidden = true;
    return;
  }
}

iniciar();
