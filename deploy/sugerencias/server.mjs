// Endpoint de sugerencias de ChispaBox. Sin base de datos ni almacenamiento persistente.
// GET  /api/sugerencias/captcha  -> { token, pregunta } (captcha propio, sin terceros)
// POST /api/sugerencias  (JSON: { description, email?, website, captchaToken, captchaAnswer })
//
// La respuesta es inmediata: la sugerencia se valida, se pone en una cola en memoria y un
// proceso en segundo plano la envía al buzón del propietario y, si hubo correo válido, un único
// agradecimiento. Así el visitante no espera a SMTP.
//
// No guarda sugerencias ni correos fuera de la cola, no guarda IP completas y no registra contenido.

import http from 'node:http';
import { createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import nodemailer from 'nodemailer';

const env = process.env;
const PORT = Number(env.PORT || 3000);
const MAX_BODY = 8 * 1024; // bytes
const DESC_MIN = 10;
const DESC_MAX = 1000;
const EMAIL_MAX = 254;
const EMAIL_RE = /^[^\s@<>()[\]\\,;:"]+@[^\s@<>()[\]\\,;:"]+\.[^\s@<>()[\]\\,;:"]{2,}$/;
const IP_SALT = env.IP_SALT || randomBytes(16).toString('hex'); // solo para limitar, no se guarda
// Origen permitido (p. ej. https://tu-dominio.example). Si se define, solo se aceptan peticiones de ese origen.
const ALLOWED_ORIGIN = (env.ALLOWED_ORIGIN || '').trim();
// Captcha propio (sin terceros): pregunta matemática firmada con HMAC. Si no se define CAPTCHA_SECRET,
// se genera al arrancar: los retos pendientes caducan al reiniciar, lo que es aceptable.
const CAPTCHA_SECRET = env.CAPTCHA_SECRET || randomBytes(32).toString('hex');
const CAPTCHA_TTL_MS = 5 * 60 * 1000;
const captchaUsados = new Map(); // token -> expiración; cada respuesta sirve una sola vez

// Límites de entrada (en memoria; se pierden al reiniciar, lo que es aceptable).
const DAY_MS = 24 * 60 * 60 * 1000;
const PER_IP_WINDOW_MS = DAY_MS;
// Valores por defecto de producción. Se pueden cambiar con variables de entorno (p. ej. para pruebas locales).
const PER_IP_MAX = Number(env.PER_IP_MAX || 3); // sugerencias por IP y día (las IP compartidas por NAT también quedan limitadas a este tope)
const GLOBAL_WINDOW_MS = 60 * 60 * 1000;
const GLOBAL_MAX = Number(env.GLOBAL_MAX || 60); // sugerencias aceptadas en total por hora
const AUTOREPLY_MAX = 20; // agradecimientos enviados en total por hora (evita usarlo como correo masivo)
const AUTOREPLY_PER_EMAIL_MAX = 1; // como máximo un agradecimiento por dirección y día (nadie puede usar el formulario para escribir repetidamente a una persona)

// Agradecimiento: texto y imagen incrustada (cid). El texto de usuario nunca entra en el HTML.
const GRACIAS_ASUNTO = 'Gracias por tu sugerencia en ChispaBox';
const GRACIAS_TEXTO = [
  '¡Muchas gracias por tomarte el tiempo de enviarnos tu sugerencia! ❤️',
  '',
  'La vamos a revisar lo antes posible y evaluar cómo podemos implementarla para seguir mejorando la plataforma.',
  '',
  '¡Tu opinión nos ayuda a crecer y ofrecer una mejor experiencia! 🚀',
  '',
  '¡Gracias por ser parte de este proyecto!',
].join('\n');
const GRACIAS_HTML = `<!doctype html><html lang="es"><body style="margin:0;background:#f6f1f1;font-family:Arial,Helvetica,sans-serif;color:#2b2326">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:12px">
<tr><td align="center" style="padding:24px 24px 8px"><img src="cid:gracias-chispabox" width="420" alt="ChispaBox" style="display:block;max-width:100%;height:auto;border:0"></td></tr>
<tr><td style="padding:8px 28px 28px;font-size:16px;line-height:1.5">
<p style="margin:0 0 14px">¡Muchas gracias por tomarte el tiempo de enviarnos tu sugerencia! ❤️</p>
<p style="margin:0 0 14px">La vamos a revisar lo antes posible y evaluar cómo podemos implementarla para seguir mejorando la plataforma.</p>
<p style="margin:0 0 14px">¡Tu opinión nos ayuda a crecer y ofrecer una mejor experiencia! 🚀</p>
<p style="margin:18px 0 0;font-weight:bold;color:#e61932">¡Gracias por ser parte de este proyecto!</p>
</td></tr>
<tr><td style="padding:12px 28px 20px;font-size:12px;color:#7a6f72">Mensaje automático. No hace falta responderlo.</td></tr>
</table></td></tr></table></body></html>`;
const GRACIAS_IMAGEN = fileURLToPath(new URL('./assets/gracias.png', import.meta.url));

// Cola y reintentos.
const QUEUE_MAX = 200; // trabajos pendientes; por encima se responde 503 sin aceptar más
const OWNER_RETRY_DELAYS_MS = [5_000, 30_000]; // reintentos del aviso al propietario ante fallos transitorios

const hits = new Map();
const hitsFor = (key, windowMs) => {
  const now = Date.now();
  const list = (hits.get(key) || []).filter((t) => now - t < windowMs);
  hits.set(key, list);
  return list;
};
const register = (key) => hits.set(key, [...(hits.get(key) || []), Date.now()]);

// Limpieza periódica: quita las claves sin hits recientes para que el mapa no crezca sin límite.
setInterval(() => {
  const now = Date.now();
  for (const [key, list] of hits) {
    const frescos = list.filter((t) => now - t < DAY_MS);
    if (frescos.length) hits.set(key, frescos);
    else hits.delete(key);
  }
  for (const [token, expira] of captchaUsados) {
    if (expira < now) captchaUsados.delete(token);
  }
}, 10 * 60 * 1000).unref();

const hashIp = (ip) => createHash('sha256').update(IP_SALT + ip).digest('hex');

// Caddy añade la IP real del cliente al final de X-Forwarded-For. Solo se confía en el último valor.
const clientIp = (req) => {
  const xff = String(req.headers['x-forwarded-for'] || '').split(',').map((s) => s.trim()).filter(Boolean);
  return xff.length ? xff[xff.length - 1] : req.socket.remoteAddress || 'desconocida';
};

// ---------- Captcha propio ----------

const firmarReto = (texto) => createHmac('sha256', CAPTCHA_SECRET).update(texto).digest('hex');

// Devuelve un token firmado (expiración y suma, sin revelar la suma en claro) y la pregunta.
const nuevoReto = () => {
  const a = randomInt(1, 10);
  const b = randomInt(1, 10);
  const payload = `${Date.now() + CAPTCHA_TTL_MS}.${a + b}`;
  return { token: `${payload}.${firmarReto(payload)}`, pregunta: `¿Cuánto es ${a} + ${b}?` };
};

// Comprueba firma, caducidad, respuesta y que el token no se haya usado antes.
const verificarReto = (token, respuesta) => {
  if (typeof token !== 'string' || typeof respuesta !== 'string') return false;
  const partes = token.split('.');
  if (partes.length !== 3) return false;
  const [expira, suma, firma] = partes;
  const esperada = firmarReto(`${expira}.${suma}`);
  if (firma.length !== esperada.length || !timingSafeEqual(Buffer.from(firma), Buffer.from(esperada))) return false;
  if (Number(expira) < Date.now() || captchaUsados.has(token)) return false;
  if (respuesta.trim() !== suma) return false;
  captchaUsados.set(token, Number(expira));
  return true;
};

// Elimina cualquier carácter de control para impedir inyección de cabeceras de correo.
const cleanLine = (s, max) => String(s).replace(/[\u0000-\u001F\u007F]+/g, ' ').trim().slice(0, max);

const transport = nodemailer.createTransport({
  host: env.SMTP_HOST,
  port: Number(env.SMTP_PORT || 465),
  secure: String(env.SMTP_SECURE || 'true') === 'true',
  // Sin autenticación solo en pruebas locales (servidor SMTP de prueba sin AUTH).
  ...(env.SMTP_USER ? { auth: { user: env.SMTP_USER, pass: env.SMTP_PASS } } : {}),
  connectionTimeout: 10_000,
  socketTimeout: 15_000,
});

const send = (json, res, status) => {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Content-Security-Policy': "default-src 'none'",
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
  });
  res.end(JSON.stringify(json));
};

