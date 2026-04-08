/**
 * Generates build/icon.ico from public/assets/ccro-logo.png for:
 *   - after-pack-win-icon.js (rcedit embeds this .exe icon; avoids winCodeSign symlink issues)
 *   - NSIS / builder metadata still uses the PNG where supported
 */
const fs = require("fs");
const path = require("path");
const sharp = require("sharp");
const toIco = require("to-ico");

const root = path.join(__dirname, "..");
const sourcePath = path.join(root, "public", "assets", "ccro-logo.png");
const outDir = path.join(root, "build");
const icoPath = path.join(outDir, "icon.ico");

async function main() {
  if (!fs.existsSync(sourcePath)) {
    console.error("Missing source image:", sourcePath);
    process.exit(1);
  }

  const pngBuffer = await sharp(sourcePath)
    .resize(1024, 1024, { fit: "inside", withoutEnlargement: true })
    .png()
    .toBuffer();

  const buf = await toIco([pngBuffer], { resize: true });
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(icoPath, buf);
  console.log("Wrote", icoPath);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
