/**
 * One-shot / maintenance: if ccro-logo.png is RGB (or JPEG-bytes saved as .png)
 * with a black surround, rebuild a real RGBA PNG with transparent background.
 * Uses edge flood-fill through near-black achromatic pixels only (does not walk into green/gold).
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import sharp from "sharp";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const target = path.join(root, "public", "assets", "ccro-logo.png");

function floodBackgroundMask(r, g, b, T, C) {
  const h = r.length;
  const w = r[0].length;
  const mx = Array.from({ length: h }, (_, y) => Array.from({ length: w }, (_, x) => Math.max(r[y][x], g[y][x], b[y][x])));
  const mn = Array.from({ length: h }, (_, y) => Array.from({ length: w }, (_, x) => Math.min(r[y][x], g[y][x], b[y][x])));
  const passable = Array.from({ length: h }, (_, y) =>
    Array.from({ length: w }, (_, x) => mx[y][x] <= T && mx[y][x] - mn[y][x] <= C)
  );
  const visit = Array.from({ length: h }, () => Array(w).fill(false));
  const q = [];
  const push = (y, x) => {
    if (y < 0 || y >= h || x < 0 || x >= w || visit[y][x] || !passable[y][x]) return;
    visit[y][x] = true;
    q.push([y, x]);
  };
  for (let x = 0; x < w; x++) {
    push(0, x);
    push(h - 1, x);
  }
  for (let y = 0; y < h; y++) {
    push(y, 0);
    push(y, w - 1);
  }
  while (q.length) {
    const [y, x] = q.pop();
    push(y - 1, x);
    push(y + 1, x);
    push(y, x - 1);
    push(y, x + 1);
  }
  return visit;
}

async function main() {
  const buf = fs.readFileSync(target);
  const { data, info } = await sharp(buf).ensureAlpha().raw().toBuffer({ resolveWithObject: true });

  if (info.channels !== 4) {
    throw new Error(`Expected RGBA after ensureAlpha, got ${info.channels} channels`);
  }

  const w = info.width;
  const h = info.height;
  const r = [];
  const g = [];
  const b = [];
  for (let y = 0; y < h; y++) {
    r[y] = [];
    g[y] = [];
    b[y] = [];
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      r[y][x] = data[i];
      g[y][x] = data[i + 1];
      b[y][x] = data[i + 2];
    }
  }

  // Conservative: achromatic dark pixels reachable from image edge = former "matte".
  const T = 38;
  const C = 9;
  const bg = floodBackgroundMask(r, g, b, T, C);

  const out = Buffer.alloc(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const isBg = bg[y][x];
      out[i] = r[y][x];
      out[i + 1] = g[y][x];
      out[i + 2] = b[y][x];
      out[i + 3] = isBg ? 0 : 255;
    }
  }

  await sharp(out, { raw: { width: w, height: h, channels: 4 } }).png().toFile(target);
  console.log("Wrote RGBA PNG:", target, `(T=${T} C=${C})`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
