# Aviso de worker-f — RESUELTO (texto de licencia obtenido de 0.1.25)

Actualizado el 19 nov 2026. El autor respondió el 16 nov 2026 que faltaba el archivo LICENSE en el repositorio y en el paquete npm, y que lo agregó a ambos. Con esa actualización ya hay texto de licencia verificado.

## Texto de licencia verificado

- **Paquete npm**: `worker-f@0.1.25` (publicado el 17 nov 2026), tarball `https://registry.npmjs.org/worker-f/-/worker-f-0.1.25.tgz`.
- **Archivo**: `LICENSE` dentro del tarball. Copia guardada en [LICENSE-MIT.txt](LICENSE-MIT.txt).
- **Licencia**: MIT. Línea de copyright: `Copyright (c) 2018 gitlab.com/catamphetamine`.
- **Metadatos del `package.json`**: `"license": "MIT"`, autor `catamphetamine`, repositorio `https://gitlab.com/catamphetamine/worker-f`.

## Versión instalada en el proyecto

- `package-lock.json` sigue fijando **0.1.24**. El tarball de 0.1.24 no cambió (mismo sha256 que el 16 nov 2026) y **no incluye LICENSE**. Por eso, para que el aviso corresponda a la versión que se usa, hay que actualizar la dependencia a 0.1.25. Ese cambio no se hizo todavía porque modifica el lockfile.
- El código de worker-f no se distribuye en `dist/`: `read-excel-file/browser` se compila con `src/shims/worker-f-browser.ts` (alias en `vite.config.ts`). Ver `THIRD_PARTY_NOTICES.md`, fila 21.

## Qué falta

- Decidir si se actualiza la dependencia a 0.1.25 (`npm update worker-f` y revisar el lockfile). Hasta entonces, el aviso sirve para la versión 0.1.25 que publica el autor.
