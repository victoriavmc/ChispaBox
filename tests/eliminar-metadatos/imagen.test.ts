import { test } from 'node:test';
import assert from 'node:assert/strict';
import { crc32 } from 'node:zlib';
import {
  formatoImagenPorFirma,
  leerMetadatosImagen,
  limpiarMetadatosImagen,
  quedanDatosImagen,
} from '../../src/shared/eliminar-metadatos-imagen.ts';

const enc = new TextEncoder();
const dec = new TextDecoder('latin1');

function unir(...piezas: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(piezas.reduce((t, p) => t + p.length, 0));
  let o = 0;
  for (const p of piezas) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

function texto(s: string): Uint8Array {
  return enc.encode(s);
}

function u16(n: number): Uint8Array {
  return new Uint8Array([(n >> 8) & 0xff, n & 0xff]);
}

/** TIFF little-endian con entradas ASCII (Make, Model, DateTime), GPS y orientación opcional. */
function tiff(opts: { make?: string; model?: string; fecha?: string; gps?: boolean; orientacion?: number }): Uint8Array {
  const entradas: Array<{ tag: number; tipo: number; count: number; valor: Uint8Array }> = [];
  const extra: Uint8Array[] = [];
  let offsetExtra = 8 + 2 + 12 * 0; // se recalcula abajo
  const ascii = (s: string): Uint8Array => unir(texto(s), new Uint8Array([0]));
  const cadenas: Array<[number, string | undefined]> = [
    [0x010f, opts.make],
    [0x0110, opts.model],
    [0x0132, opts.fecha],
  ];
  for (const [tag, valor] of cadenas) {
    if (valor === undefined) continue;
    const bytes = ascii(valor);
    entradas.push({ tag, tipo: 2, count: bytes.length, valor: bytes });
  }
  if (opts.orientacion !== undefined) {
    entradas.push({ tag: 0x0112, tipo: 3, count: 1, valor: new Uint8Array([opts.orientacion & 0xff, 0, 0, 0]) });
  }
  if (opts.gps) entradas.push({ tag: 0x8825, tipo: 4, count: 1, valor: new Uint8Array([0x1a, 0, 0, 0]) });
  entradas.sort((a, b) => a.tag - b.tag);

  const cabecera = 8 + 2 + entradas.length * 12 + 4;
  offsetExtra = cabecera;
  const filas = entradas.map((e) => {
    const fila = new Uint8Array(12);
    const dv = new DataView(fila.buffer);
    dv.setUint16(0, e.tag, true);
    dv.setUint16(2, e.tipo, true);
    dv.setUint32(4, e.count, true);
    if (e.valor.length <= 4) {
      fila.set(e.valor, 8);
    } else {
      dv.setUint32(8, offsetExtra, true);
      extra.push(e.valor);
      offsetExtra += e.valor.length + (e.valor.length & 1);
    }
    return fila;
  });
  const ifd = new Uint8Array(2 + entradas.length * 12 + 4);
  new DataView(ifd.buffer).setUint16(0, entradas.length, true);
  filas.forEach((f, i) => ifd.set(f, 2 + i * 12));
  const cab = new Uint8Array([0x49, 0x49, 0x2a, 0x00, 0x08, 0x00, 0x00, 0x00]);
  return unir(cab, ifd, ...extra.map((e) => (e.length & 1 ? unir(e, new Uint8Array([0])) : e)));
}

function segmentoJpeg(marca: number, cuerpo: Uint8Array): Uint8Array {
  return unir(new Uint8Array([0xff, marca]), u16(cuerpo.length + 2), cuerpo);
}

/** JPEG sintético: JFIF, EXIF (cámara, fecha, GPS, miniatura), XMP, IPTC, COM, ICC, SOF, SOS y EOI. */
function jpegConDatos(orientacion?: number): Uint8Array {
  const exif = tiff({ make: 'Acme', model: 'X1', fecha: '2020:01:02 03:04:05', gps: true, orientacion });
  return unir(
    new Uint8Array([0xff, 0xd8]),
    segmentoJpeg(0xe0, unir(texto('JFIF\0'), new Uint8Array([1, 1, 0, 0, 1, 0, 1, 0, 0]))),
    segmentoJpeg(0xe1, unir(texto('Exif\0\0'), exif)),
    segmentoJpeg(0xe1, texto('http://ns.adobe.com/xap/1.0/\0<x:xmpmeta>Persona Real</x:xmpmeta>')),
    segmentoJpeg(0xed, texto('Photoshop 3.0\0IPTC-SECRETO')),
    segmentoJpeg(0xfe, texto('comentario privado')),
    segmentoJpeg(0xe2, unir(texto('ICC_PROFILE\0'), new Uint8Array([1, 1]), new Uint8Array(20).fill(7))),
    segmentoJpeg(0xc0, new Uint8Array([8, 0, 2, 0, 2, 1, 1, 0x11, 0])),
    segmentoJpeg(0xda, new Uint8Array([1, 1, 0, 0, 63, 0])),
    new Uint8Array([0x12, 0x34, 0xff, 0x00, 0xab, 0xff, 0xd0, 0x56]),
    new Uint8Array([0xff, 0xd9]),
    texto('DATOS-DESPUES-DEL-EOI'),
  );
}

function chunkPng(tipo: string, datos: Uint8Array): Uint8Array {
  const cuerpo = unir(texto(tipo), datos);
  const crc = new Uint8Array(4);
  new DataView(crc.buffer).setUint32(0, crc32(cuerpo));
  return unir(u32(datos.length), cuerpo, crc);
}

function u32(n: number): Uint8Array {
  const b = new Uint8Array(4);
  new DataView(b.buffer).setUint32(0, n);
  return b;
}

function pngConDatos(): Uint8Array {
  const ihdr = unir(u32(2), u32(2), new Uint8Array([8, 2, 0, 0, 0]));
  return unir(
    new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunkPng('IHDR', ihdr),
    chunkPng('tEXt', texto('Author\0Persona Real')),
    chunkPng('eXIf', tiff({ make: 'Acme', fecha: '2021:05:06 07:08:09', gps: true })),
    chunkPng('tIME', new Uint8Array([7, 230, 5, 6, 7, 8, 9])),
    chunkPng('iTXt', texto('XML:com.adobe.xmp\0\0\0\0\0<x:xmpmeta>secreto</x:xmpmeta>')),
    chunkPng('IDAT', new Uint8Array([1, 2, 3, 4, 5])),
    chunkPng('IEND', new Uint8Array(0)),
  );
}

function chunkWebp(tipo: string, datos: Uint8Array): Uint8Array {
  const pad = datos.length & 1 ? new Uint8Array([0]) : new Uint8Array(0);
  return unir(texto(tipo), u32le(datos.length), datos, pad);
}

function u32le(n: number): Uint8Array {
  const b = new Uint8Array(4);
  new DataView(b.buffer).setUint32(0, n, true);
  return b;
}

function webpConDatos(orientacion?: number): Uint8Array {
  const vp8x = new Uint8Array(10);
  vp8x[0] = 0x0c; // EXIF (0x08) y XMP (0x04) declarados
  const piezas: Uint8Array[] = [
    chunkWebp('VP8X', vp8x),
    chunkWebp('VP8 ', new Uint8Array([1, 2, 3, 4, 5])),
    chunkWebp('EXIF', tiff({ make: 'Acme', fecha: '2022:01:01 00:00:00', gps: true, orientacion })),
    chunkWebp('XMP ', texto('<x:xmpmeta>secreto</x:xmpmeta>')),
  ];
  const cuerpo = unir(texto('WEBP'), ...piezas);
  return unir(texto('RIFF'), u32le(cuerpo.length), cuerpo);
}

function contiene(b: Uint8Array, s: string): boolean {
  return dec.decode(b).includes(s);
}

test('detecta JPEG, PNG y WebP por firma, no por extensión', () => {
  assert.equal(formatoImagenPorFirma(jpegConDatos()), 'jpeg');
  assert.equal(formatoImagenPorFirma(pngConDatos()), 'png');
  assert.equal(formatoImagenPorFirma(webpConDatos()), 'webp');
  assert.equal(formatoImagenPorFirma(texto('%PDF-1.4')), null);
});

test('JPEG: lee cámara, fecha, GPS, XMP, IPTC y comentarios', () => {
  const m = leerMetadatosImagen(jpegConDatos());
  assert.equal(m.exif, true);
  assert.equal(m.gps, true);
  assert.equal(m.camara, 'Acme X1');
  assert.equal(m.fecha, '2020:01:02 03:04:05');
  assert.equal(m.xmp, true);
  assert.equal(m.iptc, true);
  assert.equal(m.textos, 1);
  assert.equal(quedanDatosImagen(m), true);
});

test('JPEG: la copia no conserva EXIF, XMP, IPTC, comentarios ni datos tras el EOI', () => {
  const { bytes, formato } = limpiarMetadatosImagen(jpegConDatos());
  assert.equal(formato, 'jpeg');
  for (const s of ['Exif', 'Acme', 'xmpmeta', 'Persona Real', 'IPTC-SECRETO', 'comentario privado', 'DATOS-DESPUES']) {
    assert.equal(contiene(bytes, s), false, `queda «${s}»`);
  }
  assert.equal(quedanDatosImagen(leerMetadatosImagen(bytes)), false);
  assert.equal(leerMetadatosImagen(bytes).gps, false);
});

test('JPEG: conserva píxeles (datos comprimidos), JFIF y perfil de color ICC', () => {
  const { bytes } = limpiarMetadatosImagen(jpegConDatos());
  assert.equal(contiene(bytes, 'JFIF\0'), true);
  assert.equal(contiene(bytes, 'ICC_PROFILE\0'), true);
  const entropia = unir(new Uint8Array([0x12, 0x34, 0xff, 0x00, 0xab, 0xff, 0xd0, 0x56]), new Uint8Array([0xff, 0xd9]));
  assert.equal(contiene(bytes, dec.decode(entropia)), true);
  assert.equal(bytes[bytes.length - 2], 0xff);
  assert.equal(bytes[bytes.length - 1], 0xd9);
});

test('JPEG: si estaba girada, conserva la orientación con un EXIF mínimo', () => {
  const { bytes } = limpiarMetadatosImagen(jpegConDatos(6));
  assert.equal(contiene(bytes, 'Exif\0\0'), true);
  assert.equal(contiene(bytes, 'GPS'), false);
  const m = leerMetadatosImagen(bytes);
  assert.equal(m.gps, false);
  assert.equal(m.camara, null);
  assert.equal(quedanDatosImagen(m), false, 'un EXIF que solo lleva orientación no cuenta como dato');
  // La orientación queda en la entrada 0x0112 (SHORT = 6).
  const pos = dec.decode(bytes).indexOf('Exif\0\0') + 6;
  const ifd = pos + 8;
  assert.equal(bytes[ifd + 2 + 0], 0x12);
  assert.equal(bytes[ifd + 2 + 1], 0x01);
  assert.equal(bytes[ifd + 2 + 8], 6);
});

test('PNG: lee y quita textos, eXIf y tIME; conserva píxeles y CRC válidos', () => {
  const original = pngConDatos();
  const m = leerMetadatosImagen(original);
  assert.equal(m.exif, true);
  assert.equal(m.gps, true);
  assert.equal(m.camara, 'Acme');
  assert.equal(m.textos, 2);
  assert.equal(m.xmp, true);

  const { bytes, formato } = limpiarMetadatosImagen(original);
  assert.equal(formato, 'png');
  for (const s of ['Persona Real', 'secreto', 'eXIf', 'tEXt', 'iTXt', 'tIME', 'Acme']) {
    assert.equal(contiene(bytes, s), false, `queda «${s}»`);
  }
  assert.equal(quedanDatosImagen(leerMetadatosImagen(bytes)), false);
  assert.equal(contiene(bytes, 'IDAT'), true);

  // Cada chunk de la salida debe tener CRC correcto.
  let pos = 8;
  while (pos < bytes.length) {
    const largo = new DataView(bytes.buffer, bytes.byteOffset + pos, 4).getUint32(0);
    const cuerpo = bytes.subarray(pos + 4, pos + 8 + largo);
    const crc = new DataView(bytes.buffer, bytes.byteOffset + pos + 8 + largo, 4).getUint32(0);
    assert.equal(crc32(cuerpo) >>> 0, crc >>> 0);
    pos += 12 + largo;
  }
  assert.equal(pos, bytes.length);
});

test('WebP: quita EXIF y XMP, limpia flags de VP8X y mantiene el tamaño RIFF correcto', () => {
  const original = webpConDatos();
  const m = leerMetadatosImagen(original);
  assert.equal(m.exif, true);
  assert.equal(m.gps, true);
  assert.equal(m.xmp, true);

  const { bytes, formato } = limpiarMetadatosImagen(original);
  assert.equal(formato, 'webp');
  assert.equal(contiene(bytes, 'EXIF'), false);
  assert.equal(contiene(bytes, 'XMP '), false);
  assert.equal(contiene(bytes, 'Acme'), false);
  assert.equal(contiene(bytes, 'VP8 '), true);
  assert.equal(new DataView(bytes.buffer, bytes.byteOffset + 4, 4).getUint32(0, true), bytes.length - 8);
  assert.equal(bytes[12 + 8] & 0x0c, 0); // flags de VP8X sin EXIF ni XMP
});

test('WebP: con orientación, conserva un EXIF mínimo y marca el flag EXIF', () => {
  const { bytes } = limpiarMetadatosImagen(webpConDatos(8));
  assert.equal(contiene(bytes, 'EXIF'), true);
  assert.equal(contiene(bytes, 'GPS'), false);
  assert.equal(bytes[12 + 8] & 0x08, 0x08);
  assert.equal(leerMetadatosImagen(bytes).camara, null);
});

test('rechaza archivos que no son imágenes admitidas o están truncados', () => {
  assert.throws(() => limpiarMetadatosImagen(texto('hola mundo')), /no es una imagen/);
  assert.throws(() => leerMetadatosImagen(texto('GIF89a....')), /no es una imagen/);
  const truncado = jpegConDatos().subarray(0, 40);
  assert.throws(() => limpiarMetadatosImagen(truncado));
  const pngTruncado = pngConDatos().subarray(0, 30);
  assert.throws(() => limpiarMetadatosImagen(pngTruncado));
});
