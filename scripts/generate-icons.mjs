// Regenerate browser and mobile icons from the vector brand mark:
// node scripts/generate-icons.mjs
import { readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';

const require = createRequire(new URL('../apps/api/package.json', import.meta.url));
const sharp = require('sharp');
const app = new URL('../apps/web/app/', import.meta.url);
const source = await readFile(new URL('icon.svg', app));
const sizes = [16, 32, 48];
const frames = await Promise.all(sizes.map(size =>
  sharp(source, { density: 192 }).resize(size, size).png().toBuffer(),
));

// ICO directory followed by lossless PNG frames, one for each tab-icon size.
const directory = Buffer.alloc(6 + 16 * sizes.length);
directory.writeUInt16LE(1, 2);
directory.writeUInt16LE(sizes.length, 4);
let offset = directory.length;
for (let index = 0; index < sizes.length; index++) {
  const entry = 6 + index * 16;
  directory[entry] = sizes[index];
  directory[entry + 1] = sizes[index];
  directory.writeUInt16LE(1, entry + 4);
  directory.writeUInt16LE(32, entry + 6);
  directory.writeUInt32LE(frames[index].length, entry + 8);
  directory.writeUInt32LE(offset, entry + 12);
  offset += frames[index].length;
}
await writeFile(new URL('favicon.ico', app), Buffer.concat([directory, ...frames]));
await writeFile(new URL('apple-icon.png', app),
  await sharp(source, { density: 216 }).resize(180, 180)
    .flatten({ background: '#0b1423' }).png().toBuffer(),
);
// Preserve the previous public URL for bookmarks and older cached pages.
await writeFile(new URL('../apps/web/public/favicon.svg', import.meta.url), source);
console.log('Generated SVG compatibility icon, 16/32/48px ICO, and 180px Apple icon.');
