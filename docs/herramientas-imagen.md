# Herramientas de imagen: quitar fondo, convertir formato y mejorar calidad

Revisión del 15 de noviembre de 2026. Describe qué se implementó, con qué dependencias, qué límites aplica
(y dónde están configurados), qué se probó realmente y qué queda pendiente.

## 1. Auditoría inicial (Fase 1)

| Hallazgo | Acción |
| --- | --- |
| `src/scripts/quitar-fondo.ts` usaba `onnxruntime-web` 1.31.1 y el modelo **ORMBG** (`public/models/ormbg.onnx`, descargado de Hugging Face). Es IA y RG-02 la prohíbe. | Reemplazado por algoritmos clásicos (`src/lib/cutout.ts`). Eliminados `onnxruntime-web`, el modelo, los WASM de `public/ort/` y su manifiesto. |
| `onnxruntime-web` solo lo usaba `quitar-fondo.ts` (comprobado con búsqueda en todo el proyecto). | Eliminar la dependencia no afectó a otros módulos. |
| `convertir-imagen` y `mejorar-imagen` eran páginas de marcador sin funcionalidad. | Implementadas (secciones 4 y 5). |
| La web es estática (Nginx en Docker). Sharp necesita Node. | Sharp corre en un endpoint local de Vite (`server/image-enhance.ts`), disponible solo con `npm run dev` y `npm run preview`. La interfaz lo detecta y deshabilita el método si no existe. |
| `public/assets.manifest.json` y `scripts/verify-assets.mjs` solo verificaban los archivos eliminados. | Eliminados, junto con el script `verify:assets`. |
| La CSP de Nginx tenía `'wasm-unsafe-eval'` para ONNX. | Eliminada. |
| La página de librerías y la portada indicaban ONNX o «Próximamente» para estas herramientas. | Actualizadas. |

Los módulos no relacionados (grabar audio, transcribir, contador, limpiador) no se modificaron.

## 2. Dependencias (RG-01, RG-02, RG-04)

| Dependencia | Versión exacta | Publicada | Licencia | Repositorio | Decisión |
| --- | --- | --- | --- | --- | --- |
| sharp | 0.35.5 | 27 sep 2026 | Apache-2.0 | github.com/lovell/sharp | **Incorporada** (devDependency). Método Sharp en el servidor local de desarrollo. |
| libvips (binario de `@img/sharp-libvips-*`) | 1.3.4 | — | LGPL-3.0-or-later | github.com/libvips/libvips | Incorporada como dependencia de Sharp. Impacto: se enlaza como biblioteca compartida; si se distribuyen binarios hay que cumplir la LGPL. El código de la aplicación no se publica como binario. |
| semver | 7.8.x | — | ISC | github.com/npm/node-semver | Transitiva de Sharp. |
| @img/colour | 1.1.0 | 1 mar 2026 | MIT | — | Transitiva de Sharp. |
| onnxruntime-web | 1.31.1 | — | MIT | — | **Eliminada** (IA). |
| Modelo ORMBG | fp32 | — | Apache-2.0 | Hugging Face | **Eliminado** (IA). |
| png-to-ico | — | — | — | — | **No incorporada**: el ICO se genera y verifica con código propio (`src/lib/ico.ts`). |
| OpenCV.js | — | — | — | — | **No incorporada**: Canvas y algoritmos propios cubren los métodos requeridos. |

Verificación: `npm audit` devolvió **0 vulnerabilidades** después de instalar Sharp. Las fechas de publicación se consultaron con `npm view`.
No se hizo una revisión manual del código fuente de libvips ni de sus dependencias nativas: es un límite de la evaluación.

Ninguna herramienta de imagen carga scripts ni estilos desde CDN. El único código que corre fuera del navegador es el endpoint de Sharp, y solo escucha peticiones del mismo equipo.

## 3. Límites (RG-09, RG-11)

Todos los valores están en `src/shared/image-limits.ts`. La interfaz y el servidor los leen de ahí.

