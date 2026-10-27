import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const sourceDir = resolve('node_modules/@ffmpeg/core/dist/esm');
const destinationDir = resolve('public/vendor/ffmpeg');
mkdirSync(destinationDir, { recursive: true });
for (const fileName of ['ffmpeg-core.js', 'ffmpeg-core.wasm']) {
  const source = resolve(sourceDir, fileName);
  if (!existsSync(source)) {
    throw new Error(`Cannot find ${source}. Run npm install first.`);
  }
  copyFileSync(source, resolve(destinationDir, fileName));
  console.log(`Copied: ${fileName}`);
}
