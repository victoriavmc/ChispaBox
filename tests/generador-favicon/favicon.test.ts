import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildIco, verifyIco } from '../../src/lib/ico.ts';
import {
  FAVICON_PNG_SIZES,
  buildHeadSnippet,
  buildPackageFiles,
  buildWebManifest,
  cleanSiteName,
  computeFit,
  normalizeHexColor,
  pngFileName,
} from '../../src/shared/favicon.ts';

// PNG mínimo válido (firma + cabecera IHDR de 1×1); buildIco solo exige la firma.
const PNG = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
  0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4,
  0x89, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
]);

describe('computeFit', () => {
  it('cover llena el cuadrado y recorta el eje sobrante', () => {
    const r = computeFit(400, 200, 100, 'cover');
    assert.equal(r.dh, 100);
    assert.equal(r.dw, 200);
    assert.equal(r.dx, -50);
    assert.equal(r.dy, 0);
  });

  it('contain entra completa y centra con bordes', () => {
    const r = computeFit(400, 200, 100, 'contain');
    assert.equal(r.dw, 100);
    assert.equal(r.dh, 50);
    assert.equal(r.dx, 0);
    assert.equal(r.dy, 25);
  });

  it('rechaza dimensiones no válidas', () => {
    assert.throws(() => computeFit(0, 10, 16, 'cover'));
    assert.throws(() => computeFit(10, 10, 0, 'contain'));
  });
});

describe('normalizeHexColor', () => {
  it('acepta #RRGGBB y normaliza a minúsculas', () => {
    assert.equal(normalizeHexColor(' #E61932 '), '#e61932');
  });

  it('rechaza cualquier otro texto', () => {
    assert.equal(normalizeHexColor('red'), null);
    assert.equal(normalizeHexColor('#fff'), null);
    assert.equal(normalizeHexColor('#ff0000"><script>'), null);
  });
});

describe('cleanSiteName', () => {
  it('quita saltos de línea, recorta y usa el respaldo si queda vacío', () => {
    assert.equal(cleanSiteName('Hola\n  mundo\t'), 'Hola mundo');
    assert.equal(cleanSiteName('   '), 'Mi sitio');
    assert.equal(cleanSiteName('x'.repeat(100)).length, 60);
  });
});

describe('buildWebManifest', () => {
  it('genera JSON válido con los íconos y los colores opcionales', () => {
    const json = JSON.parse(buildWebManifest({ name: 'Café "Luna"', themeColor: '#e61932', backgroundColor: null }));
    assert.equal(json.name, 'Café "Luna"');
    assert.equal(json.theme_color, '#e61932');
    assert.equal(json.background_color, undefined);
    assert.deepEqual(
      json.icons.map((i: { src: string }) => i.src),
      ['android-chrome-192x192.png', 'android-chrome-512x512.png'],
    );
  });
});

describe('buildHeadSnippet', () => {
  it('incluye meta theme-color solo si hay color', () => {
    assert.ok(buildHeadSnippet('#e61932').includes('<meta name="theme-color" content="#e61932" />'));
    assert.ok(!buildHeadSnippet(null).includes('theme-color'));
    assert.ok(buildHeadSnippet(null).includes('href="/site.webmanifest"'));
  });
});

describe('buildPackageFiles', () => {
  it('incluye ICO, PNG, manifiesto, fragmento y leeme en orden', () => {
    const pngs = new Map(FAVICON_PNG_SIZES.map((size) => [size, PNG] as const));
    const files = buildPackageFiles({
      pngs,
      ico: buildIco([{ size: 16, png: PNG }]),
      manifest: '{}',
      snippet: '<link />',
      readme: 'leeme',
    });
    const names = files.map((f) => f.name);
    assert.equal(names[0], 'favicon.ico');
    assert.ok(names.includes('apple-touch-icon.png'));
    assert.ok(names.includes('favicon-16x16.png'));
    assert.ok(names.includes('site.webmanifest'));
    assert.equal(names.length, 1 + FAVICON_PNG_SIZES.length + 3);
  });

  it('falla si falta un PNG del paquete', () => {
    assert.throws(() =>
      buildPackageFiles({ pngs: new Map(), ico: new Uint8Array(), manifest: '', snippet: '', readme: '' }),
    );
  });
});

describe('ICO del favicon', () => {
  it('el ICO de 16, 32 y 48 px se puede verificar', () => {
    const ico = buildIco([
      { size: 48, png: PNG },
      { size: 16, png: PNG },
      { size: 32, png: PNG },
    ]);
    const summary = verifyIco(ico);
    assert.deepEqual(summary.sizes, [16, 32, 48]);
  });
});

describe('pngFileName', () => {
  it('usa los nombres estándar de cada tamaño', () => {
    assert.equal(pngFileName(16), 'favicon-16x16.png');
    assert.equal(pngFileName(180), 'apple-touch-icon.png');
    assert.equal(pngFileName(512), 'android-chrome-512x512.png');
  });
});
