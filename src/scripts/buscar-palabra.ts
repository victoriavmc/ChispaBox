/*
 * Buscar palabra: significado, sinónimos y antónimos en español.
 * La RAE no tiene API pública, así que las definiciones y las relaciones léxicas salen
 * de Wiktionary en español (API de MediaWiki con origin=*, licencia CC BY-SA), y el
 * botón «Ver en la RAE» abre la entrada oficial en una pestaña nueva.
 */


import '../styles/image-tools.css';

import { clearError, requireEl, setStatus, showError } from '../lib/ui-common';
import { suggestSpelling } from '../lib/spelling-es';
import { parseSpanishEntry, type SpanishEntry } from '../lib/wiktionary-es';

const WIKTIONARY_API = 'https://es.wiktionary.org/w/api.php';
const RAE_URL = 'https://dle.rae.es/';
const MAX_WORD_LENGTH = 60;

const form = requireEl<HTMLFormElement>('word-form');
const input = requireEl<HTMLInputElement>('word-input');
const runBtn = requireEl<HTMLButtonElement>('word-run');
const raeBtn = requireEl<HTMLAnchorElement>('word-rae');
const raeLink = requireEl<HTMLAnchorElement>('word-rae-link');
const wiktLink = requireEl<HTMLAnchorElement>('word-wikt-link');
const errorEl = requireEl<HTMLElement>('word-error');
const panel = requireEl<HTMLElement>('word-results-panel');
const definitionsEl = requireEl<HTMLOListElement>('word-definitions');
const definitionsEmpty = requireEl<HTMLElement>('word-definitions-empty');
const synonymsEl = requireEl<HTMLElement>('word-synonyms');
const antonymsEl = requireEl<HTMLElement>('word-antonyms');
const statusEl = requireEl<HTMLElement>('word-status');
const suggestEl = requireEl<HTMLElement>('word-suggest');
const suggestBodyEl = requireEl<HTMLElement>('word-suggest-body');

const MAX_SIMILAR = 6;

interface Suggestions {
  /** Corrección que propone el buscador de Wiktionary («¿Quisiste decir…?»), si la hay. */
  suggestion: string | null;
  /** Títulos de artículos parecidos a lo escrito. */
  similar: string[];
}

let lastRequest = 0;

/** Pide el texto del artículo de Wiktionary en español. Devuelve null si no existe. */
async function fetchEntry(word: string): Promise<SpanishEntry | null> {
  const params = new URLSearchParams({
    action: 'query',
    titles: word,
    prop: 'extracts',
    explaintext: '1',
    redirects: '1',
    format: 'json',
    origin: '*',
  });
  const response = await fetch(`${WIKTIONARY_API}?${params.toString()}`);
  if (!response.ok) throw new Error(`Wiktionary respondió ${response.status}`);
  const data = (await response.json()) as {
    query?: { pages?: Record<string, { missing?: unknown; extract?: string }> };
  };
  const page = Object.values(data.query?.pages ?? {})[0];
  if (!page || 'missing' in page || typeof page.extract !== 'string') return null;
  return parseSpanishEntry(page.extract);
}

/** Wiktionary distingue mayúsculas en los títulos («PRUEBA» no existe, «prueba» sí).
 *  Busca la palabra tal como se escribió y, si no hay artículo, en minúsculas. */
async function fetchEntryAnyCase(word: string): Promise<{ entry: SpanishEntry | null; title: string }> {
  const candidates = Array.from(new Set([word, word.toLowerCase()]));
  for (const candidate of candidates) {
    const entry = await fetchEntry(candidate);
    if (entry) return { entry, title: candidate };
  }
  return { entry: null, title: word };
}

/** Corrección que da el propio buscador de Wiktionary, y artículos que coinciden parcialmente. */
async function fetchSearchHints(word: string): Promise<Suggestions> {
  const params = new URLSearchParams({
    action: 'query',
    list: 'search',
    srsearch: word,
    srlimit: String(MAX_SIMILAR + 1),
    srinfo: 'suggestion',
    format: 'json',
    origin: '*',
  });
  const response = await fetch(`${WIKTIONARY_API}?${params.toString()}`);
  if (!response.ok) throw new Error(`Wiktionary respondió ${response.status}`);
  const data = (await response.json()) as {
    query?: { search?: { title: string }[] };
    searchinfo?: { suggestion?: string };
  };
  const lower = word.toLowerCase();
  const suggestion = data.searchinfo?.suggestion?.trim() || null;
  const similar = Array.from(new Set((data.query?.search ?? []).map((r) => r.title)))
    .filter((title) => title.toLowerCase() !== lower)
    .slice(0, MAX_SIMILAR);
  return {
    suggestion: suggestion && suggestion.toLowerCase() !== lower ? suggestion : null,
    similar,
  };
}

/** Devuelve de cuáles de los títulos existe un artículo en Wiktionary (en lotes de 50). */
async function findExistingTitles(titles: string[]): Promise<string[]> {
  const batches: string[][] = [];
  for (let i = 0; i < titles.length; i += 50) batches.push(titles.slice(i, i + 50));
  const found = await Promise.all(
    batches.map(async (batch) => {
      const params = new URLSearchParams({
        action: 'query',
        titles: batch.join('|'),
        format: 'json',
        origin: '*',
      });
      const response = await fetch(`${WIKTIONARY_API}?${params.toString()}`);
      if (!response.ok) return [] as string[];
      const data = (await response.json()) as {
        query?: { pages?: Record<string, { title: string; missing?: unknown }> };
      };
      return Object.values(data.query?.pages ?? {})
        .filter((page) => !('missing' in page))
        .map((page) => page.title);
    }),
  );
  return found.flat();
}

