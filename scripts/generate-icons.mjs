/**
 * Procedural icon generator — original AI Keychain artwork, no external
 * dependencies and no third-party brand imitation.
 *
 * Draws the brand mark (rounded dark square, accent ring, light key glyph)
 * as signed-distance fields at 4× supersampling, then box-downsamples to
 * 16 / 32 / 48 / 128 px PNGs using Node's built-in zlib.
 */
import { deflateSync } from "node:zlib";
import { writeFileSync, mkdirSync } from "node:fs";

// ---------------------------------------------------------------- png writer

function crc32(buf) {
  let table = crc32.table;
  if (!table) {
    table = crc32.table = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c;
    }
  }
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = table[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function encodePng(width, height, rgba) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  const raw = Buffer.alloc(height * (width * 4 + 1));
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0; // filter none
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }
  return Buffer.concat([
    sig,
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// ------------------------------------------------------------------ geometry

const lerp = (a, b, t) => a + (b - a) * t;

function sdRoundRect(px, py, cx, cy, hw, hh, r) {
  const qx = Math.abs(px - cx) - hw + r;
  const qy = Math.abs(py - cy) - hh + r;
  const ox = Math.max(qx, 0);
  const oy = Math.max(qy, 0);
  return Math.hypot(ox, oy) + Math.min(Math.max(qx, qy), 0) - r;
}
const sdCircle = (px, py, cx, cy, r) => Math.hypot(px - cx, py - cy) - r;
function sdSegment(px, py, ax, ay, bx, by) {
  const abx = bx - ax;
  const aby = by - ay;
  const t = Math.max(0, Math.min(1, ((px - ax) * abx + (py - ay) * aby) / (abx * abx + aby * aby)));
  return Math.hypot(px - (ax + abx * t), py - (ay + aby * t));
}
const cover = (d, feather) => Math.max(0, Math.min(1, 0.5 - d / feather));

// Colors
const BG_TOP = [22, 35, 60];
const BG_BOT = [10, 16, 28];
const ACCENT = [79, 142, 247];
const GLYPH = [230, 237, 243];

/** Renders one supersampled pixel (unit space 0..1). */
function shade(u, v) {
  // Background rounded square with border ring.
  const dRect = sdRoundRect(u, v, 0.5, 0.5, 0.5, 0.5, 0.25);
  if (dRect > 0) return [0, 0, 0, 0];
  const grad = [0, 1, 2].map((i) => lerp(BG_TOP[i], BG_BOT[i], v));
  const borderW = 0.045;
  const dBorder = Math.abs(dRect + borderW / 2);
  let col = grad;
  let covBg = 1;
  const covBorder = cover(dBorder, 0.02);
  col = [
    lerp(grad[0], ACCENT[0], covBorder),
    lerp(grad[1], ACCENT[1], covBorder),
    lerp(grad[2], ACCENT[2], covBorder),
  ];

  // Key glyph: ring head + diagonal stem + two teeth.
  const stroke = 0.052;
  const parts = [];
  // Ring band around radius 0.115 (torus-style SDF).
  parts.push(Math.abs(sdCircle(u, v, 0.36, 0.36, 0.115)) - stroke / 2);
  parts.push(sdSegment(u, v, 0.45, 0.55, 0.74, 0.84) - stroke / 2); // stem
  parts.push(sdSegment(u, v, 0.62, 0.72, 0.72, 0.62) - stroke * 0.85); // tooth 1
  parts.push(sdSegment(u, v, 0.52, 0.62, 0.6, 0.54) - stroke * 0.85); // tooth 2
  let dGlyph = Infinity;
  for (const d of parts) dGlyph = Math.min(dGlyph, d);
  const covGlyph = cover(dGlyph, 0.02);

  return [
    Math.round(lerp(col[0], GLYPH[0], covGlyph)),
    Math.round(lerp(col[1], GLYPH[1], covGlyph)),
    Math.round(lerp(col[2], GLYPH[2], covGlyph)),
    Math.round(covBg * 255),
  ];
}

function render(size) {
  const SS = size >= 48 ? 3 : 4;
  const hi = size * SS;
  const hiBuf = new Float64Array(hi * hi * 4);
  for (let y = 0; y < hi; y++) {
    for (let x = 0; x < hi; x++) {
      const u = (x + 0.5) / hi;
      const v = (y + 0.5) / hi;
      const [r, g, b, a] = shade(u, v);
      const o = (y * hi + x) * 4;
      hiBuf[o] = r;
      hiBuf[o + 1] = g;
      hiBuf[o + 2] = b;
      hiBuf[o + 3] = a;
    }
  }
  const out = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const o = ((y * SS + sy) * hi + x * SS + sx) * 4;
          r += hiBuf[o];
          g += hiBuf[o + 1];
          b += hiBuf[o + 2];
          a += hiBuf[o + 3];
        }
      }
      const n = SS * SS;
      const oo = (y * size + x) * 4;
      out[oo] = Math.round(r / n);
      out[oo + 1] = Math.round(g / n);
      out[oo + 2] = Math.round(b / n);
      out[oo + 3] = Math.round(a / n);
    }
  }
  return encodePng(size, size, out);
}

mkdirSync("public/icons", { recursive: true });
for (const size of [16, 32, 48, 128]) {
  const png = render(size);
  writeFileSync(`public/icons/icon${size}.png`, png);
  console.log(`public/icons/icon${size}.png  ${png.length} bytes`);
}
console.log("Icons generated.");
