/*
 * Corrección ortográfica en español con nspell (Hunspell) y el diccionario dictionary-es.
 * Los archivos del diccionario están en public/dictionaries/es/ y se cargan solo la primera
 * vez que hace falta (cuando una palabra no tiene artículo).
 */

import nspell from 'nspell';

const DICT_BASE = '/dictionaries/es/';
const MAX_SUGGESTIONS = 10;

interface Speller {
  suggest(word: string): string[];
}

let speller: Promise<Speller> | null = null;

async function loadText(file: string): Promise<string> {
  const response = await fetch(`${DICT_BASE}${file}`);
  if (!response.ok) throw new Error(`No se pudo cargar el diccionario (${response.status})`);
  return response.text();
}

function getSpeller(): Promise<Speller> {
  if (!speller) {
    speller = Promise.all([loadText('index.aff'), loadText('index.dic')]).then(([aff, dic]) =>
      nspell(aff, dic),
    );
    // Si falla la carga, se vuelve a intentar en la próxima búsqueda.
    speller.catch(() => {
      speller = null;
    });
  }
  return speller;
}

/** Palabras del diccionario parecidas a `word`, de la más probable a la menos probable. */
export async function suggestSpelling(word: string): Promise<string[]> {
  const checker = await getSpeller();
  return checker.suggest(word.trim()).slice(0, MAX_SUGGESTIONS);
}
