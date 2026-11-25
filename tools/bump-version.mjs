// Sets the game version everywhere and versions every module URL, so Safari can't mix cached old code with
// new code. Run: node tools/bump-version.mjs v6   (or with no argument to just regenerate the import maps)
//
// What it updates:
//   src/version.js                    VERSION
//   index.html, editor.html           <meta name="build">, the #ver label, every ?v= on scripts/styles, and the
//                                     import map, which lists every .js module (and three.js) with ?v=N.
// The import map is what makes this work: a module importing './maps/format.js' resolves to a URL that the map
// redirects to 'format.js?v=N', so a new version always fetches new files, without a build step.
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const versionFile = join(ROOT, 'src/version.js');
let version = process.argv[2] || readFileSync(versionFile, 'utf8').match(/VERSION = '(v\d+)'/)[1];
if (!/^v\d+$/.test(version)) { console.error(`version must look like v6, got "${version}"`); process.exit(1); }
const n = version.slice(1);

writeFileSync(versionFile, readFileSync(versionFile, 'utf8').replace(/VERSION = '[^']*'/, `VERSION = '${version}'`));

function jsFiles(dir) {
  const out = [];
  for (const name of readdirSync(join(ROOT, dir))) {
    const p = join(dir, name);
    if (statSync(join(ROOT, p)).isDirectory()) out.push(...jsFiles(p));
    else if (name.endsWith('.js')) out.push(p);
  }
  return out;
}
const modules = [...jsFiles('src'), ...jsFiles('editor')].filter(p => p !== join('src', 'ui', 'page.js')).sort();

export function importMap(v) {
  const imports = { three: `./lib/three.module.js?v=${v}` };
  for (const m of modules) imports[`./${m.split('\\').join('/')}`] = `./${m.split('\\').join('/')}?v=${v}`;
  return JSON.stringify({ imports }, null, 2);
}

for (const page of ['index.html', 'editor.html']) {
  const file = join(ROOT, page);
  let s = readFileSync(file, 'utf8');
  s = s.replace(/<meta name="build" content="[^"]*">/, `<meta name="build" content="${version}">`);
  s = s.replace(/<div id="ver">[^<]*<\/div>/, `<div id="ver">${version}</div>`);
  s = s.replace(/\?v=\d+"/g, `?v=${n}"`);
  s = s.replace(/<script type="importmap">[\s\S]*?<\/script>/, `<script type="importmap">\n${importMap(n)}\n</script>`);
  writeFileSync(file, s);
}
console.log(`version ${version}; import maps list ${modules.length} modules + three.js`);
