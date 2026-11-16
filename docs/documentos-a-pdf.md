# Documentos a PDF

Herramienta de ChispaBox que convierte documentos Word, Excel, PowerPoint e imágenes a PDF.
Página: `paginas/documentos-a-pdf/index.html`.

## 1. Alcance y procesamiento

| Origen | Dónde se procesa | Librería o motor |
| --- | --- | --- |
| JPG, JPEG, PNG, WebP | **En el navegador** (no se sube nada) | Canvas API, `CompressionStream`, escritor de PDF propio |
| Word `.docx`, `.doc` | **En el servidor de esta aplicación** (`npm run dev` / `npm run preview`) | LibreOffice 26.8.3 (headless, perfil aislado) |
| Excel `.xlsx`, `.xls` | Servidor | LibreOffice 26.8.3 |
| PowerPoint `.pptx`, `.ppt` | Servidor | LibreOffice 26.8.3 |

La interfaz indica el lugar de procesamiento de cada pestaña. En una publicación estática (Nginx, sin servidor) las pestañas Office quedan deshabilitadas con un aviso; las imágenes siguen funcionando.

Ningún documento se envía a servicios externos. No hay telemetría ni análisis del contenido.

## 2. Arquitectura

- **Frontend** (`src/`): `src/scripts/documentos-pdf.ts` (pestañas), `documentos-pdf-imagenes.ts`, `documentos-pdf-oficina.ts`; visor en `src/lib/pdf-viewer.ts`; estilos en `src/styles/documentos-pdf.css`.
- **Lógica compartida sin DOM** (`src/shared/`): límites centralizados (`documentos-limits.ts`), distribución de página (`pdf-layout.ts`), escritor de PDF (`pdf-writer.ts`), ZIP (`zip-store.ts`), nombres seguros (`nombres-archivo.ts`). Son funciones puras y tienen pruebas unitarias.
- **Backend** (`server/documentos-pdf/`), montado como plugin de Vite solo en `dev` y `preview` (igual que YouTube y Sharp):
  - `config.ts`: configuración por variables de entorno.
  - `api.ts`: `GET /api/documentos-pdf/estado` y `POST /api/documentos-pdf/convertir`.
  - `office-check.ts`: validación de firma y estructura antes de LibreOffice.
  - `zip.ts`: lector de ZIP con límites (para validar OOXML y para ajustar Excel).
  - `excel-page.ts`: ajuste de orientación, papel y ancho en una **copia** del libro.
  - `soffice.ts`: ejecución aislada de LibreOffice.

## 3. Librerías utilizadas

| Componente | Versión | Publicada | Licencia | Repositorio / fuente oficial | Uso | Decisión |
| --- | --- | --- | --- | --- | --- | --- |
| LibreOffice | 26.8.3 (build 26.8.3.1) | 11 nov 2026 (listado de descargas oficial) | MPL-2.0 (núcleo; componentes de terceros con sus licencias) | https://www.libreoffice.org/ · descarga: https://download.documentfoundation.org/libreoffice/stable/26.8.3/win/x86_64/ | Word/Excel/PowerPoint a PDF | Instalación administrativa en `C:\ruta\a\LibreOffice`. SHA-256 del MSI verificado contra el `.sha256` publicado por el proyecto: `0e6918c2…15bf94` (coincide). |
| pdfjs-dist | 6.5.438 (exacta) | 1 nov 2026 | Apache-2.0 | https://github.com/mozilla/pdf.js · npm `pdfjs-dist` | Vista previa de PDF (worker, cmaps y fuentes estándar copiados localmente en `public/pdfjs/`) | Ver seguridad abajo. |
| Escritor de PDF propio | — | — | — | `src/shared/pdf-writer.ts` | Crear PDF con una página por imagen | **pdf-lib descartado**: su última versión (1.17.1) es de 6 nov 2021 y no tiene mantenimiento; RG-04 lo excluye. |
| ZIP propio | — | — | — | `src/shared/zip-store.ts`, `server/documentos-pdf/zip.ts` | ZIP sin compresión para PDF separados y lectura de OOXML | Evita una dependencia; formato simple y verificado con pruebas. |
| Canvas API, CompressionStream | Nativas del navegador | — | — | — | Decodificar, aplanar fondo, codificar JPEG y comprimir (zlib) | Sin librerías adicionales. |
| sharp | 0.35.5 (ya instalada) | — | Apache-2.0 | — | **No se usa** en esta herramienta. No se duplicó. | — |
| OCR | — | — | — | — | — | **No incorporado** (ver sección 9). |

