import '../styles/variables.css';
import '../styles/main.css';
import '../styles/responsive.css';
import '../styles/clean-tool.css';
import '../styles/not-found.css';
import '../styles/encabezado.css';

import { initTheme } from './theme';
import { initTextTools } from './text-tools';
import { initSuggestions } from './suggestions';

initTheme();

// El contador vive en contador.html; en la landing no hay textarea y se omite.
if (document.querySelector('#text-input')) {
  initTextTools();
}

initSuggestions();
