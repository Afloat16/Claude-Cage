import assert from 'node:assert/strict';
import { test } from 'node:test';
import { releaseAssets, checksumFor } from './sync-release.mjs';

const hash = 'a'.repeat(64);
function fixture() {
  return { tag_name: 'v0.2.0-alpha.10', draft: false, assets:
    ['Cage-0.2.0-alpha.10-macos-arm64.dmg', 'SHA256SUMS', 'mihomo-v1.19.33-source.tar.gz'].map(name => ({
      name, state: 'uploaded', size: 100, digest: `sha256:${hash}`,
      browser_download_url: `https://github.com/Lee-xeo/Claude-Cage/releases/download/v0.2.0-alpha.10/${name}`,
    })),
  };
}
test('accept complete Alpha release; reject drafts, incomplete uploads and cross-version assets', () => {
  assert.equal(releaseAssets(fixture()).version, '0.2.0-alpha.10');
  for (const mutate of [
    r => { r.draft = true; }, r => { r.assets.pop(); },
    r => { r.assets[0].state = 'new'; }, r => { r.assets[0].size = 0; },
    r => { r.assets[0].browser_download_url = r.assets[0].browser_download_url.replace('/v0.2.0-alpha.10/', '/v0.1.0/'); },
  ]) {
    const release = fixture(); mutate(release);
    assert.throws(() => releaseAssets(release));
  }
});
test('checksum must uniquely match the archive and GitHub digest', () => {
  const archive = fixture().assets[0];
  const line = `${hash}  ${archive.name}\n`;
  assert.equal(checksumFor(line, archive), hash);
  for (const text of ['', line + line, `${'b'.repeat(64)}  ${archive.name}`, `${hash}  another.dmg`]) {
    assert.throws(() => checksumFor(text, archive));
  }
});
