import { test } from 'node:test';
import assert from 'node:assert/strict';
import { qrMatrix, qrSvg } from '../src/lib/qr.js';

const finderAt = (m, x, y) => {
  // 7x7 finder: dark ring, light ring, dark 3x3 centre.
  for (let dy = 0; dy < 7; dy += 1) {
    for (let dx = 0; dx < 7; dx += 1) {
      const d = Math.max(Math.abs(dx - 3), Math.abs(dy - 3));
      if (m[y + dy][x + dx] !== (d !== 2)) return false;
    }
  }
  return true;
};

test('QR size grows with the text and has the three finder patterns', () => {
  for (const [text, size] of [['A', 21], ['x'.repeat(40), 29], ['https://care.example/id/' + 'Q'.repeat(32), 33], ['y'.repeat(150), 49], ['w'.repeat(213), 57]]) {
    const m = qrMatrix(text);
    assert.equal(m.length, size, `size for ${text.length} chars`);
    assert.ok(finderAt(m, 0, 0) && finderAt(m, size - 7, 0) && finderAt(m, 0, size - 7), 'finder patterns');
  }
});

test('QR output is deterministic and rejects text that is too long', () => {
  assert.deepEqual(qrMatrix('hello'), qrMatrix('hello'));
  assert.throws(() => qrMatrix('z'.repeat(300)), /too long/);
});

test('QR SVG is accessible and escapes its label', () => {
  const svg = qrSvg('https://care.example', { label: 'Scan <me> & go' });
  assert.match(svg, /^<svg [^>]*role="img"/);
  assert.match(svg, /aria-label="Scan &lt;me&gt; &amp; go"/);
  assert.match(svg, /viewBox="0 0 33 33"/, '25 modules (version 2) + 4-module quiet zone on each side');
});
