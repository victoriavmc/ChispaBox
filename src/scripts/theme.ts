/*
 * Cambio de tema claro / oscuro.
 * - La preferencia elegida se guarda en localStorage (clave "mp-theme").
 * - Sin preferencia guardada, el tema sigue prefers-color-scheme (lo resuelve el CSS).
 * - El atributo data-theme en <html> activa las variables del tema.
 */

type Theme = 'light' | 'dark';

/** Debe coincidir con la clave usada en public/theme-init.js. */
const STORAGE_KEY = 'mp-theme';

const systemDarkQuery = window.matchMedia('(prefers-color-scheme: dark)');

function readStoredTheme(): Theme | null {
  try {
    const value = window.localStorage.getItem(STORAGE_KEY);
    return value === 'light' || value === 'dark' ? value : null;
  } catch {
    return null;
  }
}

function storeTheme(theme: Theme): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    // Sin localStorage (modo privado o bloqueado): el cambio dura solo en esta visita.
  }
}

function currentTheme(): Theme {
  const attribute = document.documentElement.dataset.theme;
  if (attribute === 'light' || attribute === 'dark') {
    return attribute;
  }
  return systemDarkQuery.matches ? 'dark' : 'light';
}

export function initTheme(): void {
  const button = document.querySelector<HTMLButtonElement>('#theme-toggle');
  if (!button) {
    return;
  }
  const label = button.querySelector<HTMLElement>('.theme-toggle__label');

  const syncToggle = (): void => {
    const isDark = currentTheme() === 'dark';
    const target = isDark ? 'claro' : 'oscuro';
    button.setAttribute('aria-label', `Cambiar a tema ${target}`);
    if (label) {
      label.textContent = isDark ? 'Claro' : 'Oscuro';
    }
  };

  syncToggle();

  button.addEventListener('click', () => {
    const next: Theme = currentTheme() === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    storeTheme(next);
    syncToggle();
  });

  // Si el usuario no eligió tema, acompañar los cambios del sistema operativo.
  systemDarkQuery.addEventListener('change', () => {
    if (readStoredTheme() === null) {
      syncToggle();
    }
  });
}
