/*
 * Lectura del texto plano de un artículo de Wiktionary en español (explaintext de MediaWiki).
 * Extrae la sección «Español»: acepciones con su categoría gramatical, y todas las líneas
 * «Sinónimos:» y «Antónimos:» de esa sección. Sin HTML, así que no hay nada que inyectar.
 */

export interface Sense {
  partOfSpeech: string;
  definition: string;
}

export interface SpanishEntry {
  /** true si el artículo tiene una sección «Español», aunque no tenga acepciones (p. ej. una forma verbal). */
  hasSpanish: boolean;
  senses: Sense[];
  synonyms: string[];
  antonyms: string[];
}

const MAX_SENSES = 15;
const MAX_WORDS = 30;

const POS_HEADER =
  /^(sustantivo|adjetivo|verbo|adverbio|pronombre|preposicion|conjuncion|interjeccion|articulo|numeral|determinante|expresion|forma)\b/i;

/** Quita acentos sueltos (NFD) para comparar etiquetas como «Antónimos:» sin depender de la codificación. */
function fold(text: string): string {
  return text.normalize('NFC');
}

function splitWords(line: string): string[] {
  return line
    .split(',')
    .map((w) => w.trim().replace(/\.$/, ''))
    .filter((w) => w.length > 0 && !/^v[ée]ase/i.test(w));
}

function uniqueLimited(words: string[]): string[] {
  return Array.from(new Set(words)).slice(0, MAX_WORDS);
}

/** Devuelve la entrada en español de un extracto, o un resultado vacío si no hay sección. */
export function parseSpanishEntry(rawExtract: string): SpanishEntry {
  const extract = fold(rawExtract);
  const empty: SpanishEntry = { hasSpanish: false, senses: [], synonyms: [], antonyms: [] };
  const start = extract.indexOf('== Español ==');
  if (start < 0) return empty;

  const afterHeader = extract.slice(start + '== Español =='.length);
  // La sección termina en el siguiente idioma (encabezado de nivel 2).
  const next = afterHeader.search(/\n== [^=\n]+ ==/);
  const section = next >= 0 ? afterHeader.slice(0, next) : afterHeader;

  const senses: Sense[] = [];
  const synonyms: string[] = [];
  const antonyms: string[] = [];
  let partOfSpeech = '';
  let inSenses = false;
  let expectingDefinition = false;

  for (const rawLine of section.split('\n')) {
    const line = rawLine.trim();
    if (!line) continue;

    const header = /^=+\s*(.+?)\s*=+$/.exec(line);
    if (header) {
      const title = header[1];
      if (POS_HEADER.test(title)) {
        partOfSpeech = title.replace(/^./, (c) => c.toUpperCase());
        inSenses = true;
      } else {
        // Etimología, locuciones, traducciones, etc.: fuera de las acepciones.
        inSenses = false;
      }
      expectingDefinition = false;
      continue;
    }

    // Relaciones léxicas: se recogen de toda la sección, esté o no dentro de una acepción.
    if (/^Sinónimos:/i.test(line)) {
      synonyms.push(...splitWords(line.replace(/^Sinónimos:/i, '')));
      continue;
    }
    if (/^Antónimos:/i.test(line)) {
      antonyms.push(...splitWords(line.replace(/^Antónimos:/i, '')));
      continue;
    }
    if (!inSenses) continue;
    if (/^(Ejemplo|Uso):/i.test(line)) continue;

    // Acepción con número y definición en la misma línea («1 Vivienda»).
    const inline = /^(\d+)\s+(\S.*)$/.exec(line);
    if (inline) {
      senses.push({ partOfSpeech, definition: inline[2].replace(/\.$/, '') });
      expectingDefinition = false;
      continue;
    }
    if (/^\d+$/.test(line)) {
      expectingDefinition = true;
      continue;
    }
    if (expectingDefinition) {
      senses.push({ partOfSpeech, definition: line.replace(/\.$/, '') });
      expectingDefinition = false;
    }
  }

  return {
    hasSpanish: true,
    senses: senses.slice(0, MAX_SENSES),
    synonyms: uniqueLimited(synonyms),
    antonyms: uniqueLimited(antonyms),
  };
}