| Parámetro | Valor | Justificación |
| --- | --- | --- |
| Peso mínimo | 1 byte (rechaza archivos vacíos) | Sin mínimo funcional adicional. |
| Peso máximo | 20 MB | Preventivo: cada decodificación ocupa memoria en el navegador. |
| Lado mínimo | 1 px | Límite técnico de Canvas y Sharp. No se inventa un mínimo propio. |
| Lado máximo | 8000 px | Preventivo. Canvas admite más, pero el consumo de memoria crece con el lado. |
| Píxeles máximos, Quitar fondo | 20 MP | Copia RGBA en memoria (≈80 MB) más máscara y pila de relleno. |
| Píxeles máximos, Convertir | 20 MP | Un canvas de salida a la vez (≈80 MB). |
| Píxeles máximos, Mejorar con Canvas | 12 MP | Varias copias en el worker (original, resultado y blur). Más memoria, por eso el límite es menor. |
| Píxeles máximos, Mejorar con Sharp | 20 MP | Se aplica como `limitInputPixels` de libvips. |
| Lote de conversión | 10 imágenes | Se procesan de a una. |
| Tiempo máximo de procesamiento | 30 s | Cancela la espera en la interfaz. En Sharp el trabajo ya iniciado sigue hasta terminar (ver sección 9). |
| Procesamientos simultáneos (Sharp) | 1 | El servidor responde 429 si ya hay uno en curso. |

Las comprobaciones se hacen en este orden antes de decodificar: tamaño → firma → extensión y MIME → dimensiones leídas del encabezado → decodificación. Así una imagen que supera el límite de píxeles nunca se decodifica (evita los archivos que expanden mucho su tamaño al descomprimirse).

## 4. Formatos admitidos

| Componente | Entrada | Salida |
| --- | --- | --- |
| Quitar fondo | JPG, JPEG, PNG, WebP | PNG, WebP (si el navegador lo codifica), JPG (con color de fondo) |
| Convertir | JPG, JPEG, PNG, WebP | JPG, PNG, WebP, ICO |
| Mejorar (Canvas y Sharp) | JPG, JPEG, PNG, WebP | JPG, PNG, WebP |

ICO **no** se admite como entrada: la conversión desde ICO no es segura de implementar sin un decodificador propio, así que se informa como limitación.

Los formatos se detectan por firma binaria (PNG `89 50 4E 47…`, JPEG `FF D8 FF`, WebP `RIFF….WEBP`). Un archivo con extensión `.jpg` que contiene PNG se rechaza con un mensaje que indica la discrepancia. GIF, BMP, ICO, PDF, SVG, HEIC/AVIF se rechazan con su nombre.

## 5. Quitar fondo (sin IA)

Métodos, todos sobre una copia en memoria. El original nunca se modifica.

1. **Fondo uniforme**: quita los píxeles cuyo color está dentro de la tolerancia de blanco, negro, verde o del color medio de las esquinas.
2. **Seleccionar color**: cuentagotas sobre la imagen, luego quita ese color con la tolerancia elegida.
3. **Región conectada**: tocás una zona; se quita esa zona y las partes del mismo color conectadas a ella (relleno por pila, 4 vecinos).
4. **Corrección con pincel**: borrar o recuperar con tamaño de pincel ajustable. Un trazo completo es un solo paso de deshacer.

Controles: tolerancia (0–100), deshacer (hasta 20 pasos), restaurar todo (deshacible), zoom, comparación antes/después con control deslizante.

Exportación: PNG con transparencia; WebP con transparencia solo si el navegador lo codifica de verdad (se comprueba); JPG con color de fondo elegido, con aviso de que no conserva transparencia. Antes de descargar, el archivo generado se verifica por firma.

**Limitaciones reales**: los algoritmos clásicos no separan bien cabello, sombras, objetos transparentes ni sujetos con colores parecidos al fondo. No hay selección automática de personas. Los fondos complejos requieren corrección manual con el pincel.

## 6. Convertir formato

