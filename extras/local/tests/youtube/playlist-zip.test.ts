import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseYoutubePlaylistUrl } from '../../server/youtube/playlist.ts';
import { writeStoredZip } from '../../server/youtube/zip.ts';

test('acepta enlaces de playlist y rechaza otros', () => {
  const ok = parseYoutubePlaylistUrl('https://www.youtube.com/playlist?list=PLabcdefghij123');
  assert.equal(ok.ok, true);
  if (ok.ok) assert.equal(ok.canonicalUrl, 'https://www.youtube.com/playlist?list=PLabcdefghij123');

  const rejected = [
    'https://www.youtube.com/playlist?list=corta',
    'https://www.youtube.com/playlist',
    'https://www.youtube.com/playlist?list=PLabcdefghij123&list=PLotra00000',
    'https://www.youtube.com/watch?v=aqz-KE-bpKQ&list=PLabcdefghij123',
    'https://evil.example/playlist?list=PLabcdefghij123',
    'http://www.youtube.com/playlist?list=PLabcdefghij123',
    'https://www.youtube.com/@canal',
  ];
  for (const input of rejected) assert.equal(parseYoutubePlaylistUrl(input).ok, false, input);
});

test('el ZIP guardado sin compresión tiene entradas, tamaños y CRC coherentes', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'zip-test-'));
  try {
    const a = join(dir, 'a.txt');
    const b = join(dir, 'b.bin');
    writeFileSync(a, 'hola mundo\n');
    writeFileSync(b, Buffer.from(Array.from({ length: 70_000 }, (_, i) => i % 251)));
    const out = join(dir, 'out.zip');
    const size = await writeStoredZip(out, [
      { name: 'Canal - Título ñandú.txt', path: a },
      { name: 'Canal - Título ñandú (2).bin', path: b },
    ]);
    const data = readFileSync(out);
    assert.equal(data.length, size);

    // Fin del directorio central: firma, número de entradas y desplazamiento.
    const eocd = data.length - 22;
    assert.equal(data.readUInt32LE(eocd), 0x06054b50);
    assert.equal(data.readUInt16LE(eocd + 10), 2);
    const cdOffset = data.readUInt32LE(eocd + 16);
    assert.equal(data.readUInt32LE(cdOffset), 0x02014b50);
    assert.equal(data.readUInt32LE(cdOffset + 20), 11, 'tamaño de a.txt');
    // CRC-32 del contenido de a.txt
    const crc = (buf: Buffer): number => {
      let c = 0xffffffff;
      for (const byte of buf) {
        c ^= byte;
        for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      }
      return (c ^ 0xffffffff) >>> 0;
    };
    assert.equal(data.readUInt32LE(cdOffset + 16), crc(readFileSync(a)));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
