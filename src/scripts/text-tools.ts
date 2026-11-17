/*
 * Contador y limpiador de texto.
 * Todo corre en el navegador: sin llamadas a servidores ni persistencia del contenido.
 * Las funciones puras (conteo, limpieza y búsqueda) están separadas del DOM para poder probarlas.
 */

export interface CleanOptions {
  /** Muletillas a eliminar (la comparación ignora mayúsculas). */
  readonly fillers: readonly string[];
  readonly removeFillers: boolean;
  readonly removeHashes: boolean;
  readonly removeAsterisks: boolean;
  readonly removeUnderscores: boolean;
  readonly removeTripleHyphens: boolean;
  readonly removeHyphens: boolean;
  readonly normalizeSpaces: boolean;
  readonly collapseNewlines: boolean;
}

const MAX_FILLERS = 50;
const MAX_FILLER_LENGTH = 40;
const MAX_HISTORY = 50;

/** Caracteres que forman parte de una palabra: letras (con acentos), números y guion bajo. */
const WORD_CHAR = String.raw`\p{L}\p{N}_`;

/* ---------- Conteo ---------- */

export function countWords(text: string): number {
  const trimmed = text.trim();
  return trimmed === '' ? 0 : trimmed.split(/\s+/u).length;
}

/** Cuenta caracteres Unicode (un emoji cuenta como uno), incluyendo espacios. */
export function countChars(text: string): number {
  return [...text].length;
}

/** Cuenta caracteres Unicode excluyendo cualquier tipo de espacio. */
export function countCharsWithoutSpaces(text: string): number {
  return [...text.replace(/\s/gu, '')].length;
}

/* ---------- Limpieza ---------- */

/** Convierte el texto de la lista de muletillas (separadas por coma) en valores únicos y válidos. */
export function parseFillers(raw: string): string[] {
  const unique = new Set<string>();
  for (const part of raw.split(',')) {
    const value = part.trim().slice(0, MAX_FILLER_LENGTH);
    if (value !== '') {
      unique.add(value.toLocaleLowerCase('es'));
    }
    if (unique.size >= MAX_FILLERS) {
      break;
    }
  }
  return [...unique];
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

/**
 * Elimina muletillas solo cuando aparecen como palabra completa.
 * No toca palabras que las contienen (por ejemplo, "hemos" con "em") ni acentos.
 * Al quitar una muletilla también quita su coma y ajusta los espacios:
 * - entre palabras deja un solo espacio ("hola eh mundo" → "hola mundo");
 * - al inicio o final de línea, o antes de un signo, no deja espacios sobrantes.
 */
export function removeFillers(text: string, fillers: readonly string[]): string {
  if (fillers.length === 0) {
    return text;
  }
  const alternation = [...fillers]
    .sort((a, b) => b.length - a.length)
    .map(escapeRegExp)
    .join('|');
  const pattern = new RegExp(
    `([ \\t]*)(?<![${WORD_CHAR}])(?:${alternation})(?![${WORD_CHAR}]),?([ \\t]*)`,
    'giu',
  );

  const replaced = text.replace(
    pattern,
    (match: string, lead: string, trail: string, offset: number, source: string) => {
      const atLineStart = offset === 0 || source.charAt(offset - 1) === '\n';
      const next = source.charAt(offset + match.length);
      const atLineEnd = next === '' || next === '\n';
      const beforePunctuation = /[.,;:!?)\]}]/u.test(next);
      if (atLineStart || atLineEnd || beforePunctuation) {
        return '';
      }
      return lead !== '' || trail !== '' ? ' ' : '';
    },
  );
  // Quita espacios que pudieran quedar al final de línea tras varias muletillas seguidas.
  return replaced.replace(/[ \t]+(?=\n|$)/gu, '');
}

/** Elimina todos los asteriscos. */
export function removeAsterisks(text: string): string {
  return text.replace(/\*/g, '');
}

