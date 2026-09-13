import {access, copyFile, mkdir, readFile, writeFile} from 'node:fs/promises';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const {parseHTML} = require('linkedom');
const plan = resolve(root, 'work/product-plan/mighty-product-plan.html');
try {await access(plan);} catch {console.log('No local plan source; retaining the published snapshot.'); process.exit(0);}
const target = resolve(root, 'docs/plan');
const brand = resolve(root, 'work/logo-review');
// An explicit asset list keeps unrelated working files out of the public site.
const assets = ['current-logo-source-proof.json', 'marks/current-logo.svg',
  'assets/mighty-brand-kit-v1.zip', 'assets/mighty-icon-128.png', 'assets/mighty-lockup.svg',
  'assets/mighty-mark-ink.svg', 'assets/mighty-mark-original.svg', 'assets/mighty-mark-portable.svg',
  'assets/mighty-mark-reverse.svg', 'assets/mighty-wordmark.svg', 'assets/mighty-brand-tokens.css',
  'assets/README.md', 'assets/fonts/OFL.txt', 'assets/fonts/schibsted-grotesk-latin-wght-normal.woff2'];
await mkdir(resolve(target, 'brand'), {recursive: true});
let html = (await readFile(plan, 'utf8'))
  .replaceAll('../logo-review/mighty-brand-book.html', './brand/index.html')
  .replaceAll('../logo-review/', './brand/')
  .replaceAll('../../public/favicon.svg', './favicon.svg')
  .replace('This private local review file contains personal goal context and is excluded from the public source repository.',
    'Mighty product plan and implementation record. Published on GitHub Pages.')
  .replace('This local plan includes personal goal context and is excluded from the public source repository.',
    'This plan is published on GitHub Pages. Its example goals are planning context; personal review notes stay in the browser.')
  .replace('The original approved HTML is retained in history/approved-v1.html.',
    'The original approved HTML is retained separately as a historical reference.')
  .replace('The original approved file is preserved alongside this living reference.',
    'The original approved file is retained separately; this page is the current reference.');
html = html.replace('</head>', '<link rel="icon" href="./favicon.svg"><meta name="description" content="Mighty product plan, build status, remaining work, algorithms, pricing and brand book."></head>');
let book = (await readFile(resolve(brand, 'mighty-brand-book.html'), 'utf8'))
  .replaceAll('../product-plan/mighty-product-plan.html', '../index.html')
  .replaceAll('../../public/favicon.svg', '../favicon.svg');
const outputs = [[resolve(target, 'index.html'), html], [resolve(target, 'brand/index.html'), book]];
for (const [file, content] of outputs) {
  if (/file:\/\/\/|\/Users\/|sb_secret_[\w-]+|AIza[\w-]{25,}|-----BEGIN [^-]*PRIVATE KEY-----/.test(content)) {
    throw new Error('The public plan contains a local path or credential-shaped value. Review it before publishing.');
  }
  await writeFile(file, content.replace(/[\t ]+$/gm, ''));
}
for (const asset of assets) {
  const destination = resolve(target, 'brand', asset);
  await mkdir(dirname(destination), {recursive: true});
  await copyFile(resolve(brand, asset), destination);
}
await copyFile(resolve(root, 'public/favicon.svg'), resolve(target, 'favicon.svg'));
await writeFile(resolve(target, '.nojekyll'), '');
for (const asset of assets.filter(name => name.endsWith('.css'))) {
  const file = resolve(target, 'brand', asset);
  const css = await readFile(file, 'utf8');
  for (const match of css.matchAll(/url\(\s*['"]?([^'"\s)]+)['"]?\s*\)/g)) {
    if (/^(?:data:|https?:)/.test(match[1])) continue;
    const destination = resolve(dirname(file), match[1]);
    if (!destination.startsWith(target + '/')) throw new Error('A CSS asset escapes the site directory.');
    await access(destination);
  }
}
// Check the actual hosted paths and document fragments before publishing.
for (const [file, content] of outputs) {
  const document = parseHTML(content).document;
  for (const element of document.querySelectorAll('[href], [src]')) {
    const value = element.getAttribute('href') ?? element.getAttribute('src');
    if (!value || /^(?:https?:|data:|mailto:)/.test(value)) continue;
    const [relative, fragment] = value.split('#');
    const destination = relative ? resolve(dirname(file), relative) : file;
    if (!destination.startsWith(target + '/')) throw new Error('A public link escapes the site directory.');
    await access(destination);
    if (fragment && destination.endsWith('.html')) {
      const linked = destination === file ? document : parseHTML(await readFile(destination, 'utf8')).document;
      if (!linked.getElementById(fragment)) throw new Error('A public document fragment is missing: ' + fragment);
    }
  }
}
console.log('Public plan, brand book and linked assets prepared in docs/. All local links resolve.');