// Lee el cuerpo con tope de tamaño. Al superarlo rechaza, pero sigue consumiendo el flujo
// para poder responder 413 (cerrar el socket antes provocaba un error de conexión en el navegador).
const readBody = (req) =>
  new Promise((resolve, reject) => {
    let size = 0;
    let tooLarge = false;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY) {
        if (!tooLarge) reject(Object.assign(new Error('too large'), { status: 413 }));
        tooLarge = true;
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (!tooLarge) resolve(Buffer.concat(chunks).toString('utf8'));
    });
    req.on('error', reject);
  });

// ---------- Cola en segundo plano ----------

const cola = [];
let procesando = false;
const esperar = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Un fallo es transitorio si el servidor SMTP responde 4xx o si no hubo respuesta (red, timeout).
const esTransitorio = (err) => !err.responseCode || (err.responseCode >= 400 && err.responseCode < 500);

async function avisarPropietario(sugerencia) {
  const texto =
    cleanLine(sugerencia.description, DESC_MAX) +
    (sugerencia.email ? `\n\nCorreo de contacto: ${sugerencia.email}` : '\n\n(sin correo de contacto)');
  const mensaje = {
    from: env.MAIL_FROM,
    to: env.MAIL_TO,
    subject: 'ChispaBox: nueva sugerencia',
    text: texto,
    ...(sugerencia.email ? { replyTo: sugerencia.email } : {}),
    headers: { 'X-Auto-Response-Suppress': 'All', 'Auto-Submitted': 'auto-generated' },
  };
  for (let intento = 0; ; intento++) {
    try {
      await transport.sendMail(mensaje);
      return true;
    } catch (err) {
      const transitorio = esTransitorio(err);
      console.error('sugerencia: fallo SMTP (propietario)', err.responseCode || err.code || err.name, `intento ${intento + 1}`);
      if (!transitorio || intento >= OWNER_RETRY_DELAYS_MS.length) return false;
      await esperar(OWNER_RETRY_DELAYS_MS[intento]);
    }
  }
}

