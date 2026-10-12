// Figtree and Newsreader are not installed on a build machine, so this draws
// with the nearest system faces and its output is committed. Run `npm run og`
// after changing the wording or a colour.
import { writeFile } from 'node:fs/promises';
import sharp from 'sharp';

const OUTPUT_DIRECTORY = new URL('../public/', import.meta.url);

const STOCK = '#eef1f6';
const INK = '#16233d';
const INK_SOFT = '#4c5a70';
const ACCENT = '#1a6cf0';
const TEAL = '#2fd0bf';

const SANS = 'Figtree, Helvetica Neue, Helvetica, Arial, sans-serif';
const SERIF = 'Newsreader, Georgia, Times New Roman, serif';

const DART = 'M0 2 L56 0 L13 18 Z';

// The favicon in public/index.html is a data URI of this shape under the same
// transform, so change both together.
const mark = (size, radius = size / 4.6) => `
  <rect width="${size}" height="${size}" rx="${radius}" fill="${ACCENT}"/>
  <g transform="translate(${size * 0.11} ${size * 0.36}) scale(${size / 72})">
    <path d="${DART}" fill="#fff"/>
  </g>`;

const card = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630">
  <defs>
    <linearGradient id="sweep" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="${ACCENT}"/>
      <stop offset="0.38" stop-color="${ACCENT}"/>
      <stop offset="1" stop-color="${TEAL}"/>
    </linearGradient>
    <linearGradient id="dart" x1="0" y1="1" x2="1" y2="0">
      <stop offset="0" stop-color="${ACCENT}"/>
      <stop offset="1" stop-color="${TEAL}"/>
    </linearGradient>
  </defs>

  <rect width="1200" height="630" fill="${STOCK}"/>
  <rect width="1200" height="10" fill="url(#sweep)"/>

  <g transform="translate(64, 74)">
    <g transform="translate(0, 16) scale(1.15)"><path d="${DART}" fill="url(#dart)"/></g>
    <text font-family="${SANS}" font-size="27" font-weight="700" letter-spacing="-0.5"
      fill="${INK}" x="86" y="26">Unofficial calendar links</text>
    <text font-family="${SANS}" font-size="22" font-weight="500" fill="${INK_SOFT}"
      x="86" y="58">for ComfortDelGro Driving Centre bookings</text>
  </g>

  <text font-family="${SERIF}" font-size="54" font-weight="600" fill="${INK}">
    <tspan x="64" y="250">Your ComfortDelGro Driving</tspan>
    <tspan x="64" y="318">Centre bookings, in the calendar</tspan>
    <tspan x="64" y="386">you already use.</tspan>
  </text>

  <rect x="64" y="424" width="104" height="5" fill="${ACCENT}"/>

  <text font-family="${SERIF}" font-size="27" fill="${INK_SOFT}">
    <tspan x="64" y="480">Subscribe once from iPhone, Google Calendar or Outlook.</tspan>
    <tspan x="64" y="516">New bookings show up as you make them, and cancelled ones disappear on their own.</tspan>
  </text>

  <g transform="translate(64, 542)">${mark(46, 10)}</g>
  <text x="126" y="574" font-family="${SANS}" font-size="28" font-weight="600"
    fill="${INK}">mycdc.app</text>
</svg>`;

const icon = (size) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">${mark(size)}</svg>`;

const render = async (name, svg) => {
  await sharp(Buffer.from(svg)).png({ compressionLevel: 9 }).toFile(new URL(name, OUTPUT_DIRECTORY).pathname);
  console.log(`public/${name}`);
};

await render('og.png', card);
await render('apple-touch-icon.png', icon(180));
await render('icon-192.png', icon(192));
await render('icon-512.png', icon(512));

await writeFile(
  new URL('icon.svg', OUTPUT_DIRECTORY),
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">${mark(32, 7)}</svg>\n`,
);
console.log('public/icon.svg');
