import { mkdirSync, writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';

const directory = fileURLToPath(new URL('../apps/web/public/icons/', import.meta.url));
mkdirSync(directory, { recursive: true });
function chunk(type, data) {
  const name = Buffer.from(type);
  const body = Buffer.concat([name, data]);
  let crc = 0xffffffff;
  for (const byte of body) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
  return Buffer.concat([length, body, checksum]);
}
for (const [filename, size] of [['icon-192.png', 192], ['icon-512.png', 512], ['maskable-512.png', 512], ['apple-touch-icon.png', 180]]) {
  const pixels = Buffer.alloc(size * (1 + size * 4));
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const a = x / size;
      const b = y / size;
      const cup = a >= 0.29 && a <= 0.65 && b >= 0.38 && b <= 0.62
        && (b < 0.51 || Math.hypot((a - 0.47) / 0.18, (b - 0.51) / 0.13) <= 1);
      const handle = Math.abs(Math.hypot((a - 0.66) / 0.10, (b - 0.47) / 0.09) - 1) < 0.16 && a >= 0.64;
      const saucer = a > 0.25 && a < 0.73 && b > 0.69 && b < 0.72;
      const steam = ((a > 0.39 && a < 0.42) || (a > 0.52 && a < 0.55)) && b > 0.23 && b < 0.32;
      const offset = y * (1 + size * 4) + 1 + x * 4;
      pixels.set(cup || handle || saucer || steam ? [255, 255, 255, 255] : [8, 99, 71, 255], offset);
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8;
  header[9] = 6;
  writeFileSync(new URL(filename, new URL('../apps/web/public/icons/', import.meta.url)), Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', deflateSync(pixels)), chunk('IEND', Buffer.alloc(0)),
  ]));
}
