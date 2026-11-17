// Enrutamiento de la salida de FFmpeg hacia Module.logger y cálculo del progreso.
// Compatible con la API de @ffmpeg/core 0.12 (setLogger / setProgress), que usa @ffmpeg/ffmpeg.
var __duracion = null;
function __segundos(h, m, s, c) {
  return (+h) * 3600 + (+m) * 60 + (+s) + (+('0.' + c));
}
Module['print'] = function (message) {
  Module['logger']({ type: 'stdout', message: message });
};
Module['printErr'] = function (message) {
  if (!String(message).startsWith('Aborted(native code called abort())')) {
    Module['logger']({ type: 'stderr', message: message });
  }
  var d = /Duration: (\d+):(\d+):(\d+)\.(\d+)/.exec(message);
  if (d && __duracion === null) __duracion = __segundos(d[1], d[2], d[3], d[4]);
  var t = /time=(\d+):(\d+):(\d+)\.(\d+)/.exec(message);
  if (t && __duracion) {
    var s = __segundos(t[1], t[2], t[3], t[4]);
    Module['receiveProgress'](Math.min(1, s / __duracion), s * 1e6);
  }
};

// Resolución de URL igual que el núcleo de @ffmpeg/core 0.12: @ffmpeg/ffmpeg pasa en el fragmento de
// mainScriptUrlOrBlob (base64 de JSON) las URL del .wasm y del worker.
Module['locateFile'] = function (path, prefix) {
  var mainScriptUrlOrBlob = Module['mainScriptUrlOrBlob'];
  if (mainScriptUrlOrBlob) {
    var urls = JSON.parse(atob(mainScriptUrlOrBlob.slice(mainScriptUrlOrBlob.lastIndexOf('#') + 1)));
    if (path.endsWith('.wasm')) return urls.wasmURL;
    if (path.endsWith('.worker.js')) return urls.workerURL;
  }
  return prefix + path;
};