- Conversiones de la lista prioritaria (JPG↔PNG, JPG↔WebP, PNG↔WebP, y a ICO desde PNG, JPG y WebP) más las restantes entre JPG, PNG y WebP.
- Opciones: formato de salida; mantener dimensiones o cambiarlas (conservando proporciones o no); calidad (solo JPG y WebP); color de fondo (solo JPG); encuadre ICO (recortar o ajustar con márgenes, y desplazamiento horizontal y vertical).
- **ICO**: se generan tamaños 16, 32, 48 y 256 (elegibles). Cada tamaño es un PNG embebido. El contenedor se escribe byte a byte (`src/lib/ico.ts`) y se vuelve a leer para verificar cabecera, tamaños y firmas PNG. No es un PNG con la extensión cambiada.
- Si el navegador no genera WebP, la opción aparece deshabilitada con su motivo.

## 7. Mejorar calidad

Dos métodos independientes desde la misma interfaz. Cada uno tiene sus propios límites, que se muestran por separado.

- **Sharp** (servidor local, `server/image-enhance.ts`): operaciones de libvips: normalización de niveles, modulación de brillo y saturación, contraste lineal, suavizado leve (solo intensa) y enfoque. Se aplica la orientación EXIF y la salida no conserva metadatos.
- **Canvas** (worker, `src/workers/enhance.worker.ts`, `src/lib/enhance-core.ts`): brillo, contraste, saturación y enfoque por máscara de nitidez (matriz de convolución 3×3 [1 2 1]), con redimensionado de interpolación seleccionable (rápida, media, alta). Sin denoise (no implementado en Canvas).

Intensidades: suave, media e intensa para ambos métodos. Los parámetros están en `PRESETS` (Canvas) y en `applyIntensity` (Sharp). Ninguna intensidad se presenta como recuperación de calidad.

Cada resultado se genera siempre desde el archivo original, así que no se acumulan filtros. Se pueden guardar hasta 6 resultados para compararlos.

**Limitaciones reales**: no recupera detalles inexistentes, no hace superresolución, no reconstruye rostros borrosos.

## 8. Procesamiento local, red y uso sin Internet (RG-03)

- Canvas y las herramientas de quitar fondo y convertir no envían nada a ningún servidor. Son JavaScript del mismo origen y `blob:` locales.
- El método Sharp envía la imagen **solo** a `/api/imagen/mejorar` del mismo origen (127.0.0.1 o localhost). El endpoint rechaza otros hosts, otros orígenes y `Sec-Fetch-Site` cruzado.
- No hay telemetría, no hay CDN, no hay descarga automática de componentes en tiempo de uso.

Verificación de red realizada: durante las pruebas se listaron todas las peticiones de red de las páginas. **Todas** fueron al mismo origen (127.0.0.1:5173) o a `blob:` locales. Ningún recurso externo se cargó.

**No se hizo la prueba completa sin Internet** (desconectar la red del equipo y repetir el flujo). La comprobación de red se basó en el listado de peticiones y en la ausencia de URLs externas en el código fuente y en `dist/`. Cuando se pueda, conviene repetir las pruebas con el adaptador de red desactivado.

## 9. Seguridad (RG-05, RG-06, RG-07, RG-08, RG-12)

Comprobado en ejecución (ver sección 10):

- Endpoint de Sharp: origen ajeno → 403; host ajeno → 403 (Vite lo bloquea antes); cuerpo mayor al límite → 413; intensidad no válida → 400; contenido que no es imagen → 415; método GET al endpoint de mejora → 405; petición válida → 200 con cabeceras `Cache-Control: no-store` y `X-Content-Type-Options: nosniff`.
- Errores sin rutas internas ni trazas: los errores inesperados devuelven un mensaje genérico y solo registran el nombre del error en consola.
- Nada se escribe en disco: los resultados existen como `blob:` en memoria y se revocan al cerrar la página o al reemplazar la imagen.
- La salida Sharp elimina metadatos EXIF; se aplica la orientación antes de eliminarla, para que la imagen se vea derecha. **No hay opción para conservar metadatos**: queda como limitación documentada.
- Los archivos cargados no se ejecutan: se tratan como datos, se decodifican solo tras validar y nunca se muestran como SVG ni HTML.