/** Elimina todos los "#". */
export function removeHashes(text: string): string {
  return text.replace(/#/g, '');
}

/** Elimina todos los "_". */
export function removeUnderscores(text: string): string {
  return text.replace(/_/g, '');
}

/** Elimina las secuencias de tres o más guiones seguidos ("---"). */
export function removeTripleHyphens(text: string): string {
  return text.replace(/-{3,}/g, '');
}

/** Elimina todos los guiones, incluidos los que están dentro de palabras (ej. "pre-escolar"). */
export function removeHyphens(text: string): string {
  return text.replace(/-/g, '');
}

/** Reduce espacios y tabulaciones repetidos y quita espacios sobrantes al inicio y al final de cada línea. */
export function normalizeSpaces(text: string): string {
  return text
    .split(/\r?\n/)
    .map((line) => line.replace(/[ \t]{2,}/g, ' ').trim())
    .join('\n');
}

/** Deja como máximo una línea en blanco seguida y unifica los fines de línea. */
export function collapseNewlines(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .replace(/\n[ \t]+(?=\n)/g, '\n')
    .replace(/\n{3,}/g, '\n\n');
}

/** Aplica las reglas activas, en orden, sobre el texto. */
export function cleanText(input: string, options: CleanOptions): string {
  let output = input.replace(/\r\n?/g, '\n');
  if (options.removeFillers) {
    output = removeFillers(output, options.fillers);
  }
  if (options.removeAsterisks) {
    output = removeAsterisks(output);
  }
  if (options.removeHashes) {
    output = removeHashes(output);
  }
  if (options.removeUnderscores) {
    output = removeUnderscores(output);
  }
  if (options.removeTripleHyphens) {
    output = removeTripleHyphens(output);
  }
  if (options.removeHyphens) {
    output = removeHyphens(output);
  }
  if (options.normalizeSpaces) {
    output = normalizeSpaces(output);
  }
  if (options.collapseNewlines) {
    output = collapseNewlines(output);
  }
  return output;
}

/* ---------- Buscar y reemplazar ---------- */

/** Crea la expresión de búsqueda. Con wholeWord, solo coincide con palabras completas. */
export function buildSearchRegex(find: string, wholeWord: boolean): RegExp | null {
  if (find === '') {
    return null;
  }
  const core = escapeRegExp(find);
  const source = wholeWord ? `(?<![${WORD_CHAR}])${core}(?![${WORD_CHAR}])` : core;
  return new RegExp(source, 'giu');
}

/** Reemplaza todas las coincidencias. Con replaceWith vacío, las elimina. */
export function replaceAllMatches(
  text: string,
  find: string,
  replaceWith: string,
  wholeWord: boolean,
): { text: string; count: number } {
  const regex = buildSearchRegex(find, wholeWord);
  if (!regex) {
    return { text, count: 0 };
  }
  let count = 0;
  const out = text.replace(regex, () => {
    count += 1;
    return replaceWith;
  });
  return { text: out, count };
}

/** Cuenta las coincidencias de la búsqueda en el texto. */
export function countMatches(text: string, regex: RegExp | null): number {
  if (!regex) {
    return 0;
  }
  regex.lastIndex = 0;
  let count = 0;
  while (regex.exec(text) !== null) {
    count += 1;
  }
  return count;
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * Genera el HTML de la capa de resaltado: el mismo texto, con las coincidencias envueltas en <mark>.
 * Se usa detrás de un textarea transparente para mostrar el resaltado en tiempo real.
 */
export function highlightHtml(text: string, regex: RegExp | null): string {
  let html = '';
  let last = 0;
  if (regex) {
    regex.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = regex.exec(text)) !== null) {
      html += escapeHtml(text.slice(last, match.index)) + `<mark>${escapeHtml(match[0])}</mark>`;
      last = match.index + match[0].length;
    }
  }
  html += escapeHtml(text.slice(last));
  // Un salto de línea final no ocupa altura en la capa: se agrega un espacio para igualar al textarea.
  return text.endsWith('\n') ? html + ' ' : html;
}

/* ---------- Interfaz ---------- */

function requireElement<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) {
    throw new Error(`Elemento requerido no encontrado: ${selector}`);
  }
  return element;
}

