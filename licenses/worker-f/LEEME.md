# Aviso de worker-f 0.1.24 — PENDIENTE

Revisión del 16 nov 2026. **No hay texto de licencia verificado. No se publica aviso.** Estado: **consulta enviada al autor; respuesta pendiente.** No se afirma que la obligación de licencia esté resuelta.

## Lo que está confirmado

- **Paquete npm**: `worker-f@0.1.24`, tarball `https://registry.npmjs.org/worker-f/-/worker-f-0.1.24.tgz`, sha256 `c5071eedd6b33311eb2c1a5f6c6616e4aedccb0a677a9d54d0151c82307587bf`, integridad `sha512-XzBi/8IctnwWeg50HX9klvRosALIqfxByQRyPQ6mHjGBGOFPm8jhHJKYFlwYovifzeBV+TAi9M5tJX4ZHw3G+A==`.
- **Metadatos del `package.json` del tarball**: `"license": "MIT"`, autor `catamphetamine <purecatamphetamine@gmail.com>`, repositorio `https://gitlab.com/catamphetamine/worker-f`, incidencias `https://gitlab.com/catamphetamine/worker-f/issues`. `gitHead`: `60518db528d5b4cfdd8a5a70a631990bf8b623eb`.
- **El tarball no contiene ningún archivo de licencia**: 82 entradas, ninguna con nombre LICENSE, LICENCE, COPYING ni NOTICE. Solo contiene `README.md`, `CHANGELOG.md`, `package.json` y el código (`browser/`, `bundle/`, `commonjs/`, `lib/`, `node/`).
- **Código distribuido**: el código de worker-f aparece en `dist/` a través de `read-excel-file` (dependencia `worker-f ^0.1.12`), en el bundle de «Convertidor de datos». Se verificó con los mapas de código fuente (`convertidor-datos-*.js.map`).

## Lo que no se pudo verificar

- El texto de la licencia MIT y la línea de copyright. Fuentes intentadas (16 nov 2026):
  - GitLab, LICENSE en el commit `60518db5…` (API y web): 404 y 403.
  - `cdn.jsdelivr.net/npm/worker-f@0.1.24/LICENSE`: 404.
  - Mirror `github.com/catamphetamine/worker-f`: sin archivo LICENSE en la raíz.
  - `npmjs.com/package/worker-f`: 403.
- El copyright de worker-f no está en el tarball. El campo `author` de `package.json` no es una línea de copyright verificada.

## Alternativas (sin ejecutar; requieren decisión)

1. **Conservar con riesgo identificado**: usar la licencia declarada MIT (npm), citar el autor declarado y advertir que el texto no está verificado. Riesgo: la licencia MIT exige incluir el aviso de copyright y el texto; sin ellos, el uso queda sin cumplir.
2. **Solicitar aclaración al autor** por las incidencias de GitLab o por el correo de `package.json`. Requiere que lo envíes tú.
3. **Sustituir la dependencia** (worker-f se usa solo para ejecutar el lector de XLSX en un Worker). Cambio de dependencia: requiere autorización.
