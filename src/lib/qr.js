/**
 * Small, dependency-free QR code encoder (byte mode, error correction level M,
 * versions 1-10, enough for URLs up to 213 bytes). Used for the medical ID QR
 * code, rendered as SVG so it prints sharply.
 */

// [total codewords, EC codewords per block, [blocks, data codewords per block]...] for level M
const VERSIONS = [
  null,
  [26, 10, [1, 16]],
  [44, 16, [1, 28]],
  [70, 26, [1, 44]],
  [100, 18, [2, 32]],
  [134, 24, [2, 43]],
  [172, 16, [4, 27]],
  [196, 18, [4, 31]],
  [242, 22, [2, 38], [2, 39]],
  [292, 22, [3, 36], [2, 37]],
  [346, 26, [4, 43], [1, 44]],
];
const ALIGN = [null, [], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34], [6, 22, 38], [6, 24, 42], [6, 26, 46], [6, 28, 50]];
const EC_LEVEL_M = 0b00;

// ---- GF(256) arithmetic for Reed-Solomon ----
const EXP = new Uint8Array(512);
const LOG = new Uint8Array(256);
{
  let x = 1;
  for (let i = 0; i < 255; i += 1) {
    EXP[i] = x;
    LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i += 1) EXP[i] = EXP[i - 255];
}
const mul = (a, b) => (a === 0 || b === 0 ? 0 : EXP[LOG[a] + LOG[b]]);

function rsGenerator(degree) {
  let poly = [1];
  for (let i = 0; i < degree; i += 1) {
    const next = new Array(poly.length + 1).fill(0);
    for (let j = 0; j < poly.length; j += 1) {
      next[j] ^= poly[j];
      next[j + 1] ^= mul(poly[j], EXP[i]);
    }
    poly = next;
  }
  return poly;
}

function rsRemainder(data, degree) {
  const gen = rsGenerator(degree);
  const rem = new Array(degree).fill(0);
  for (const byte of data) {
    const factor = byte ^ rem.shift();
    rem.push(0);
    for (let i = 0; i < degree; i += 1) rem[i] ^= mul(gen[i + 1], factor);
  }
  return rem;
}

// ---- Data encoding ----
function encodeData(bytes, version) {
  const [total, ecPerBlock, ...groups] = VERSIONS[version];
  const dataCapacity = groups.reduce((s, [n, d]) => s + n * d, 0);
  const bits = [];
  const push = (value, length) => {
    for (let i = length - 1; i >= 0; i -= 1) bits.push((value >>> i) & 1);
  };
  push(0b0100, 4); // byte mode
  push(bytes.length, version < 10 ? 8 : 16);
  for (const b of bytes) push(b, 8);
  push(0, Math.min(4, dataCapacity * 8 - bits.length)); // terminator
  while (bits.length % 8) bits.push(0);
  const data = [];
  for (let i = 0; i < bits.length; i += 8) data.push(bits.slice(i, i + 8).reduce((a, b) => (a << 1) | b, 0));
  for (let pad = 0xec; data.length < dataCapacity; pad ^= 0xec ^ 0x11) data.push(pad);

  // Split into blocks, add error correction, then interleave.
  const blocks = [];
  let offset = 0;
  for (const [count, size] of groups) {
    for (let i = 0; i < count; i += 1) {
      const d = data.slice(offset, offset + size);
      offset += size;
      blocks.push({ d, ec: rsRemainder(d, ecPerBlock) });
    }
  }
  const out = [];
  const maxData = Math.max(...blocks.map((b) => b.d.length));
  for (let i = 0; i < maxData; i += 1) for (const b of blocks) if (i < b.d.length) out.push(b.d[i]);
  for (let i = 0; i < ecPerBlock; i += 1) for (const b of blocks) out.push(b.ec[i]);
  if (out.length !== total) throw new Error('QR codeword count mismatch');
  return out;
}

// ---- Matrix construction ----
function bchFormat(mask) {
  const data = (EC_LEVEL_M << 3) | mask;
  let rem = data;
  for (let i = 0; i < 10; i += 1) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
  return ((data << 10) | rem) ^ 0x5412;
}

function bchVersion(version) {
  let rem = version;
  for (let i = 0; i < 12; i += 1) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
  return (version << 12) | rem;
}

