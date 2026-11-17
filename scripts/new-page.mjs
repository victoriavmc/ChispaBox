// Crea una página nueva con el header y el footer compartidos.
// Uso: npm run new-page -- <nombre-en-minusculas> "<Título>" ["<descripción>"]
// Ejemplo: npm run new-page -- conversor-audio "Conversor de audio" "Convierte audios entre formatos."

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const TEMPLATE = join(ROOT, 'templates', 'page.html');

const [, , rawSlug, rawTitle, rawDescription] = process.argv;
const slug = (rawSlug ?? '').trim().toLowerCase();

if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug)) {
  console.error('Uso: npm run new-page -- <nombre-en-minusculas> "<Título>" ["<descripción>"]');
  console.error('El nombre solo puede tener letras minúsculas, números y guiones (ej.: conversor-audio).');
  process.exit(1);
}

const dir = join(ROOT, 'paginas', slug);
const target = join(dir, 'index.html');
if (existsSync(target)) {
  console.error(`Ya existe paginas/${slug}/index.html; elige otro nombre.`);
  process.exit(1);
}

const escapeHtml = (s) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const title = escapeHtml(rawTitle?.trim() || slug.replace(/-/g, ' ').replace(/^./, (c) => c.toUpperCase()));
const description = escapeHtml(rawDescription?.trim() || title);

const html = readFileSync(TEMPLATE, 'utf8')
  .replaceAll('{{title}}', title)
  .replaceAll('{{description}}', description);

mkdirSync(dir, { recursive: true });
writeFileSync(target, html);
console.log(`Página creada: paginas/${slug}/index.html`);
console.log('Se incluye automáticamente el header y el footer compartidos (templates/).');
console.log(`Para verla: npm run dev  →  http://127.0.0.1:5173/paginas/${slug}/index.html`);
