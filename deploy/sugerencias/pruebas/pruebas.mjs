// Pruebas del endpoint de sugerencias. Solo local: levanta server.mjs contra sink.mjs (SMTP de prueba
// en 127.0.0.1). No se envía ningún correo real.
// Uso: node --test pruebas/pruebas.mjs   (desde deploy/sugerencias)

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHmac } from 'node:crypto';
import { readFileSync, rmSync, existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const aquí = dirname(fileURLToPath(import.meta.url));
const raiz = join(aquí, '..');
const SECRET = 'prueba-secreto-solo-local';

const esperar = (ms) => new Promise((r) => setTimeout(r, ms));
const puertoLibre = () => 20000 + Math.floor(Math.random() * 20000);

async function levantar(sinkPort, extra = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'sug-'));
  const registro = join(dir, 'correos.jsonl');
  const sink = spawn(process.execPath, [join(aquí, 'sink.mjs'), registro], {
    env: { ...process.env, SINK_PORT: String(sinkPort) },
    stdio: 'ignore',
  });
  await esperar(300);
  const port = puertoLibre();
  const server = spawn(process.execPath, [join(raiz, 'server.mjs')], {
    env: {
      PATH: process.env.PATH,
      PORT: String(port),
      SMTP_HOST: '127.0.0.1',
      SMTP_PORT: String(sinkPort),
      SMTP_SECURE: 'false',
      MAIL_FROM: 'prueba@localhost',
      MAIL_TO: 'buzon@localhost',
      CAPTCHA_SECRET: SECRET,
      IP_SALT: 'sal-prueba',
      ...extra,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  await esperar(600);
  const base = `http://127.0.0.1:${port}/api/sugerencias`;
  const cerrar = async () => {
    server.kill();
    sink.kill();
    await esperar(100);
    rmSync(dir, { recursive: true, force: true });
  };
  const correos = () =>
    existsSync(registro)
      ? readFileSync(registro, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l))
      : [];
  return { base, cerrar, correos };
}

async function pedirCaptcha(base, headers = {}) {
  return fetch(`${base}/captcha`, { headers });
}

// Resuelve un captcha real leyendo la pregunta (como haría un cliente legítimo).
async function resolverCaptcha(base, headers = {}) {
  const r = await pedirCaptcha(base, headers);
  const { token, pregunta } = await r.json();
  const [a, b] = pregunta.match(/(\d+) \+ (\d+)/).slice(1).map(Number);
  return { token, respuesta: String(a + b) };
}

async function enviar(base, cuerpo, headers = {}) {
  return fetch(base, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(cuerpo),
  });
}

const sugerencia = (captcha, extra = {}) => ({
  description: 'Me gustaría una herramienta de prueba.',
  website: '',
  captchaToken: captcha.token,
  captchaAnswer: captcha.respuesta,
  ...extra,
});

// Firma un token con el mismo secreto, para casos de caducidad o manipulación.
function tokenFirmado(expira, suma) {
  const payload = `${expira}.${suma}`;
  return `${payload}.${createHmac('sha256', SECRET).update(payload).digest('hex')}`;
}

test('captcha válido: se acepta, se envía al buzón y llega el agradecimiento', async () => {
  const s = await levantar(2601, { PER_IP_MAX: '5' });
  try {
    const c = await resolverCaptcha(s.base);
    const r = await enviar(s.base, sugerencia(c, { email: 'persona@ejemplo.com' }));
    assert.equal(r.status, 202);
    await esperar(1500);
    const correos = s.correos();
    assert.ok(correos.some((m) => m.to.includes('buzon@localhost')), 'aviso al propietario');
    assert.ok(correos.some((m) => m.to.includes('persona@ejemplo.com') && m.imagenIncrustada), 'agradecimiento');
  } finally {
    await s.cerrar();
  }
});

test('captcha inválido, vencido, manipulado y reutilizado se rechazan', async () => {
  const s = await levantar(2602, { PER_IP_MAX: '20' });
  try {
    // Respuesta incorrecta
    const malo = await resolverCaptcha(s.base);
    let r = await enviar(s.base, sugerencia({ token: malo.token, respuesta: '999' }));
    assert.equal(r.status, 400);
    assert.equal((await r.json()).error, 'captcha');

    // Reutilización: un token correcto solo sirve una vez (una respuesta incorrecta no lo consume).
    const bueno = await resolverCaptcha(s.base);
    r = await enviar(s.base, sugerencia(bueno));
    assert.equal(r.status, 202);
    r = await enviar(s.base, sugerencia(bueno));
    assert.equal(r.status, 400, 'reutilizado');
    assert.equal((await r.json()).error, 'captcha');

    // Vencido (firmado correctamente, pero con expiración pasada)
    const vencido = tokenFirmado(Date.now() - 1000, '7');
    r = await enviar(s.base, sugerencia({ token: vencido, respuesta: '7' }));
    assert.equal(r.status, 400);
    assert.equal((await r.json()).error, 'captcha');

    // Manipulado: se cambia la suma sin re-firmar
    const [exp, , firma] = (await resolverCaptcha(s.base)).token.split('.');
    r = await enviar(s.base, sugerencia({ token: `${exp}.5.${firma}`, respuesta: '5' }));
    assert.equal(r.status, 400);
    assert.equal((await r.json()).error, 'captcha');

    // Sin token
    r = await enviar(s.base, { description: 'Texto suficientemente largo', website: '' });
    assert.equal(r.status, 400);
  } finally {
    await s.cerrar();
  }
});

