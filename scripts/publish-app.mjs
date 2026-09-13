import {access, cp, mkdir, readFile, readdir, rm, writeFile} from 'node:fs/promises';
import {resolve, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const {parseHTML} = require('linkedom');
const built = resolve(root, 'dist');
const site = resolve(root, 'docs');
const html = await readFile(resolve(built, 'index.html'), 'utf8');
if (!html.includes('id="root"')) throw new Error('Build the Mighty application before publishing.');
await mkdir(site, {recursive: true});
// Migrate the earlier plan-only site without discarding the preserved reference.
try {
  const previous = await readFile(resolve(site, 'index.html'), 'utf8');
  if (previous.includes('id="chapter-nav"')) {
    await mkdir(resolve(site, 'plan'), {recursive: true});
    try {await access(resolve(site, 'plan/index.html'));} catch {await writeFile(resolve(site, 'plan/index.html'), previous);}
  }
  try {
    await access(resolve(site, 'brand'));
    await cp(resolve(site, 'brand'), resolve(site, 'plan/brand'), {recursive: true});
    await rm(resolve(site, 'brand'), {recursive: true});
  } catch (error) {if (error.code !== 'ENOENT') throw error;}
} catch (error) {if (error.code !== 'ENOENT') throw error;}

// Copy only application output, never arbitrary files from public/ or work/.
await rm(resolve(site, 'assets'), {recursive: true, force: true});
await cp(resolve(built, 'assets'), resolve(site, 'assets'), {recursive: true});
for (const name of ['index.html', 'favicon.svg', 'manifest.webmanifest']) {
  await cp(resolve(built, name), resolve(site, name));
}
await mkdir(resolve(site, 'downloads'), {recursive: true});
await cp(resolve(built, 'downloads/mighty-extension.zip'), resolve(site, 'downloads/mighty-extension.zip'));
await writeFile(resolve(site, '.nojekyll'), '');

const document = parseHTML(html).document;
for (const node of document.querySelectorAll('[src], [href]')) {
  const value = node.getAttribute('src') ?? node.getAttribute('href');
  if (!value || /^(https?:|data:|#)/.test(value)) continue;
  if (value.startsWith('/')) throw new Error('Application asset must work below /mighty/: ' + value);
  const target = resolve(site, value);
  if (!target.startsWith(site + '/')) throw new Error('Application asset escapes the site directory.');
  await access(target);
}
const manifest = JSON.parse(await readFile(resolve(site, 'manifest.webmanifest'), 'utf8'));
if (manifest.start_url !== './' || manifest.scope !== './') throw new Error('The web manifest must stay within the hosted application.');
for (const name of await readdir(resolve(site, 'assets'))) {
  if (!/\.(js|css)$/.test(name)) continue;
  const text = await readFile(resolve(site, 'assets', name), 'utf8');
  if (/sb_secret_[\w-]+|AIza[\w-]{25,}|-----BEGIN [^-]*PRIVATE KEY-----/.test(text)) {
    throw new Error('A credential-shaped value is present in the application bundle.');
  }
}
console.log('Mighty app prepared at /mighty/; living plan retained at /mighty/plan/.');
