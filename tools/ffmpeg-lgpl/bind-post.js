// API de ejecución compatible con @ffmpeg/core 0.12 (lo que usa @ffmpeg/ffmpeg).
Module['ret'] = -1;
Module['timeout'] = -1;
Module['logger'] = function () {};
Module['progress'] = function () {};
Module['exec'] = function () {
  var args = ['-nostdin', '-y'].concat(Array.prototype.slice.call(arguments));
  __duracion = null;
  Module['ret'] = -1;
  try {
    Module['ret'] = Module['callMain'](args);
  } catch (e) {
    if (e && typeof e.status === 'number') {
      Module['ret'] = e.status;
    } else if (!String(e && e.message).startsWith('Aborted')) {
      throw e;
    }
  }
  return Module['ret'];
};
Module['ffprobe'] = function () {
  throw new Error('ffprobe no está incluido en esta compilación de ChispaBox');
};
Module['setLogger'] = function (fn) { Module['logger'] = fn; };
Module['setProgress'] = function (fn) { Module['progress'] = fn; };
Module['setTimeout'] = function (ms) { Module['timeout'] = ms; };
Module['reset'] = function () { Module['ret'] = -1; Module['timeout'] = -1; };
Module['receiveProgress'] = function (p, t) { Module['progress']({ progress: p, time: t }); };
