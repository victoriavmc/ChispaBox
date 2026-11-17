/*
 * Formulario «¿Qué herramienta te gustaría tener?».
 *
 * - El envío sólo se habilita si existe VITE_SUGGESTIONS_ENDPOINT (ver README.md, «Sugerencias»).
 *   Sin endpoint, el botón queda deshabilitado y se muestra un aviso: nunca se simula un envío.
 * - La URL del endpoint no es un secreto, pero ninguna credencial o clave debe estar en el frontend.
 * - La validación de este archivo es sólo de experiencia de usuario. El endpoint debe validar de nuevo
 *   (campos, tamaño, honeypot, límite de frecuencia) porque cualquiera puede enviar peticiones directas.
 */

const DESCRIPTION_MIN = 10;
const DESCRIPTION_MAX = 1000;
const EMAIL_MAX = 254;
const REQUEST_TIMEOUT_MS = 10_000;
// Validación básica; la verificación real del correo la hace el servidor si alguna vez lo usa.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type Fields = {
  description: string;
  email: string;
  website: string;
};

/** Devuelve la URL absoluta del endpoint si es http(s) o una ruta del mismo sitio; si no, null. */
function resolveEndpoint(raw: string | undefined): string | null {
  const value = (raw ?? '').trim();
  if (!value) return null;
  try {
    const url = new URL(value, window.location.href);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : null;
  } catch {
    return null;
  }
}

function validateDescription(value: string): string {
  const text = value.trim();
  if (!text) return 'Escribí una sugerencia para poder enviarla.';
  if (text.length < DESCRIPTION_MIN) {
    return `Contanos un poco más: necesitamos al menos ${DESCRIPTION_MIN} caracteres.`;
  }
  if (text.length > DESCRIPTION_MAX) {
    return `Acortá el texto: el máximo es ${DESCRIPTION_MAX} caracteres.`;
  }
  return '';
}

function validateEmail(value: string): string {
  const text = value.trim();
  if (!text) return ''; // opcional
  if (text.length > EMAIL_MAX || !EMAIL_RE.test(text)) {
    return 'Revisá el correo: tiene que tener un formato como nombre@ejemplo.com.';
  }
  return '';
}

