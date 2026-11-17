/*
 * Aplica la preferencia de tema guardada antes del primer pintado.
 * Si no hay preferencia, no se define data-theme: el CSS sigue prefers-color-scheme.
 * Debe mantenerse sincronizado con STORAGE_KEY en src/scripts/theme.ts.
 */
(function () {
  try {
    var saved = window.localStorage.getItem('mp-theme');
    if (saved === 'light' || saved === 'dark') {
      document.documentElement.setAttribute('data-theme', saved);
    }
  } catch (error) {
    // localStorage puede estar bloqueado (modo privado, políticas del navegador).
  }
})();