const MASKS = [
  (x, y) => (x + y) % 2 === 0,
  (x, y) => y % 2 === 0,
  (x) => x % 3 === 0,
  (x, y) => (x + y) % 3 === 0,
  (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0,
  (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0,
  (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0,
  (x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0,
];

function buildMatrix(version, codewords, mask) {
  const size = version * 4 + 17;
  const m = Array.from({ length: size }, () => new Array(size).fill(false));
  const fixed = Array.from({ length: size }, () => new Array(size).fill(false));
  const set = (x, y, dark) => {
    m[y][x] = dark;
    fixed[y][x] = true;
  };

  const finder = (cx, cy) => {
    for (let dy = -4; dy <= 4; dy += 1) {
      for (let dx = -4; dx <= 4; dx += 1) {
        const x = cx + dx;
        const y = cy + dy;
        if (x < 0 || y < 0 || x >= size || y >= size) continue;
        const d = Math.max(Math.abs(dx), Math.abs(dy));
        set(x, y, d !== 2 && d !== 4);
      }
    }
  };
  finder(3, 3);
  finder(size - 4, 3);
  finder(3, size - 4);

  for (let i = 0; i < size; i += 1) {
    if (!fixed[6][i]) set(i, 6, i % 2 === 0);
    if (!fixed[i][6]) set(6, i, i % 2 === 0);
  }

  const pos = ALIGN[version];
  for (const ay of pos) {
    for (const ax of pos) {
      if ((ax === 6 && ay === 6) || (ax === 6 && ay === pos.at(-1)) || (ax === pos.at(-1) && ay === 6)) continue;
      for (let dy = -2; dy <= 2; dy += 1) for (let dx = -2; dx <= 2; dx += 1) set(ax + dx, ay + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
    }
  }

  // Format information (reserved now, written after masking).
  const fmt = bchFormat(mask);
  const fbit = (i) => ((fmt >>> i) & 1) === 1;
  for (let i = 0; i <= 5; i += 1) set(8, i, fbit(i));
  set(8, 7, fbit(6));
  set(8, 8, fbit(7));
  set(7, 8, fbit(8));
  for (let i = 9; i < 15; i += 1) set(14 - i, 8, fbit(i));
  for (let i = 0; i < 8; i += 1) set(size - 1 - i, 8, fbit(i));
  for (let i = 8; i < 15; i += 1) set(8, size - 15 + i, fbit(i));
  set(8, size - 8, true); // dark module

  if (version >= 7) {
    const v = bchVersion(version);
    for (let i = 0; i < 18; i += 1) {
      const dark = ((v >>> i) & 1) === 1;
      const a = size - 11 + (i % 3);
      const b = Math.floor(i / 3);
      set(a, b, dark);
      set(b, a, dark);
    }
  }

  // Data, in the zig-zag order, with the mask applied.
  let bit = 0;
  const totalBits = codewords.length * 8;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vert = 0; vert < size; vert += 1) {
      for (let j = 0; j < 2; j += 1) {
        const x = right - j;
        const upward = ((right + 1) & 2) === 0;
        const y = upward ? size - 1 - vert : vert;
        if (fixed[y][x]) continue;
        let dark = false;
        if (bit < totalBits) dark = ((codewords[bit >>> 3] >>> (7 - (bit & 7))) & 1) === 1;
        bit += 1;
        m[y][x] = dark !== MASKS[mask](x, y);
      }
    }
  }
  return m;
}

/** Standard penalty score; the mask with the lowest score is used. */
function penalty(m) {
  const size = m.length;
  let score = 0;
  const lines = [...m, ...m[0].map((_, x) => m.map((row) => row[x]))];
  for (const line of lines) {
    let run = 1;
    for (let i = 1; i <= size; i += 1) {
      if (i < size && line[i] === line[i - 1]) run += 1;
      else {
        if (run >= 5) score += run - 2;
        run = 1;
      }
    }
    const s = line.map((d) => (d ? 1 : 0)).join('');
    score += 40 * ((s.match(/(?=10111010000)/g) ?? []).length + (s.match(/(?=00001011101)/g) ?? []).length);
  }
  for (let y = 0; y < size - 1; y += 1) {
    for (let x = 0; x < size - 1; x += 1) {
      const c = m[y][x];
      if (c === m[y][x + 1] && c === m[y + 1][x] && c === m[y + 1][x + 1]) score += 3;
    }
  }
  const dark = m.flat().filter(Boolean).length;
  score += Math.floor(Math.abs((dark * 20) / (size * size) - 10)) * 10;
  return score;
}

/** Returns the QR matrix (array of rows of booleans) for a string. */
export function qrMatrix(text) {
  const bytes = [...Buffer.from(String(text), 'utf8')];
  const version = VERSIONS.findIndex((v, i) => {
    if (!v) return false;
    const cap = v.slice(2).reduce((s, [n, d]) => s + n * d, 0);
    return Math.ceil((4 + (i < 10 ? 8 : 16) + bytes.length * 8) / 8) <= cap;
  });
  if (version < 1) throw new Error('Text is too long for a QR code');
  const codewords = encodeData(bytes, version);
  let best = null;
  for (let mask = 0; mask < 8; mask += 1) {
    const m = buildMatrix(version, codewords, mask);
    const p = penalty(m);
    if (!best || p < best.p) best = { m, p };
  }
  return best.m;
}

/** QR code as an accessible SVG string. */
export function qrSvg(text, { label = 'QR code', quiet = 4 } = {}) {
  const m = qrMatrix(text);
  const n = m.length + quiet * 2;
  let path = '';
  m.forEach((row, y) =>
    row.forEach((dark, x) => {
      if (dark) path += `M${x + quiet} ${y + quiet}h1v1h-1z`;
    }),
  );
  const safe = String(label).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${n} ${n}" shape-rendering="crispEdges" role="img" aria-label="${safe}"><rect width="${n}" height="${n}" fill="#fff"/><path d="${path}" fill="#000"/></svg>`;
}
