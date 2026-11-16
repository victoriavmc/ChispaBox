import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildAudioOptions, buildVideoOptions, sourceAudioKbps, type RawFormat } from '../../server/youtube/formats.ts';
import { buildFormatSelector } from '../../server/youtube/ytdlp.ts';
import { loadYoutubeConfig } from '../../server/youtube/config.ts';
import { describeYtDlpFailure } from '../../server/youtube/errors.ts';

// Forma de los metadatos reales de yt-dlp (campos recortados), con audio AAC/Opus y vídeo H.264/VP9/AV1.
const FORMATS: RawFormat[] = [
  { format_id: 'sb0', ext: 'mhtml', vcodec: 'none', acodec: 'none' },
  { format_id: '139', ext: 'm4a', vcodec: 'none', acodec: 'mp4a.40.5', abr: 48.8 },
  { format_id: '249', ext: 'webm', vcodec: 'none', acodec: 'opus', abr: 49.5 },
  { format_id: '140', ext: 'm4a', vcodec: 'none', acodec: 'mp4a.40.2', abr: 129.5 },
  { format_id: '251', ext: 'webm', vcodec: 'none', acodec: 'opus', abr: 128.6 },
  { format_id: '160', ext: 'mp4', vcodec: 'avc1.4D400C', acodec: 'none', height: 144 },
  { format_id: '278', ext: 'webm', vcodec: 'vp9', acodec: 'none', height: 144 },
  { format_id: '133', ext: 'mp4', vcodec: 'avc1.4D4015', acodec: 'none', height: 240 },
  { format_id: '242', ext: 'webm', vcodec: 'vp9', acodec: 'none', height: 240 },
  { format_id: '299', ext: 'mp4', vcodec: 'avc1.64002A', acodec: 'none', height: 1080 },
  { format_id: '303', ext: 'webm', vcodec: 'vp9', acodec: 'none', height: 1080 },
  { format_id: '401', ext: 'mp4', vcodec: 'av01.0.13M.08', acodec: 'none', height: 2160 },
];

test('ofrece solo alturas realmente disponibles, por contenedor', () => {
  const options = buildVideoOptions(FORMATS);
  const byContainer = Object.fromEntries(options.map((o) => [o.contenedor, o.alturas]));
  assert.deepEqual(byContainer.mp4, [1080, 240, 144], 'MP4 solo con H.264 y audio AAC; no 2160p (AV1)');
  assert.deepEqual(byContainer.webm, [1080, 240, 144]);
  assert.deepEqual(byContainer.mkv, [2160, 1080, 240, 144], 'MKV admite cualquier vídeo con audio');
});

test('no ofrece MP4 si no hay audio AAC, ni WebM si no hay audio WebM', () => {
  const onlyVideo: RawFormat[] = FORMATS.filter((f) => f.acodec === 'none');
  assert.deepEqual(buildVideoOptions(onlyVideo), []);
  const noAac = FORMATS.filter((f) => f.format_id !== '139' && f.format_id !== '140');
  const options = buildVideoOptions(noAac);
  assert.equal(options.some((o) => o.contenedor === 'mp4'), false);
  assert.equal(options.some((o) => o.contenedor === 'webm'), true);
});

test('deduce el bitrate de la fuente y nunca ofrece más que el origen', () => {
  assert.equal(sourceAudioKbps(FORMATS), 129);
  assert.equal(sourceAudioKbps([{ format_id: 'x', ext: 'mp4', vcodec: 'avc1', acodec: 'none', height: 360 }]), null);

  const audio = buildAudioOptions(129);
  const mp3 = audio.find((a) => a.formato === 'mp3');
  assert.deepEqual(mp3?.kbps, [128, 96], 'con origen de 129 kbps no se ofrece 192 ni 320');
  assert.deepEqual(audio.find((a) => a.formato === 'wav')?.kbps, []);
  assert.deepEqual(audio.find((a) => a.formato === 'flac')?.kbps, []);
  assert.deepEqual(buildAudioOptions(320).find((a) => a.formato === 'm4a')?.kbps, [320, 256, 192, 128, 96]);
  assert.deepEqual(buildAudioOptions(null).find((a) => a.formato === 'mp3')?.kbps, [128]);
});

test('el selector de formato de yt-dlp usa solo valores validados', () => {
  assert.equal(buildFormatSelector('mp4', 1080), 'bv*[height=1080][vcodec^=avc1][ext=mp4]+ba[ext=m4a]/b[height=1080][ext=mp4]');
  assert.throws(() => buildFormatSelector('mp4', 1080.5));
  assert.throws(() => buildFormatSelector('mp4', -1));
});

test('configuración: producción deshabilita; valores no válidos quedan cerrados', () => {
  assert.equal(loadYoutubeConfig({ NODE_ENV: 'production' }).enabled, false);
  assert.equal(loadYoutubeConfig({}).enabled, true);
  assert.equal(loadYoutubeConfig({ NODE_ENV: 'production', YOUTUBE_DOWNLOADS_ENABLED: 'true' }).enabled, true);
  assert.equal(loadYoutubeConfig({ YOUTUBE_DOWNLOADS_ENABLED: 'false' }).enabled, false);
  const invalid = loadYoutubeConfig({ YOUTUBE_DOWNLOADS_ENABLED: 'si' });
  assert.equal(invalid.enabled, false);
  assert.equal(invalid.warnings.length, 1);
});

test('configuración: host y puerto vienen del entorno, con acceso local por defecto', () => {
  const defaults = loadYoutubeConfig({});
  assert.equal(defaults.host, '127.0.0.1');
  assert.deepEqual([...defaults.allowedHosts], ['localhost', '127.0.0.1', '[::1]']);
  const custom = loadYoutubeConfig({ API_HOST: '0.0.0.0', API_PORT: '8099', ALLOWED_HOSTS: 'app.ejemplo.test, LOCALHOST' });
  assert.equal(custom.host, '0.0.0.0');
  assert.equal(custom.port, 8099);
  assert.deepEqual([...custom.allowedHosts], ['app.ejemplo.test', 'localhost']);
  assert.equal(loadYoutubeConfig({ API_PORT: '99999' }).port, 5174);
  assert.equal(loadYoutubeConfig({ YOUTUBE_MAX_MINUTES: '0' }).maxDurationSeconds, 120 * 60);
});

test('los mensajes de error de yt-dlp no exponen salida técnica', () => {
  assert.match(describeYtDlpFailure('ERROR: [youtube] x: Private video', false), /privado/);
  assert.match(describeYtDlpFailure('ERROR: Sign in to confirm your age', false), /iniciar sesión/);
  assert.match(describeYtDlpFailure('ERROR: HTTP Error 429: Too Many Requests', false), /limitó/);
  assert.match(describeYtDlpFailure('ERROR: something C:\\Users\\secreto', false), /No se pudo completar/);
  assert.doesNotMatch(describeYtDlpFailure('ERROR: something C:\\Users\\secreto', false), /secreto|C:/);
  assert.match(describeYtDlpFailure('', true), /tiempo máximo/);
});