/** Corrige una palabra mal escrita: primero el buscador de Wiktionary; si no sugiere nada,
 *  usa las sugerencias de nspell y se queda con las que tienen entrada en español en Wiktionary. */
async function fetchSuggestions(word: string): Promise<Suggestions> {
  const hints = await fetchSearchHints(word);
  if (hints.suggestion || hints.similar.length > 0) return hints;

  const existing = await findExistingTitles(await suggestSpelling(word));
  const spanish: string[] = [];
  for (const title of existing) {
    const entry = await fetchEntry(title).catch(() => null);
    if (entry?.hasSpanish) spanish.push(title);
  }
  const [first, ...rest] = spanish;
  return {
    suggestion: first ?? null,
    similar: rest.slice(0, MAX_SIMILAR),
  };
}

/** Pone el término en el campo y lanza la búsqueda. */
function searchFor(term: string): void {
  input.value = term;
  form.requestSubmit();
}

function makeTermButton(term: string): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'word-term-btn';
  button.textContent = term;
  button.addEventListener('click', () => searchFor(term));
  return button;
}

function hideSuggestions(): void {
  suggestEl.hidden = true;
  suggestBodyEl.replaceChildren();
}

function renderSuggestions(hints: Suggestions): void {
  suggestBodyEl.replaceChildren();
  if (!hints.suggestion && hints.similar.length === 0) {
    suggestEl.hidden = true;
    return;
  }
  if (hints.suggestion) {
    const lead = document.createElement('p');
    lead.className = 'word-suggest__lead';
    lead.append('¿Quisiste decir ', makeTermButton(hints.suggestion), '?');
    suggestBodyEl.append(lead);
  }
  if (hints.similar.length > 0) {
    const label = document.createElement('p');
    label.className = 'word-note';
    label.textContent = 'Palabras parecidas (tocá una para buscarla):';
    const list = document.createElement('ul');
    list.className = 'word-chips';
    for (const title of hints.similar) {
      const item = document.createElement('li');
      item.append(makeTermButton(title));
      list.append(item);
    }
    suggestBodyEl.append(label, list);
  }
  suggestEl.hidden = false;
}

function renderList(target: HTMLElement, words: string[], empty: string): void {
  target.replaceChildren();
  if (words.length === 0) {
    const item = document.createElement('li');
    item.className = 'word-empty';
    item.textContent = empty;
    target.append(item);
    return;
  }
  for (const word of words) {
    const item = document.createElement('li');
    item.textContent = word;
    target.append(item);
  }
}

function renderEntry(entry: SpanishEntry): void {
  definitionsEl.replaceChildren();
  for (const sense of entry.senses) {
    const item = document.createElement('li');
    if (sense.partOfSpeech) {
      const tag = document.createElement('span');
      tag.className = 'word-pos';
      tag.textContent = sense.partOfSpeech;
      item.append(tag);
    }
    item.append(document.createTextNode(sense.definition));
    definitionsEl.append(item);
  }
  definitionsEl.hidden = entry.senses.length === 0;
  definitionsEmpty.hidden = entry.senses.length > 0;
  definitionsEmpty.textContent = 'Wiktionary no tiene definiciones en español para esta palabra.';

  renderList(synonymsEl, entry.synonyms, 'No se encontraron sinónimos.');
  renderList(antonymsEl, entry.antonyms, 'No se encontraron antónimos.');
}

async function onSearch(event: SubmitEvent): Promise<void> {
  event.preventDefault();
  const word = input.value.trim().replace(/\s+/g, ' ');
  clearError(errorEl);
  hideSuggestions();
  if (!word) {
    showError(errorEl, 'Escribí una palabra para buscar.');
    return;
  }
  if (word.length > MAX_WORD_LENGTH) {
    showError(errorEl, `La palabra no puede tener más de ${MAX_WORD_LENGTH} caracteres.`);
    return;
  }

  const requestId = ++lastRequest;
  runBtn.disabled = true;
  setStatus(statusEl, 'Buscando…');
  raeBtn.href = `${RAE_URL}${encodeURIComponent(word)}`;
  raeBtn.hidden = false;
  raeLink.href = raeBtn.href;

  try {
    const { entry, title } = await fetchEntryAnyCase(word);
    if (requestId !== lastRequest) return;
    panel.hidden = false;
    // Enlace a la entrada original solo cuando existe; no cambia la búsqueda.
    wiktLink.hidden = !entry;
    if (entry) wiktLink.href = `https://es.wiktionary.org/wiki/${encodeURIComponent(title)}`;
    if (!entry) {
      definitionsEl.replaceChildren();
      definitionsEl.hidden = true;
      definitionsEmpty.hidden = false;
      definitionsEmpty.textContent = 'No encontramos esa palabra en Wiktionary. Probá la RAE con el botón.';
      renderList(synonymsEl, [], 'Sin datos.');
      renderList(antonymsEl, [], 'Sin datos.');
      setStatus(statusEl, 'Sin resultados.');
      let hints: Suggestions = { suggestion: null, similar: [] };
      try {
        hints = await fetchSuggestions(word);
      } catch (err) {
        console.error(err);
      }
      if (requestId !== lastRequest) return;
      renderSuggestions(hints);
      return;
    }
    renderEntry(entry);
    setStatus(statusEl, `Resultados para «${word}».`);
  } catch (err) {
    if (requestId !== lastRequest) return;
    console.error(err);
    showError(errorEl, 'No se pudo consultar ahora. Revisá la conexión e intentá de nuevo; también podés abrir la RAE.');
    setStatus(statusEl, '');
  } finally {
    if (requestId === lastRequest) runBtn.disabled = false;
  }
}

form.addEventListener('submit', (event) => void onSearch(event));