async function agradecer(email) {
  const claveCorreo = `mail:${hashIp(email.toLowerCase())}`;
  if (hitsFor(claveCorreo, DAY_MS).length >= AUTOREPLY_PER_EMAIL_MAX) return;
  if (hitsFor('autoreply', GLOBAL_WINDOW_MS).length >= AUTOREPLY_MAX) return;
  register(claveCorreo);
  register('autoreply');
  try {
    await transport.sendMail({
      from: env.MAIL_FROM,
      to: email,
      subject: GRACIAS_ASUNTO,
      text: GRACIAS_TEXTO,
      html: GRACIAS_HTML,
      attachments: [{ filename: 'chispabox.png', path: GRACIAS_IMAGEN, cid: 'gracias-chispabox', contentType: 'image/png' }],
      headers: { 'X-Auto-Response-Suppress': 'All', 'Auto-Submitted': 'auto-replied' },
    });
  } catch (err) {
    // Sin reintentos: un agradecimiento duplicado sería peor que uno perdido.
    console.error('sugerencia: fallo SMTP (agradecimiento)', err.responseCode || err.code || err.name);
  }
}

async function procesarCola() {
  if (procesando) return;
  procesando = true;
  try {
    while (cola.length > 0) {
      const sugerencia = cola.shift();
      const enviada = await avisarPropietario(sugerencia);
      // El agradecimiento solo si el aviso al propietario se aceptó por SMTP y hubo correo válido.
      if (enviada && sugerencia.email) await agradecer(sugerencia.email);
    }
  } finally {
    procesando = false;
  }
}

// ---------- HTTP ----------

const server = http.createServer(async (req, res) => {
  const ruta = (req.url || '').split('?')[0];
  if (ruta === '/api/sugerencias/captcha') {
    if (req.method !== 'GET') return send({ error: 'method' }, res, 405);
    return send(nuevoReto(), res, 200);
  }
  if (ruta !== '/api/sugerencias') return send({ error: 'not found' }, res, 404);
  if (req.method !== 'POST') return send({ error: 'method' }, res, 405);
  if (ALLOWED_ORIGIN && req.headers.origin !== ALLOWED_ORIGIN) return send({ error: 'origin' }, res, 403);
  if (!String(req.headers['content-type'] || '').startsWith('application/json')) {
    return send({ error: 'content-type' }, res, 415);
  }

  let data;
  try {
    data = JSON.parse(await readBody(req));
  } catch (err) {
    return send({ error: 'body' }, res, err.status === 413 ? 413 : 400);
  }

  // Honeypot: un bot rellena el campo oculto. Se responde como si fuese válido, sin encolar nada.
  if (typeof data?.website === 'string' && data.website.trim() !== '') {
    return send({ ok: true }, res, 202);
  }

  const description = typeof data?.description === 'string' ? data.description.trim() : '';
  const emailRaw = typeof data?.email === 'string' ? data.email.trim() : '';
  if (description.length < DESC_MIN || description.length > DESC_MAX) return send({ error: 'description' }, res, 400);
  if (emailRaw && (emailRaw.length > EMAIL_MAX || !EMAIL_RE.test(emailRaw) || /[\u0000-\u001F\u007F]/.test(emailRaw))) {
    return send({ error: 'email' }, res, 400);
  }

  // Captcha: se comprueba antes de contar el envío para que un fallo no consuma el cupo.
  if (!verificarReto(data?.captchaToken, typeof data?.captchaAnswer === 'string' ? data.captchaAnswer : '')) {
    return send({ error: 'captcha' }, res, 400);
  }

  const ipKey = hashIp(clientIp(req));
  if (hitsFor(`ip:${ipKey}`, PER_IP_WINDOW_MS).length >= PER_IP_MAX) return send({ error: 'rate' }, res, 429);
  if (hitsFor('global', GLOBAL_WINDOW_MS).length >= GLOBAL_MAX) return send({ error: 'rate' }, res, 429);
  if (cola.length >= QUEUE_MAX) return send({ error: 'busy' }, res, 503);

  register(`ip:${ipKey}`);
  register('global');
  cola.push({ description, email: emailRaw || null });
  void procesarCola();

  // 202: la sugerencia quedó aceptada para enviarse. No significa que ya esté en el buzón.
  return send({ ok: true }, res, 202);
});

server.requestTimeout = 15_000;
server.headersTimeout = 10_000;
server.listen(PORT, '0.0.0.0', () => console.log(`sugerencias escuchando en ${PORT}`));