Dependencias transitivas de `pdfjs-dist`: `@napi-rs/canvas` (opcional, MIT) se instala por npm, pero solo lo usa el código de Node; no entra en el bundle del navegador. Motor requerido: Node.js `>=22.13`; el proyecto usa Node 22.17 en local y `node:22-alpine` en Docker.

### Seguridad de las versiones elegidas

- **pdf.js**: el aviso [CVE-2026-16633](https://advisories.gitlab.com/npm/pdfjs-dist/CVE-2026-16633/) (ejecución de JavaScript al abrir un PDF malicioso, XSS, CWE-79) afecta a `pdfjs-dist` `>= 5.6.83` y `< 6.2.108`. La versión 6.5.438 queda **fuera del rango afectado**. Además, el visor solo dibuja el canvas de cada página y no monta la capa de anotaciones ni de formularios, así que el código incrustado en el PDF no se ejecuta en la página. La CSP de Nginx (`script-src 'self'`) limita cualquier script inyectado.
- **LibreOffice 26.8.3**: las búsquedas de avisos encontraron correcciones de 2026 en otras ramas o versiones (por ejemplo, [CVE-2026-63277](https://www.cybersecurity-help.cz/vdb/SB2026061752), de Calc con datos externos/JDBC que puede cargar código Java remoto, corregida en 26.2.5 y 26.8.0; y los CVE de la ola de julio, corregidos en 25.8.7/26.2.3). Por ser posterior a esas correcciones, 26.8.3 debería incluirlas, **pero no se pudo confirmar la lista completa de CVE de 26.8.3**. Revisar https://www.libreoffice.org/advisories antes de cada actualización.
- **Dependencias npm**: `npm audit --omit=dev` → 0 vulnerabilidades (verificado durante la instalación).

## 4. Límites

Todos los valores están en `src/shared/documentos-limits.ts` (cliente y servidor usan el mismo archivo). Cada límite indica su origen.

| Límite | Valor | Origen |
| --- | --- | --- |
| Peso por documento Office | 30 MB (`DOCUMENTOS_MAX_MB`, 1–100) | Preventivo |
| Descomprimido total de OOXML | 300 MB | Preventivo (zip bomb) |
| Entradas dentro de un OOXML | 5 000 | Preventivo |
| Tiempo por conversión Office | 120 s (`DOCUMENTOS_TIMEOUT_SEG`, 10–600) | Preventivo |
| Conversiones simultáneas | 1 (`DOCUMENTOS_MAX_CONCURRENT`, 1–4) | Preventivo |
| Páginas del PDF de Office | 500 | Preventivo |
| Filas / columnas de Excel | 1 048 576 / 16 384 | **Real** (formato Excel) |
| Imágenes por operación | 30 | Preventivo |
| Peso por imagen | 20 MB (vacía no admitida) | Preventivo |
| Peso total de imágenes | 150 MB | Preventivo |
| Lado máximo de imagen | 8 000 px | Preventivo |
| Píxeles por imagen | 20 MP | Preventivo |
| Páginas generadas (imágenes) | 200 | Preventivo |
| Lado de página PDF | 3 pt a 14 400 pt (200 in) | **Real** (límite del formato PDF) |

Las imágenes del navegador también dependen del límite real de Canvas del navegador, que varía según el equipo.

## 5. Seguridad y privacidad (controles aplicados)

**Documentos Office (servidor)**
- Validación de firma según la extensión pedida: ZIP para OOXML, OLE2 para formatos binarios. Un archivo cuya firma no corresponde se rechaza antes de llegar a LibreOffice (p. ej., un `.xlsx` enviado como `.docx`).
- Lectura de ZIP con límites: rechaza ZIP64, cifrado, método de compresión no admitido, rutas con `..`, rutas absolutas o barras invertidas; corta si el tamaño descomprimido o la proporción de compresión superan el límite (antes de inflar).
- Macros: se detectan (`vbaProject.bin` o cadenas VBA en binarios) y se informan. **No se ejecutan**: el perfil de LibreOffice usa `MacroSecurityLevel=3` y `DisableMacrosExecution=true`.
- Vínculos externos: el perfil usa `Update/Link=2` (nunca actualizar). Se detectan y se informan.
- Ejecución: `execFile`/`spawn` con argumentos fijos y `shell: false`. Nombre de entrada fijo (`entrada.<ext>`); nunca el nombre del usuario. Entorno mínimo del proceso hijo (sin heredar el entorno del servidor).
- Perfil de LibreOffice nuevo para cada trabajo, dentro de la carpeta temporal del trabajo, que se borra al terminar.
- Tiempo máximo: al vencer se termina el árbol de procesos (`taskkill /T /F` en Windows) y se responde 504.
- Cancelación: si el cliente se desconecta o pulsa «Cancelar», se termina LibreOffice y se borran los temporales.
- Límite de simultaneidad (429) y de páginas del resultado (422).
- Solo se acepta la misma origen (`Origin` debe coincidir con `Host`): 403 en otro caso.
- Parámetros con lista blanca (orientación, papel, ajuste); cualquier otro valor → 400.
- Salida: se verifica `%PDF-`, el final `%%EOF` y el número de páginas antes de entregarla. Los logs no registran contenido de documentos.
- Temporales: cada trabajo usa `chispabox-docs-*`; al arrancar, solo se borran carpetas con ese prefijo. No se toca ningún otro archivo.
- Originales: nunca se escriben. En Excel se modifica una copia temporal.

**Imágenes (navegador)**
- Validación por firma y dimensiones leídas del encabezado, antes de decodificar (`src/lib/image-file.ts`, reutilizado).
- Transparencia: se aplana sobre el color elegido (blanco por defecto). Verificado: el píxel transparente sale `255,255,255`.
- PNG hasta 4 MP: RGB sin pérdida (FlateDecode). Resto: JPEG calidad 92 (DCTDecode). Por eso **las fotos se recodifican** y no conservan el JPEG original.
- Nombres de salida: se conservan tildes y ñ; se quitan separadores de ruta, caracteres prohibidos y nombres reservados de Windows; duplicados → «nombre (2)».
- Verificación del PDF generado: estructura (`xref`, desplazamientos, trailer) y apertura con PDF.js con el número de páginas esperado. Sin verificación no se entrega.

**Privacidad**: las imágenes no salen del navegador. Los documentos Office viajan solo a `localhost` (o al servidor de esta aplicación) y no se guardan.

## 6. Interfaz

- Selector de origen con pestañas (Word, Excel, PowerPoint, Imágenes), navegable con teclado (flechas, Inicio, Fin). La pestaña se conserva en la URL (`#excel`, etc.).
- Antes de cargar: formatos, pesos y límites, generados desde la configuración central.
- Después de cargar: nombre, extensión, peso, tipo detectado y estado de validación. Imágenes: también ancho, alto y píxeles.
- Imágenes: lista con miniatura, orden, peso, dimensiones y número de orden; reordenar por arrastre o con «Subir»/«Bajar»; quitar una imagen sin afectar a las demás.
- Imágenes, opciones: un PDF o uno por imagen (ZIP si son varios); tamaño A4, Carta, Oficio/Legal o ajustado a la imagen; orientación automática, vertical u horizontal; márgenes normales, reducidos o ninguno; ajustar, rellenar (avisa que recorta) o tamaño original/proporcional; color de fondo para transparencias.
- Vista previa de imágenes: se calcula con la **misma función** que la exportación (`computeLayout`).
- Excel: orientación, papel y ajuste de ancho; «Según el libro» conserva la configuración original.
- Resultado: páginas, peso final, verificación, nombre editable antes de descargar, vista previa con PDF.js y botón de descarga.

## 7. Pruebas

Ver sección 8 (resultados) y la lista completa en `tests/documentos-pdf/`.

- `shared.test.ts` y `excel-page.test.ts`: pruebas unitarias de distribución, escritor de PDF, ZIP, nombres y ajuste XML de Excel. Sin LibreOffice.
- `api.integration.test.ts`: API real con LibreOffice instalado.

Ejecución:

```bash
npm run test:documentos
```

## 8. Resultados de las pruebas

Ejecutado el 15 nov 2026 en Windows 11, Node 22.17.0, LibreOffice 26.8.3.1.

**Pruebas unitarias** (`tests/documentos-pdf/shared.test.ts`, `excel-page.test.ts`, sin LibreOffice): **25 de 25 aprobadas**.
- CRC-32 de referencia, ZIP de ida y vuelta, rechazo de rutas peligrosas y de descompresión excesiva.
- Escritor de PDF: estructura, xref y desfases detectados.
- Distribución de página: ajustar, rellenar, original, ajustado, límites del PDF.
- Nombres seguros y deduplicados.
- Ajuste XML de hojas de Excel: orientación, papel, ajuste de ancho, orden de elementos y prefijos de espacio de nombres.

**Pruebas de integración** (`tests/documentos-pdf/api.integration.test.ts`, LibreOffice real): **26 de 26 aprobadas**.

| Grupo | Pruebas | Resultado |
| --- | --- | --- |
| Estado del servicio | LibreOffice disponible, formatos listados | Aprobada |
| Word | Documento simple con texto, varias páginas (220 párrafos), `.doc` binario | Aprobadas |
| Word seguridad | Vínculo externo a un servidor local de escucha: **0 conexiones**; macros presentes: informadas y no ejecutadas (su texto no aparece en el PDF) | Aprobadas |
| PowerPoint | 3 diapositivas → 3 páginas con proporción 4:3; `.ppt` binario | Aprobadas |
| Excel | Varias hojas en el PDF; horizontal + Carta (792 × 612 pt); ajuste de ancho sin más páginas; `.xls` binario; hoja oculta no exportada (1 página, sin su texto) | Aprobadas |
| Rechazos | Corrupto, xlsx enviado como docx, texto como `.doc`, ruta `../` en ZIP, zip bomb (20 MB con deflate) | Aprobadas (422) |
| Límites | Archivo de 6 MB (413); sin longitud, transferencia por partes (411); origen ajeno (403); parámetros fuera de lista (400); más páginas que el máximo (422) | Aprobadas |
| Concurrencia y tiempo | Segunda conversión con una en curso (429); cerrar la conexión detiene LibreOffice y borra temporales; tiempo máximo (504) y limpieza | Aprobadas |

Durante las pruebas aparecieron dos fallos de mi parte, ya corregidos: un mensaje de error que se evaluaba aunque la respuesta fuera correcta, y una prueba de «sin Content-Length» que Node convertía en petición válida. Además, el borrado de carpetas temporales en Windows dio `EPERM` tras cerrar LibreOffice; se añadieron reintentos (`maxRetries`) y la prueba pasó.

**Pruebas en el navegador** (servidor de desarrollo, y compilación con la cabecera CSP de `nginx.conf`):
- Imágenes: 4 imágenes listadas con formato, peso y dimensiones; PDF único (8 páginas, verificado); PDF separados con nombres sin repetir (`foto`, `foto (2)`…) y ZIP; PNG transparente → píxel `255,255,255` (fondo blanco, no negro).
- Word: `Trabajo final.docx` → 1 página, verificada; orden: información, vista previa, descarga.
- Excel con orientación horizontal, papel Carta y ajuste de ancho: vista previa horizontal.
- PowerPoint: 2 diapositivas → 2 páginas.
- Un .docx cargado en la pestaña Excel se rechaza con un mensaje que indica la pestaña correcta.
- Bajo la CSP de Nginx: sin violaciones de CSP en consola; el flujo de imágenes y la vista previa de PDF.js funcionan. Con la publicación estática, la pestaña Office queda deshabilitada con su aviso.

**Lo que no se probó**: gráficos incrustados en Excel; selección de hojas (no implementada); verificación de red a nivel de firewall (solo el listener); otros navegadores; equipos de menor capacidad (tiempo de conversión en frío).

**Compilación completa**: `npm run build` falla por un archivo ajeno en curso (`src/scripts/convertir-audio.ts` y `paginas/convertir-audio/`, creados durante esta sesión, con un import de `@ffmpeg/core` que Vite no resuelve). No se tocó. Con una configuración temporal que excluye esa página, la compilación de las páginas de este proyecto termina bien (la página nueva pesa 34 kB; PDF.js ocupa un trozo de 482 kB que se carga solo al entrar).


## 9. OCR: decisión pendiente

**El OCR está en la próxima lista, no publicado.** La especificación (RG-02) prohíbe el OCR mediante IA y los modelos descargados automáticamente. La página `paginas/ocr-documentos/` y sus archivos en `public/ocr/` no entran en la compilación pública (`vite.config.ts`). Tesseract, la biblioteca de OCR libre más conocida, usa redes neuronales LSTM desde la versión 4 (y `tesseract.js` descarga los modelos de idioma), así que no cumple la regla. Las alternativas sin redes neuronales son antiguas y de calidad muy inferior. Hace falta una decisión explícita antes de agregar OCR; no se evaluó una biblioteca alternativa porque ninguna cumple ambas condiciones a la vez.

## 10. Limitaciones y riesgos pendientes

1. **LibreOffice no es un límite de seguridad por sí solo.** El modo headless con perfil aislado reduce el riesgo, pero no reemplaza un aislamiento real. **Antes de publicar** (RG-06, sección 10) hace falta un contenedor sin red, con usuario sin privilegios y sistema de archivos de solo lectura salvo el directorio de trabajo.
2. **Red**: se verificó con un servidor de escucha que LibreOffice no descarga imágenes externas de un `.docx`. No se verificó con firewall qué otras conexiones realiza el proceso (por ejemplo, comprobación de actualizaciones, que se intenta desactivar en el perfil).
3. **Excel**: no se implementó la selección de hojas (todas, una o varias); se exportan todas las visibles. Las áreas de impresión las respeta LibreOffice. No se probaron gráficos incrustados ni hojas con muchas columnas en otros tamaños de papel más allá de Carta horizontal.
4. **Fidelidad**: el PDF es una copia de diseño fijo. Si faltan fuentes en el servidor, habrá diferencias. No se afirma equivalencia visual.
5. **Diapositivas**: animaciones, transiciones, audio y video no se incluyen (esperado por la especificación).
6. **Formatos binarios antiguos** (`.doc`, `.xls`, `.ppt`): se validan por firma y por el nombre de su flujo interno. Un archivo binario malicioso que pase esa validación depende de la seguridad de LibreOffice.
7. **Macros y vínculos**: se detectan por nombre de parte (OOXML) o por cadenas (binarios). La detección de binarios es heurística.
8. **Contraseña**: los archivos protegidos por contraseña no se convierten; el mensaje lo indica como causa probable.
9. **Rendimiento**: cada conversión crea un perfil nuevo de LibreOffice (aislamiento por trabajo). En este equipo una conversión tarda entre unos segundos y más de 20 s según la carga. Hay una conversión a la vez.
10. **Imágenes**: los JPEG se recodifican (pérdida generacional leve). La transparencia se aplana; no se conserva como canal alfa.
11. **Visor**: la CSP de Nginx no permite `wasm-unsafe-eval`, así que PDF.js usa su decodificador en JavaScript para JPEG 2000 y JBIG2 (más lento, mismo resultado). Se probó bajo la CSP de `nginx.conf` con un servidor de prueba: sin violaciones en consola.
12. **Publicación**: el API no tiene autenticación, cuotas ni colas. No debe habilitarse en un servidor público sin esos controles (sección 10 de la especificación).
13. **Tipo MIME de imágenes**: la validación heredada de la herramienta de imágenes rechaza un archivo cuyo tipo informado no coincide con su contenido. Un servidor que sirva `.jpg` como `application/octet-stream` provoca ese rechazo.
14. **Aviso de error al agregar imágenes**: si un archivo se rechaza y después se pulsa «Convertir», el aviso se borra al iniciar la conversión. Pendiente de corregir.
