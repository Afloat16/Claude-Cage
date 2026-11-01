// Check emitted pages, not just the locale configuration: catch missing routes,
// broken project subpaths and languages drifting away from the README menu.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../../', import.meta.url));
const readme = fs.readFileSync(path.join(root,'README.md'),'utf8');
const menu = readme.split('\n').find(line => line.includes('(README.md)') && line.includes('(README.'));
assert.ok(menu, 'README language navigation is missing');
const codes = [...menu.matchAll(/\]\(README(?:\.([\w-]+))?\.md\)/g)].map(m => m[1] || 'zh');
// README.md has no dot before the base name's extension in the optional group.
assert.equal(codes[0], 'zh');
assert.ok(!codes.includes('en'));
const dist = path.join(root,'www/dist');
for (const code of codes) {
  const html = fs.readFileSync(path.join(dist,code === 'zh' ? '' : code,'index.html'),'utf8');
  const options = [...html.matchAll(/<option\b[^>]*value="([^"]+)"/g)].map(m=>m[1]);
  assert.equal(options.length,codes.length, `${code}: language dropdown missing options`);
  assert.ok(!options.some(url=>url.endsWith('/en/')), `${code}: unexpected English route`);
  assert.ok(html.includes('id="site-language"'), `${code}: missing language selector`);
  assert.ok(html.includes(`dir="${['ar','fa','ps','prs'].includes(code)?'rtl':'ltr'}"`), `${code}: incorrect reading direction`);
  for (const match of html.matchAll(/(?:src|href)="(\/Claude-Cage\/[^"#]+)"/g)) {
    const relative = decodeURIComponent(match[1].slice('/Claude-Cage/'.length));
    const target = path.join(dist,relative.endsWith('/') ? relative+'index.html' : relative);
    assert.ok(fs.existsSync(target), `${code}: broken local asset or link ${match[1]}`);
  }
  assert.ok(!html.includes('/Users/'), `${code}: local developer path leaked`);
}
assert.ok(!fs.existsSync(path.join(dist,'en/index.html')), 'Old English page still present');
console.log(`Verified ${codes.length} README languages, dropdowns, directions and local assets.`);