Pendiente de revisión: el endpoint Sharp escucha en el mismo puerto que Vite; no se probó con un puerto ocupado por otro proceso.

## 10. Pruebas realizadas

Ejecutadas con el servidor de desarrollo (`npm run dev`) y el navegador integrado:

| Prueba | Resultado |
| --- | --- |
| Compilación TypeScript de la app y del servidor (`npm run typecheck`) | Sin errores |
| `npm run build` (typecheck + Vite) | Correcto. `dist/` sin ONNX, sin modelos y sin WASM. |
| Búsqueda de restos de IA en código, `dist/`, CSP y `package.json` | Sin coincidencias |
| `npm audit` | 0 vulnerabilidades |
| Quitar fondo: carga válida, vista previa, fondo uniforme blanco, deshacer | Correcto (48 680 px quitados; deshacer restauró el estado previo) |
| Quitar fondo: texto con extensión `.png` | Rechazado: «El contenido no es una imagen JPG, PNG o WebP válida…» |
| Quitar fondo: PNG con extensión `.jpg` | Rechazado con el mensaje de discrepancia |
| Quitar fondo: 5000 × 5000 px (25 MP) | Rechazado: «…supera el límite configurado para esta herramienta: 20.0 MP» |
| Quitar fondo: pincel con eventos de puntero sintéticos (8 movimientos) y deshacer | Un trazo borró 1714 píxeles y un solo «Deshacer» los restauró todos (un trazo = un paso). La prueba con el ratón real se hizo antes de corregir el historial y no se repitió. |
| Convertir: PNG → ICO | Válido: cabecera `00 00 01 00`, 4 entradas (16, 32, 48, 256 px), PNG embebidos |
| Convertir: PNG → JPG, PNG → WebP, PNG → PNG | Firmas correctas en los tres casos |
| Mejorar con Canvas (intensa, PNG) | Correcto: 640 × 480 px, 7.9 KB |
| Mejorar con Sharp (media, WebP) | Correcto: 640 × 480 px, 0.7 KB |
| Endpoint Sharp: origen ajeno, tamaño, parámetros, contenido no válido, método GET, petición válida con redimensionado (400 × 300) | Cada caso devolvió el código esperado (403, 413, 400, 415, 405, 200) |
| Consola del navegador en las páginas probadas | Sin errores |

No ejecutadas (quedan como pendientes):

- Pruebas con imágenes medianas y grandes reales (fotografías de 5–20 MP), con medición de memoria y tiempo. Solo se probaron imágenes sintéticas de hasta 640 × 480 px, salvo el caso de rechazo de 25 MP.
- Imágenes con metadatos EXIF reales y con rotación. No hay fotos de prueba en el proyecto.
- Imágenes transparentes reales en Canvas y Sharp (se probó el canal alfa con el pincel y el relleno de fondo JPG, no una foto con transparencia de origen).
- Archivos corruptos de verdad (JPEG o WebP truncados). Se rechazó el caso de un archivo que no es imagen y el de dimensiones inválidas, pero no un JPEG truncado.
- Cancelación durante el procesamiento: el código existe (botón «Cancelar» en las tres páginas), pero no se ejecutó.
- Operaciones repetidas en bucle y liberación de memoria (observar el consumo tras muchas operaciones).
- Prueba en Docker: no se construyó la imagen. El build de Alpine con Sharp no se verificó.
- Prueba de la página en producción (Nginx estático), donde el método Sharp debe mostrarse deshabilitado. Por código, la detección trata cualquier error del endpoint como «no disponible», pero no se comprobó en el contenedor.
- Prueba sin Internet (ver sección 8).
- Otros navegadores (Firefox, Safari). Solo se probó el navegador integrado.

## 11. Riesgos y limitaciones pendientes

