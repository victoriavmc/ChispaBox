import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { safeBaseName } from '../../src/shared/nombre-archivo.ts';

describe('safeBaseName', () => {
  it('quita la extensión y los caracteres prohibidos en nombres de archivo', () => {
    assert.equal(safeBaseName('Factura: 2026/03?.pdf', 'Texto OCR'), 'Factura 202603');
  });

  it('usa el nombre de respaldo cuando no queda nada útil', () => {
    assert.equal(safeBaseName('???.png', 'Texto OCR'), 'Texto OCR');
    assert.equal(safeBaseName('', 'Texto OCR'), 'Texto OCR');
  });
});
