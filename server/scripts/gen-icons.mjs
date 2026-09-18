// Generates the app icon set — a white mountain on alpine blue.
//
// Written by hand with zlib rather than pulled from an image library: the mark
// is two triangles and a snowline, the palette has to track src/theme.ts, and
// `node scripts/gen-icons.mjs` regenerating everything from source beats a
// folder of binaries nobody can edit.
//
// Replace this with real artwork before shipping to the App Store — this is a
// placeholder that looks deliberate, not a brand.
//
//   node scripts/gen-icons.mjs

import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const serverDir = join(here, "..");
const rootDir = join(serverDir, "..");

// Must match mobile/src/theme.ts.
const BLUE = [0x1d, 0x6f, 0xe0];
const DEEP = [0x0b, 0x3c, 0x7d];
const WHITE = [0xff, 0xff, 0xff];
const SNOW = [0xf5, 0xf9, 0xff];

/** Minimal PNG encoder: 8-bit RGBA, one IDAT, no interlacing. */
function encodePng(width, height, rgba) {
  const crcTable = (() => {
    const t = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c;
    }
    return t;
  })();

  const crc32 = (buf) => {
    let c = -1;
    for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
    return (c ^ -1) >>> 0;
  };

  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([len, body, crc]);
  };

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type: RGBA
  // 10..12 stay zero: deflate, adaptive filtering, no interlace.

  // Every scanline gets filter byte 0 (None) — the image is flat colour, so
  // the filters buy nothing and cost clarity.
  const raw = Buffer.alloc(height * (1 + width * 4));
  for (let y = 0; y < height; y++) {
    const rowStart = y * (1 + width * 4);
    raw[rowStart] = 0;
    rgba.copy(raw, rowStart + 1, y * width * 4, (y + 1) * width * 4);
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/**
 * The mark: two overlapping peaks with snowcaps, centred in the square.
 * `bg === null` renders transparent, for the Android adaptive foreground.
 */
function drawIcon(size, bg) {
  const px = Buffer.alloc(size * size * 4);
  const set = (x, y, [r, g, b], a = 255) => {
    if (x < 0 || y < 0 || x >= size || y >= size) return;
    const i = (y * size + x) * 4;
    px[i] = r;
    px[i + 1] = g;
    px[i + 2] = b;
    px[i + 3] = a;
  };

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (bg) {
        // A faint vertical gradient so a 1024px icon isn't a dead flat slab.
        const t = y / size;
        set(x, y, [
          Math.round(bg[0] + (DEEP[0] - bg[0]) * t * 0.55),
          Math.round(bg[1] + (DEEP[1] - bg[1]) * t * 0.55),
          Math.round(bg[2] + (DEEP[2] - bg[2]) * t * 0.55),
        ]);
      } else {
        set(x, y, [0, 0, 0], 0);
      }
    }
  }

  // Peaks in normalised coordinates, scaled to `size`.
  const peaks = [
    { apexX: 0.38, apexY: 0.26, halfWidth: 0.30 },
    { apexX: 0.64, apexY: 0.36, halfWidth: 0.26 },
  ];
  const baseY = 0.76;

  for (const p of peaks) {
    const apexX = p.apexX * size;
    const apexY = p.apexY * size;
    const base = baseY * size;
    const half = p.halfWidth * size;

    for (let y = Math.floor(apexY); y < base; y++) {
      const t = (y - apexY) / (base - apexY); // 0 at the apex, 1 at the base
      const spread = half * t;
      const snowline = apexY + (base - apexY) * 0.34;
      // Snowcap in near-white, the flank in pure white — enough separation to
      // read as a mountain at 40px without an outline.
      const tone = y < snowline ? SNOW : WHITE;
      for (let x = Math.round(apexX - spread); x <= Math.round(apexX + spread); x++) {
        set(x, y, tone);
      }
    }
  }

  return encodePng(size, size, px);
}

const targets = [
  [join(rootDir, "mobile/assets/icon.png"), 1024, BLUE],
  [join(rootDir, "mobile/assets/splash-icon.png"), 512, null],
  [join(rootDir, "mobile/assets/favicon.png"), 64, BLUE],
  [join(rootDir, "mobile/assets/android-icon-foreground.png"), 512, null],
  [join(serverDir, "pwa/icon-192.png"), 192, BLUE],
  [join(serverDir, "pwa/icon-512.png"), 512, BLUE],
  [join(serverDir, "pwa/apple-touch-icon.png"), 180, BLUE],
];

for (const [path, size, bg] of targets) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, drawIcon(size, bg));
  console.log(`wrote ${path} (${size}px)`);
}