test('GET /captcha limita por IP y responde 429 con Retry-After', async () => {
  const s = await levantar(2603, { CAPTCHA_PER_IP_MAX: '3' });
  try {
    for (let i = 0; i < 3; i++) assert.equal((await pedirCaptcha(s.base)).status, 200);
    const r = await pedirCaptcha(s.base);
    assert.equal(r.status, 429);
    const espera = Number(r.headers.get('Retry-After'));
    assert.ok(espera >= 1 && espera <= 600, `Retry-After razonable: ${espera}`);
    assert.equal((await r.json()).error, 'rate');
  } finally {
    await s.cerrar();
  }
});

test('límite por IP del POST: la cuarta sugerencia se rechaza con 429', async () => {
  const s = await levantar(2604, { PER_IP_MAX: '3', CAPTCHA_PER_IP_MAX: '100' });
  try {
    for (let i = 0; i < 3; i++) {
      const c = await resolverCaptcha(s.base);
      assert.equal((await enviar(s.base, sugerencia(c))).status, 202);
    }
    const c = await resolverCaptcha(s.base);
    assert.equal((await enviar(s.base, sugerencia(c))).status, 429);
  } finally {
    await s.cerrar();
  }
});

test('límite global del POST responde 429', async () => {
  const s = await levantar(2605, { GLOBAL_MAX: '2', PER_IP_MAX: '100', CAPTCHA_PER_IP_MAX: '100' });
  try {
    for (let i = 0; i < 2; i++) {
      const c = await resolverCaptcha(s.base);
      assert.equal((await enviar(s.base, sugerencia(c))).status, 202);
    }
    const c = await resolverCaptcha(s.base);
    assert.equal((await enviar(s.base, sugerencia(c))).status, 429);
  } finally {
    await s.cerrar();
  }
});

test('X-Forwarded-For: solo cuenta el último valor (el que añade Caddy)', async () => {
  const s = await levantar(2606, { PER_IP_MAX: '2', CAPTCHA_PER_IP_MAX: '100' });
  try {
    // Mismo último valor (IP real de Caddy) con cabeceras iniciales falsificadas distintas: cuenta igual.
    const ipReal = '203.0.113.7';
    const estadosMismaIp = [];
    for (let i = 0; i < 3; i++) {
      const c = await resolverCaptcha(s.base, { 'X-Forwarded-For': `10.0.0.${i}, ${ipReal}` });
      estadosMismaIp.push((await enviar(s.base, sugerencia(c), { 'X-Forwarded-For': `10.0.0.${i}, ${ipReal}` })).status);
    }
    assert.deepEqual(estadosMismaIp, [202, 202, 429]);

    // Otra IP real (último valor distinto) no comparte el cupo.
    const c = await resolverCaptcha(s.base, { 'X-Forwarded-For': '198.51.100.9' });
    assert.equal((await enviar(s.base, sugerencia(c), { 'X-Forwarded-For': '198.51.100.9' })).status, 202);
  } finally {
    await s.cerrar();
  }
});

test('honeypot: responde 202 sin encolar ni enviar correo', async () => {
  const s = await levantar(2607, { PER_IP_MAX: '5' });
  try {
    const c = await resolverCaptcha(s.base);
    const r = await enviar(s.base, sugerencia(c, { website: 'http://spam.example' }));
    assert.equal(r.status, 202);
    await esperar(800);
    assert.equal(s.correos().length, 0);
  } finally {
    await s.cerrar();
  }
});

test('el formulario sigue validando campos y el método', async () => {
  const s = await levantar(2608);
  try {
    const corto = await enviar(s.base, { description: 'corto', website: '' });
    assert.equal(corto.status, 400);
    const r = await fetch(s.base, { method: 'GET' });
    assert.equal(r.status, 405);
  } finally {
    await s.cerrar();
  }
});
