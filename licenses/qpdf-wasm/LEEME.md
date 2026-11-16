# Aviso de @neslinesli93/qpdf-wasm 0.3.0 y de QPDF

Revisión del 16 nov 2026.

## Envoltorio (ISC)

- `LICENSE` (ISC, «Copyright (c) 2026 Tommaso Pifferi»): verificado contra la rama `master` del repositorio `neslinesli93/qpdf-wasm`. El paquete npm 0.3.0 corresponde al commit `e661db2d17e391a9fbe6b350b4ea6dbd8c385891` (`gitHead` del registro npm). Su `package.json` dice `"license": "ISC"`. El tarball no incluye archivo LICENSE; el texto proviene del repositorio.

## QPDF (Apache-2.0)

- **Versión de QPDF (confirmada en el código fuente de la compilación):** el `Dockerfile` del commit `e661db2d…` dice «qpdf version 12.2.0» y clona QPDF en el commit `856d32c610334855d30e96d25eb5f9636fb62f08`. Ese commit es el tag firmado `v12.2.0` de `qpdf/qpdf` (verificado mediante la API de GitHub: tag object `65c81538…`, firma válida, fecha 4 may 2025).
- **Vínculo con el binario distribuido (inferido):** el `dist/qpdf.wasm` del paquete 0.3.0 se compiló con ese `Dockerfile`. No hay una cadena de versión en el binario que lo demuestre. Por eso la versión se considera confirmada por el código de compilación, no por el binario.
- **Copyright en el binario distribuido** (cadenas encontradas en `dist/qpdf.wasm`, 16 nov 2026): «Copyright (c) 2022-2025 Jay Berkenbilt and Manfred Holger» y «Copyright (c) 2005-2021 Jay Berkenbilt».
- **Texto de licencia:** `../qpdf-Apache-2.0/LICENSE` (Apache License 2.0; verificado en `LICENSE.txt` del tag `v12.2.0`).
- **NOTICE:** no existe en el tag `v12.2.0` (HTTP 404) ni en `main`. No hace falta incluirlo, porque el repositorio upstream no lo distribuye.
- **Limitación:** el `Dockerfile` usa la imagen base `emscripten/emsdk:3.1.74`, no 3.1.30. Esa imagen pertenece al paquete qpdf-wasm, no al núcleo FFmpeg de ChispaBox.