export function initSuggestions(): void {
  const form = document.querySelector<HTMLFormElement>('#suggest-form');
  const notice = document.querySelector<HTMLElement>('#suggest-notice');
  const description = document.querySelector<HTMLTextAreaElement>('#suggest-description');
  const descriptionError = document.querySelector<HTMLElement>('#suggest-description-error');
  const email = document.querySelector<HTMLInputElement>('#suggest-email');
  const emailError = document.querySelector<HTMLElement>('#suggest-email-error');
  const website = document.querySelector<HTMLInputElement>('#suggest-website');
  const submit = document.querySelector<HTMLButtonElement>('#suggest-submit');
  const status = document.querySelector<HTMLElement>('#suggest-status');
  const captchaInput = document.querySelector<HTMLInputElement>('#suggest-captcha');
  const captchaQuestion = document.querySelector<HTMLElement>('#suggest-captcha-question');
  const captchaError = document.querySelector<HTMLElement>('#suggest-captcha-error');
  if (
    !form || !notice || !description || !descriptionError ||
    !email || !emailError || !website || !submit || !status ||
    !captchaInput || !captchaQuestion || !captchaError
  ) {
    return;
  }

  // Por defecto, la ruta del mismo sitio (Caddy la envía al servicio de sugerencias).
  // Definir VITE_SUGGESTIONS_ENDPOINT con un valor vacío deshabilita el envío.
  const configured = import.meta.env.VITE_SUGGESTIONS_ENDPOINT as string | undefined;
  const endpoint = resolveEndpoint(configured ?? '/api/sugerencias');
  let sending = false;

  // ---- Estado de envío deshabilitado ----
  if (!endpoint) {
    notice.hidden = false;
    submit.disabled = true;
  } else {
    submit.disabled = false;
  }

  // ---- Captcha propio: pregunta y token firmado por el servidor ----
  // Cada token sirve una sola vez, así que tras cada envío (o error de captcha) se pide uno nuevo.
  let captchaToken = '';
  let captchaRetryTimer = 0;
  const loadCaptcha = async (): Promise<void> => {
    captchaToken = '';
    window.clearTimeout(captchaRetryTimer);
    captchaQuestion.textContent = 'cargando la pregunta…';
    if (!endpoint) return;
    try {
      const response = await fetch(`${endpoint}/captcha`, { cache: 'no-store', credentials: 'omit' });
      if (response.status === 429) {
        // Demasiadas preguntas pedidas desde esta conexión: esperar lo que indica el servidor y reintentar.
        const espera = Math.min(Math.max(Number(response.headers.get('Retry-After')) || 30, 5), 600);
        captchaQuestion.textContent = `Pediste muchas preguntas seguidas. Se volverá a intentar en ${espera} s.`;
        captchaRetryTimer = window.setTimeout(() => void loadCaptcha(), espera * 1000);
        return;
      }
      const data = (await response.json()) as { token?: unknown; pregunta?: unknown };
      if (!response.ok || typeof data.token !== 'string' || typeof data.pregunta !== 'string') {
        throw new Error('captcha');
      }
      captchaToken = data.token;
      captchaQuestion.textContent = data.pregunta;
    } catch {
      captchaQuestion.textContent = 'no pudimos cargar la pregunta (tocá para reintentar)';
    }
  };
  // Si no pudo cargarse, un toque sobre la pregunta vuelve a pedirla.
  captchaQuestion.addEventListener('click', () => {
    if (!captchaToken && endpoint) void loadCaptcha();
  });
  void loadCaptcha();

  // ---- Errores por campo ----
  const setFieldError = (
    input: HTMLInputElement | HTMLTextAreaElement,
    errorEl: HTMLElement,
    message: string,
  ): void => {
    errorEl.textContent = message;
    errorEl.hidden = message === '';
    input.setAttribute('aria-invalid', String(message !== ''));
  };

  const checkDescription = (): boolean => {
    const message = validateDescription(description.value);
    setFieldError(description, descriptionError, message);
    return message === '';
  };

  const checkEmail = (): boolean => {
    const message = validateEmail(email.value);
    setFieldError(email, emailError, message);
    return message === '';
  };

  // Se valida al salir del campo o al corregirlo, sin molestar mientras se escribe el primer texto.
  description.addEventListener('blur', checkDescription);
  email.addEventListener('blur', checkEmail);
  description.addEventListener('input', () => {
    if (description.getAttribute('aria-invalid') === 'true') checkDescription();
  });
  email.addEventListener('input', () => {
    if (email.getAttribute('aria-invalid') === 'true') checkEmail();
  });

  const setStatus = (state: 'idle' | 'sending' | 'success' | 'error', message = ''): void => {
    status.dataset.state = state;
    status.textContent = message;
  };

  const readFields = (): Fields => ({
    description: description.value.trim(),
    email: email.value.trim(),
    website: website.value,
  });

  // ---- Envío ----
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (sending) return;

    // Sin endpoint no hay envío: nunca mostramos una confirmación falsa.
    if (!endpoint) {
      setStatus('error', 'El envío todavía no está habilitado.');
      return;
    }

    const descriptionOk = checkDescription();
    const emailOk = checkEmail();
    const captchaOk = captchaInput.value.trim() !== '' && captchaToken !== '';
    captchaError.textContent = captchaInput.value.trim() === '' ? 'Respondé la pregunta.' : 'Pedí una pregunta nueva e intentá de nuevo.';
    captchaError.hidden = captchaOk;
    captchaInput.setAttribute('aria-invalid', String(!captchaOk));
    if (!descriptionOk || !emailOk || !captchaOk) {
      setStatus('error', 'Revisá los campos marcados.');
      if (!descriptionOk) description.focus();
      else if (!emailOk) email.focus();
      else captchaInput.focus();
      return;
    }

    const fields = readFields();
    // Sólo se envía lo necesario: sin fecha, sin datos del navegador ni identificadores.
    const payload = JSON.stringify({
      description: fields.description,
      ...(fields.email ? { email: fields.email } : {}),
      website: fields.website,
      captchaToken,
      captchaAnswer: captchaInput.value.trim(),
    });

    sending = true;
    submit.disabled = true;
    submit.setAttribute('aria-busy', 'true');
    submit.textContent = 'Enviando…';
    setStatus('sending', 'Enviando tu sugerencia…');

    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: payload,
        signal: controller.signal,
        credentials: 'omit',
        cache: 'no-store',
        referrerPolicy: 'no-referrer',
      });

      if (response.ok) {
        form.reset();
        descriptionError.hidden = true;
        emailError.hidden = true;
        captchaError.hidden = true;
        description.setAttribute('aria-invalid', 'false');
        email.setAttribute('aria-invalid', 'false');
        captchaInput.setAttribute('aria-invalid', 'false');
        setStatus('success', '¡Gracias! Recibimos tu sugerencia.');
        void loadCaptcha();
      } else if (response.status === 429) {
        setStatus('error', 'Enviaste varias sugerencias seguidas. Esperá unos minutos e intentá de nuevo.');
      } else {
        // Mensaje según el motivo que informa el servidor (campo "error").
        const body = (await response.json().catch(() => null)) as { error?: string } | null;
        if (response.status === 400 && body?.error === 'captcha') {
          captchaInput.value = '';
          captchaError.textContent = 'La respuesta no es correcta o la pregunta venció. Respondé la nueva pregunta.';
          captchaError.hidden = false;
          captchaInput.setAttribute('aria-invalid', 'true');
          setStatus('error', 'Revisá la pregunta de verificación e intentá de nuevo.');
          void loadCaptcha();
        } else if (response.status === 400 && body?.error === 'description') {
          setStatus('error', `La sugerencia tiene que tener entre ${DESCRIPTION_MIN} y ${DESCRIPTION_MAX} caracteres.`);
        } else if (response.status === 400 && body?.error === 'email') {
          setStatus('error', 'Revisá el correo: el formato no es válido.');
        } else if (response.status === 503) {
          setStatus('error', 'Hay muchas sugerencias pendientes. Intentá de nuevo en unos minutos.');
        } else {
          setStatus('error', 'No pudimos enviar tu sugerencia. Revisá los datos e intentá de nuevo.');
        }
      }
    } catch (error) {
      const timedOut = error instanceof DOMException && error.name === 'AbortError';
      setStatus(
        'error',
        timedOut
          ? 'El envío tardó demasiado. Revisá tu conexión e intentá de nuevo.'
          : 'No pudimos enviar tu sugerencia. Revisá tu conexión e intentá de nuevo.',
      );
    } finally {
      window.clearTimeout(timer);
      sending = false;
      submit.textContent = 'Enviar sugerencia';
      submit.removeAttribute('aria-busy');
      submit.disabled = endpoint === null;
    }
  });
}