1. **Sharp no existe en la imagen Docker/Nginx**: el método está disponible solo con `npm run dev` o `npm run preview`. Si se necesita en producción, habría que añadir un servicio Node aislado, lo que cambia la arquitectura. No se hizo por no alterar el despliegue.
2. **Tiempo máximo en Sharp**: si vence el límite, la respuesta sale con error, pero libvips sigue el trabajo hasta terminar. Sharp no permite interrumpirlo. Se mitiga con el límite de un procesamiento simultáneo.
3. **Memoria**: los límites de 20 MP y 12 MP son estimaciones basadas en el consumo teórico por píxel. No se midió el consumo real en un equipo con poca memoria.
4. **Reducción de copia**: la especificación pide ofrecer una copia reducida cuando la imagen supera el límite. **No se implementó**: la imagen se rechaza con el motivo y el límite.
5. **Metadatos**: la salida de Sharp no conserva EXIF; la de Canvas tampoco. No hay opción para conservarlos (orientación y perfil de color pueden perderse).
6. **Canvas sin denoise**: el método Canvas no ofrece suavizado de ruido; el método Sharp sí, solo en la intensidad intensa.
7. **Interpolación en Canvas**: el navegador ofrece tres niveles de calidad de redimensionado; no se implementaron kernels propios.
8. **ICO como entrada**: no admitido.
9. **Licencia LGPL de libvips**: su impacto se documenta en la sección 2. Si la aplicación se distribuye como binario, debe cumplirse la LGPL.
10. **Títulos de página**: los títulos dicen «ChispaBox». Ese cambio ya estaba en los archivos al empezar esta revisión; no se modificó la marca.

## 12. Confirmaciones

- **Sin modelos de IA en el sitio público**: confirmado por búsqueda en `src/`, `server/`, `paginas/`, `dist/` y en las dependencias del sitio. La transcripción con Whisper es una herramienta local opcional (`extras/local/`) y no forma parte del sitio. Solo quedan algoritmos de procesamiento de píxeles y codificadores de imagen.
- **Sin Internet en uso normal**: confirmado por el listado de peticiones de red de las pruebas (solo mismo origen y `blob:`). La prueba completa desconectada **no** se hizo (sección 8).

## 13. Redimensionar y recortar imágenes

Página: `paginas/redimensionar-imagen/index.html`. Lógica: `src/scripts/redimensionar-imagen.ts` (interfaz) y `src/shared/resize-crop.ts` (cálculos puros). Tarjeta en la portada: la antes marcada «Próximamente» ahora enlaza a la herramienta.

- **Sin dependencias nuevas**: usa solo la API Canvas del navegador y código propio. Sin IA, sin CDN, sin red.
- **Recorte**: proporciones 1:1, 4:3, 3:4, 3:2, 16:9, 9:16 o libre; el recorte se centra al elegir proporción; coordenadas y tamaño editables a mano (en píxeles de la original). Un recorte que se sale de la imagen se rechaza con un mensaje, no se ajusta en silencio.
- **Tamaño de salida**: opcional. Con «Conservar proporciones», al escribir un lado se calcula el otro. Límites: lado máximo 8000 px y 20 MP totales (`TOOL_LIMITS.redimensionar` y `IMAGE_LIMITS`).
- **Formatos de salida**: PNG (sin pérdida, con transparencia), JPG (con color de fondo) y WebP (solo si el navegador lo codifica de verdad).
- **Entrada**: JPG, PNG, WebP; validación por firma binaria antes de decodificar (la misma que el resto de herramientas).
- **Privacidad**: el archivo nunca sale del navegador; la descarga es un blob local.

Pruebas: `npm run test:redimensionar` (16 casos de recorte, tamaño y límites). Verificado en el navegador integrado: carga de PNG 1600 × 900, recorte 1:1 centrado (900 × 900), redimensionado a 300 × 300 en JPG (firma `FF D8 FF`), rechazo de recorte fuera de la imagen, sin scroll horizontal a 375 px.

Pendiente: no se probó con fotos reales de 5–20 MP ni en otros navegadores; `dist/` no se regeneró.
