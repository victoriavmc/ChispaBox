import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseYoutubeVideoUrl } from '../../server/youtube/url.ts';
import { buildAudioName, buildVideoName, sanitizeFileName, withExtension } from '../../web/shared/youtube-names.ts';

const ID = 'aqz-KE-bpKQ';

test('acepta los formatos de enlace admitidos y los reconstruye en forma canónica', () => {
  const cases = [
    `https://www.youtube.com/watch?v=${ID}`,
    `https://youtube.com/watch?v=${ID}&t=42s`,
    `https://m.youtube.com/watch?feature=share&v=${ID}`,
    `https://youtu.be/${ID}`,
    `https://www.youtube.com/shorts/${ID}`,
    `  https://www.youtube.com/watch?v=${ID}  `,
  ];
  for (const input of cases) {
    const result = parseYoutubeVideoUrl(input);
    assert.equal(result.ok, true, input);
    if (result.ok) {
      assert.equal(result.videoId, ID);
      assert.equal(result.canonicalUrl, `https://www.youtube.com/watch?v=${ID}`);
    }
  }
});

test('rechaza listas, canales, hosts ajenos, HTTP, credenciales y puertos', () => {
  const cases = [
    `https://www.youtube.com/playlist?list=PLabc`,
    `https://www.youtube.com/watch?list=PLabc`,
    `https://www.youtube.com/@canal`,
    `https://www.youtube.com/watch?v=${ID}&v=${ID}`,
    `http://www.youtube.com/watch?v=${ID}`,
    `https://user:pass@www.youtube.com/watch?v=${ID}`,
    `https://www.youtube.com:8443/watch?v=${ID}`,
    `https://www.youtube.com.evil.example/watch?v=${ID}`,
    `https://evil.example/?https://www.youtube.com/watch?v=${ID}`,
    `https://127.0.0.1/watch?v=${ID}`,
    `https://localhost/watch?v=${ID}`,
    `https://www.youtube.com/watch?v=short`,
    `https://www.youtube.com/watch?v=${ID}%0A--exec`,
    `file:///etc/passwd`,
    `--exec=calc ${ID}`,
    '',
    'x'.repeat(400),
  ];
  for (const input of cases) {
    assert.equal(parseYoutubeVideoUrl(input).ok, false, input);
  }
  assert.equal(parseYoutubeVideoUrl(undefined).ok, false);
  assert.equal(parseYoutubeVideoUrl(42).ok, false);
});

test('sanitiza nombres: conserva tildes y Unicode, sustituye caracteres prohibidos', () => {
  assert.equal(sanitizeFileName('Pastillitas del Olvido'), 'Pastillitas del Olvido');
  assert.equal(sanitizeFileName('Canción: ¿Sí? ñandú'), 'Canción_ ¿Sí_ ñandú');
  assert.equal(sanitizeFileName('AC/DC <live>'), 'AC_DC _live_');
  assert.equal(sanitizeFileName('  ..oculto.  '), 'oculto');
  assert.equal(sanitizeFileName('CON'), '_CON');
  assert.equal(sanitizeFileName('lpt1.txt'), '_lpt1.txt');
  assert.equal(sanitizeFileName('   '), 'descarga');
  assert.equal(sanitizeFileName('a\u0000b\u001Fc'), 'a_b_c');
});

test('limita la longitud por caracteres sin partir emojis', () => {
  const long = '🎵'.repeat(300);
  const result = sanitizeFileName(long, 180);
  assert.equal(Array.from(result).length, 180);
  assert.equal(result, '🎵'.repeat(180));
});

test('nombre de audio: "Artista - Título" sin símbolos extra si falta el artista', () => {
  assert.equal(buildAudioName('Tan Biónica', 'Pastillitas del Olvido'), 'Tan Biónica - Pastillitas del Olvido');
  assert.equal(buildAudioName('', 'Pastillitas del Olvido'), 'Pastillitas del Olvido');
  assert.equal(buildAudioName('  ', '  Título  '), 'Título');
  assert.equal(buildAudioName('', ''), 'Sin título');
  assert.equal(withExtension('Tan Biónica - Pastillitas del Olvido', 'mp3'), 'Tan Biónica - Pastillitas del Olvido.mp3');
});

test('nombre de video: «Canal - Título», o solo el título si no hay canal', () => {
  assert.equal(buildVideoName('scorpio', 'nikki idol — the bad angel'), 'scorpio - nikki idol — the bad angel');
  assert.equal(buildVideoName(null, 'Solo título'), 'Solo título');
  assert.equal(buildVideoName('  ', 'Título'), 'Título');
  assert.equal(buildVideoName('AC/DC', 'Live?'), 'AC_DC - Live_');
});
