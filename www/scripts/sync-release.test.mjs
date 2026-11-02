import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { releaseAssets, checksumFor, releaseMetadata } from './sync-release.mjs';

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

function windowsFixture() {
  const release = fixture();
  const name = 'Cage-0.2.0-alpha.10-windows-amd64-setup.exe';
  release.assets.push({ ...release.assets[0], name,
    browser_download_url: `https://github.com/Lee-xeo/Claude-Cage/releases/download/${release.tag_name}/${name}` });
  return release;
}
const sums = release => release.assets.filter(asset => asset.name !== 'SHA256SUMS').map(asset => `${hash}  ${asset.name}\n`).join('');

test('Windows download is optional and preserves the existing macOS metadata', () => {
  const mac = fixture();
  assert.deepEqual(releaseMetadata(mac, sums(mac)), {
    version: '0.2.0-alpha.10',
    releaseURL: 'https://github.com/Lee-xeo/Claude-Cage/releases/tag/v0.2.0-alpha.10',
    downloadURL: mac.assets[0].browser_download_url,
  });
  const both = windowsFixture();
  assert.deepEqual(releaseMetadata(both, sums(both)), {
    ...releaseMetadata(mac, sums(mac)), windowsDownloadURL: both.assets.at(-1).browser_download_url,
  });
  assert.throws(() => releaseAssets({ ...both, assets: both.assets.slice(1) }), 'Windows-only release must not replace the macOS homepage selection');
});

test('unsigned, incomplete, oversized and cross-version Windows assets never produce a download URL', () => {
  for (const mutate of [
    asset => { asset.name = asset.name.replace('-setup.exe', '-setup-unsigned.exe'); },
    asset => { asset.state = 'new'; }, asset => { asset.size = 0; },
    asset => { asset.size = 512 * 1024 * 1024 + 1; },
    asset => { asset.browser_download_url = asset.browser_download_url.replace('/v0.2.0-alpha.10/', '/v0.1.0/'); },
  ]) {
    const release = windowsFixture(); mutate(release.assets.at(-1));
    const metadata = releaseMetadata(release, sums(release));
    assert.ok(!('windowsDownloadURL' in metadata));
    assert.equal(metadata.downloadURL, release.assets[0].browser_download_url);
  }
  const duplicate = windowsFixture(); duplicate.assets.push({ ...duplicate.assets.at(-1) });
  assert.ok(!('windowsDownloadURL' in releaseMetadata(duplicate, sums(duplicate))));
});

test('missing, duplicate or mismatching Windows checksum omits only the Windows link', () => {
  const release = windowsFixture();
  const windows = release.assets.at(-1);
  const all = sums(release);
  for (const text of [sums(fixture()), all + `${hash}  ${windows.name}\n`, all.replace(`${hash}  ${windows.name}`, `${'b'.repeat(64)}  ${windows.name}`)]) {
    const metadata = releaseMetadata(release, text);
    assert.ok(!('windowsDownloadURL' in metadata));
    assert.equal(metadata.downloadURL, release.assets[0].browser_download_url);
  }
});

test('macOS verification checks both owned archives without requiring other-platform source files', () => {
  const directory = mkdtempSync(join(tmpdir(), 'cage-release-check-'));
  const script = new URL('../../scripts/verify-macos-release.sh', import.meta.url);
  const nativeReached = join(directory, 'native-check-reached');
  // Stop at the first macOS-specific validation. Hash verification above it
  // remains the actual shipped shell entry, including missing/duplicate checks.
  writeFileSync(join(directory, 'codesign'), '#!/bin/sh\nprintf reached > "$CAGE_TEST_NATIVE_MARKER"\nexit 42\n', { mode: 0o700 });
  const owned = ['Cage-0.2.0-macos-arm64.dmg', 'mihomo-v1.19.33-source.tar.gz'];
  for (const name of owned) writeFileSync(join(directory, name), name);
  const valid = owned.map(name => `${createHash('sha256').update(name).digest('hex')}  ${name}\n`).join('');
  const extra = `${hash}  qemu-windows-full-source.zip\n${hash}  Cage-0.2.0-windows-amd64-setup.exe\n`;
  const run = text => {
    rmSync(nativeReached, { force: true });
    writeFileSync(join(directory, 'SHA256SUMS'), text);
    return spawnSync('bash', [fileURLToPath(script), directory], { encoding: 'utf8', env: { ...process.env, PATH: `${directory}:${process.env.PATH}`, CAGE_TEST_NATIVE_MARKER: nativeReached } });
  };
  try {
    assert.equal(run(valid + extra).status, 42, 'unrelated release assets blocked macOS checksum verification');
    assert.ok(existsSync(nativeReached));
    for (const invalid of [extra, valid + valid, valid.replace(/^[a-f0-9]{64}/, '0'.repeat(64))]) {
      assert.notEqual(run(invalid).status, 42);
      assert.ok(!existsSync(nativeReached), 'invalid macOS checksum reached native signature verification');
    }
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