export function initTextTools(): void {
  const input = requireElement<HTMLTextAreaElement>('#text-input');
  const highlight = requireElement<HTMLDivElement>('#text-highlight');
  // Las estadísticas y el botón Contar solo existen en la página de conteo.
  const wordCount = document.querySelector<HTMLOutputElement>('#word-count');
  const charCount = document.querySelector<HTMLOutputElement>('#char-count');
  const noSpaceCount = document.querySelector<HTMLOutputElement>('#nospace-count');
  const countButton = document.querySelector<HTMLButtonElement>('#btn-count');
  const cleanButton = requireElement<HTMLButtonElement>('#btn-clean');
  const undoButton = requireElement<HTMLButtonElement>('#btn-undo');
  const clearButton = requireElement<HTMLButtonElement>('#btn-clear');
  const copyButton = requireElement<HTMLButtonElement>('#btn-copy');
  const fillersInput = requireElement<HTMLInputElement>('#fillers-list');
  const ruleFillers = requireElement<HTMLInputElement>('#rule-fillers');
  const ruleHashes = requireElement<HTMLInputElement>('#rule-hashes');
  const ruleAsterisks = requireElement<HTMLInputElement>('#rule-asterisks');
  const ruleUnderscores = requireElement<HTMLInputElement>('#rule-underscores');
  const ruleTripleHyphens = requireElement<HTMLInputElement>('#rule-triple-hyphens');
  const ruleHyphens = requireElement<HTMLInputElement>('#rule-hyphens');
  const ruleSpaces = requireElement<HTMLInputElement>('#rule-spaces');
  const ruleNewlines = requireElement<HTMLInputElement>('#rule-newlines');
  const replaceFind = requireElement<HTMLInputElement>('#replace-find');
  const replaceWith = requireElement<HTMLInputElement>('#replace-with');
  const replaceWord = requireElement<HTMLInputElement>('#replace-word');
  const replaceButton = requireElement<HTMLButtonElement>('#btn-replace');
  const replaceCount = requireElement<HTMLElement>('#replace-count');
  const status = requireElement<HTMLElement>('#tool-status');

  /** Historial de versiones anteriores del texto para poder deshacer cambios. */
  const history: string[] = [];

  const setStatus = (message: string): void => {
    status.textContent = message;
  };

  const readOptions = (): CleanOptions => ({
    fillers: parseFillers(fillersInput.value),
    removeFillers: ruleFillers.checked,
    removeHashes: ruleHashes.checked,
    removeAsterisks: ruleAsterisks.checked,
    removeUnderscores: ruleUnderscores.checked,
    removeTripleHyphens: ruleTripleHyphens.checked,
    removeHyphens: ruleHyphens.checked,
    normalizeSpaces: ruleSpaces.checked,
    collapseNewlines: ruleNewlines.checked,
  });

  const updateButtons = (): void => {
    const hasText = input.value.length > 0;
    copyButton.disabled = !hasText;
    clearButton.disabled = !hasText;
    undoButton.disabled = history.length === 0;
  };

  const updateHighlight = (): void => {
    const regex = buildSearchRegex(replaceFind.value, replaceWord.checked);
    highlight.innerHTML = highlightHtml(input.value, regex);
    highlight.scrollTop = input.scrollTop;
    if (replaceFind.value === '') {
      replaceCount.textContent = '';
      return;
    }
    const total = countMatches(input.value, regex);
    replaceCount.textContent = total === 1 ? '1 coincidencia' : `${total} coincidencias`;
  };

  const updateCounts = (): void => {
    const text = input.value;
    if (wordCount && charCount) {
      wordCount.textContent = String(countWords(text));
      charCount.textContent = String(countChars(text));
    }
    if (noSpaceCount) {
      noSpaceCount.textContent = String(countCharsWithoutSpaces(text));
    }
    updateButtons();
    updateHighlight();
  };

  /** Reemplaza el contenido guardando la versión anterior para deshacer. */
  const replaceText = (value: string): void => {
    history.push(input.value);
    if (history.length > MAX_HISTORY) {
      history.shift();
    }
    input.value = value;
    updateCounts();
  };

  /** Aplica solo la eliminación de muletillas, con las muletillas de la lista. */
  const removeFillersNow = (): void => {
    if (!ruleFillers.checked) {
      setStatus('Activá «Eliminar muletillas» para usar este botón.');
      return;
    }
    const fillers = parseFillers(fillersInput.value);
    if (fillers.length === 0) {
      setStatus('Escribí al menos una muletilla para eliminar.');
      return;
    }
    const before = input.value;
    const after = removeFillers(before, fillers);
    if (after === before) {
      setStatus('No se encontraron muletillas en el texto.');
      return;
    }
    replaceText(after);
    setStatus('Se eliminaron las muletillas. Podés deshacerlo.');
  };

  const cleanCurrentText = (): void => {
    const options = readOptions();
    const anyRule =
      options.removeFillers ||
      options.removeHashes ||
      options.removeAsterisks ||
      options.removeUnderscores ||
      options.removeTripleHyphens ||
      options.removeHyphens ||
      options.normalizeSpaces ||
      options.collapseNewlines;
    if (!anyRule) {
      setStatus('Seleccioná al menos una regla de limpieza.');
      return;
    }

    const before = input.value;
    const after = cleanText(before, options);
    if (after === before) {
      setStatus('El texto ya estaba limpio con las reglas seleccionadas.');
      return;
    }

    replaceText(after);
    const removed = countChars(before) - countChars(after);
    setStatus(`Limpieza aplicada: se quitaron ${removed} caracteres. Podés deshacerla.`);
  };

  const replaceCurrentMatches = (): void => {
    if (replaceFind.value === '') {
      setStatus('Escribí en «Buscar» el texto que querés cambiar.');
      return;
    }
    const result = replaceAllMatches(input.value, replaceFind.value, replaceWith.value, replaceWord.checked);
    if (result.count === 0) {
      setStatus('No hay coincidencias para reemplazar.');
      return;
    }
    replaceText(result.text);
    setStatus(
      replaceWith.value === ''
        ? `Se eliminaron ${result.count} coincidencias. Podés deshacerlo.`
        : `Se reemplazaron ${result.count} coincidencias. Podés deshacerlo.`,
    );
  };

  const clearCurrentText = (): void => {
    if (input.value === '') {
      return;
    }
    replaceText('');
    input.focus();
    setStatus('Texto borrado. Podés deshacer la acción.');
  };

  const undoLastChange = (): void => {
    const previous = history.pop();
    if (previous === undefined) {
      return;
    }
    input.value = previous;
    updateCounts();
    setStatus('Se restauró la versión anterior del texto.');
  };

  const copyCurrentText = async (): Promise<void> => {
    const text = input.value;
    if (text === '') {
      return;
    }
    try {
      await navigator.clipboard.writeText(text);
      setStatus('Texto copiado al portapapeles.');
    } catch {
      input.select();
      setStatus('No se pudo copiar automáticamente. El texto quedó seleccionado: usá Ctrl+C.');
    }
  };

  input.addEventListener('input', updateCounts);
  input.addEventListener('scroll', () => {
    highlight.scrollTop = input.scrollTop;
  });

  replaceFind.addEventListener('input', updateHighlight);
  replaceWord.addEventListener('change', updateHighlight);
  replaceButton.addEventListener('click', replaceCurrentMatches);

  if (countButton && wordCount && charCount) {
    countButton.addEventListener('click', () => {
      updateCounts();
      setStatus(`Conteo: ${wordCount.textContent} palabras y ${charCount.textContent} caracteres con espacios.`);
    });
  }

  document.querySelector<HTMLButtonElement>('#btn-remove-fillers')?.addEventListener('click', removeFillersNow);
  cleanButton.addEventListener('click', cleanCurrentText);
  clearButton.addEventListener('click', clearCurrentText);
  undoButton.addEventListener('click', undoLastChange);
  copyButton.addEventListener('click', () => {
    void copyCurrentText();
  });

  updateCounts();
}
