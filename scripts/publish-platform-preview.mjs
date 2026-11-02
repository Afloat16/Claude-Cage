// Explicit preview publication only. Signed release/update policies are unchanged.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { appendFileSync, copyFileSync, lstatSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const repo = 'Lee-xeo/Claude-Cage';
const gh = args => execFileSync('gh', args, { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
const api = (path, args = []) => JSON.parse(gh(['api', `repos/${repo}/${path}`, ...args]));
const digest = data => createHash('sha256').update(data).digest('hex');

export function stagePreview(windows, linux, destination, version, dependencies) {
  assert.match(version, /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/);
  const expected = [
    [windows, [`Cage-${version}-windows-amd64-setup-unsigned.exe`, dependencies.mihomoSource.file, `${dependencies.qemuSource.file}.gz`]],
    [linux, [`Cage-${version}-linux-amd64.deb`, dependencies.mihomoSource.file]],
  ];
  const verified = new Map();
  for (const [directory, names] of expected) {
    const manifest = readFileSync(join(directory, 'SHA256SUMS'), 'utf8').replace(/^\uFEFF/, '');
    assert.ok(Buffer.byteLength(manifest) < 65536);
    const entries = new Map();
    for (const line of manifest.split(/\r?\n/).filter(Boolean)) {
      const match = /^([a-f0-9]{64}) [ *]([A-Za-z0-9][A-Za-z0-9._-]*)$/i.exec(line);
      assert.ok(match && !entries.has(match[2]), 'Invalid or duplicate platform checksum');
      entries.set(match[2], match[1].toLowerCase());
    }
    assert.deepEqual([...entries.keys()].sort(), [...names].sort(), 'Unexpected platform assets');
    for (const name of names) {
      const path = join(directory, name), stat = lstatSync(path);
      assert.ok(stat.isFile() && stat.size > 0 && stat.size <= 512 * 1024 * 1024);
      const actual = digest(readFileSync(path));
      assert.equal(actual, entries.get(name), `Corrupt artifact: ${name}`);
      if (verified.has(name)) assert.equal(verified.get(name).digest, actual, 'Conflicting source archives');
      else verified.set(name, { path, digest: actual, size: stat.size });
    }
  }
  // Do not copy reports or other artifact leftovers into a public release.
  mkdirSync(destination);
  for (const [name, file] of verified) copyFileSync(file.path, join(destination, name));
  const sums = [...verified].map(([name, file]) => `${file.digest}  ${name}\n`).join('');
  writeFileSync(join(destination, 'SHA256SUMS'), sums);
  verified.set('SHA256SUMS', { digest: digest(sums), size: Buffer.byteLength(sums) });
  return verified;
}

async function main() {
  assert.equal(process.env.GITHUB_EVENT_NAME, 'workflow_dispatch');
  assert.equal(process.env.GITHUB_REPOSITORY, repo);
  assert.equal(process.env.GITHUB_REF, 'refs/heads/main');
  const runID = process.env.CAGE_PREVIEW_RUN;
  assert.match(runID || '', /^\d+$/);
  const run = api(`actions/runs/${runID}`);
  assert.equal(run.conclusion, 'success');
  assert.equal(run.path, '.github/workflows/ci.yml');
  assert.equal(run.head_repository.full_name, repo);
  assert.match(run.head_sha, /^[a-f0-9]{40}$/);
  const sourceFile = path => Buffer.from(api(`contents/${path}?ref=${run.head_sha}`).content, 'base64').toString('utf8');
  const version = sourceFile('VERSION').trim();
  assert.match(version, /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/);
  const dependencies = JSON.parse(sourceFile('packaging/windows/dependencies.json'));
  const root = '_output/platform-publication';
  const destination = join(root, 'public');
  const files = stagePreview(join(root, 'windows', version, 'windows'), join(root, 'linux', version, 'linux'), destination, version, dependencies);
  const tag = `desktop-preview-${version}`;
  const marker = `<!-- cage-platform-preview source=${run.head_sha} ci=${runID} -->`;
  const notes = `${marker}\n\nCage ${version} 的 Windows 与 Linux 安装包，来自同一份通过三平台 CI 的源码。macOS 安装包继续从 [v${version}](https://github.com/${repo}/releases/tag/v${version}) 下载。\n\n- **Windows：未签名预览版**，Windows 10 22H2 / Windows 11 x64。安装包名含 \`-unsigned.exe\`；系统可能提示未知发布者，请核对来源和 SHA256SUMS。该包需手动更新，不进入签名自动更新通道。\n- **Linux：Debian 12 / Ubuntu 24.04 x86_64**，下载 \`.deb\` 并通过系统包管理器安装。\n- Windows 2022/2025 runner 上的安装、WebView2、重装、卸载和数据保留检查通过；Debian 12 容器中的 GTK/WebKit、安装重装、运行中拒绝替换及卸载保留数据检查通过。托管 CI 不代替硬件虚拟化和所有真实设备的兼容性验证。\n- 附带 Mihomo、QEMU 主程序对应源码和 SHA256SUMS。升级前保存并停止 Cage 环境，用户配置及项目保留。\n\n[查看完整 CI](https://github.com/${repo}/actions/runs/${runID}) · [官网下载](https://lee-xeo.github.io/Claude-Cage/#download)\n\n源码：${run.head_sha}\n`;
  const notesPath = join(root, 'notes.md'); writeFileSync(notesPath, notes);
  const releases = () => JSON.parse(gh(['api', '--paginate', '--slurp', `repos/${repo}/releases?per_page=100`])).flat();
  let release = releases().find(item => item.tag_name === tag);
  if (!release) {
    const refs = api(`git/matching-refs/tags/${tag}`);
    const ref = refs.find(item => item.ref === `refs/tags/${tag}`);
    if (ref) assert.equal(ref.object.sha, run.head_sha, 'Existing preview tag belongs to another commit');
    else api('git/refs', ['--method', 'POST', '-f', `ref=refs/tags/${tag}`, '-f', `sha=${run.head_sha}`]);
    gh(['release', 'create', tag, '--repo', repo, '--verify-tag', '--draft', '--prerelease', '--latest=false', '--title', `Cage ${version} · Windows 未签名 / Linux 预览版`, '--notes-file', notesPath]);
    release = releases().find(item => item.tag_name === tag);
  }
  assert.ok(release && release.body.includes(marker), 'Release belongs to a different source/run');
  for (const [name, file] of files) {
    const asset = release.assets.find(item => item.name === name);
    if (asset) {
      assert.equal(asset.digest, `sha256:${file.digest}`, `Existing asset differs: ${name}`);
      assert.equal(asset.size, file.size);
    } else {
      assert.equal(release.draft, true, 'Never add to or replace a published preview');
      gh(['release', 'upload', tag, join(destination, name), '--repo', repo]);
    }
  }
  release = api(`releases/${release.id}`);
  assert.deepEqual(release.assets.map(a => a.name).sort(), [...files.keys()].sort());
  for (const asset of release.assets) {
    assert.equal(asset.state, 'uploaded');
    assert.equal(asset.digest, `sha256:${files.get(asset.name).digest}`);
    assert.equal(asset.size, files.get(asset.name).size);
  }
  if (release.draft) release = api(`releases/${release.id}`, ['--method', 'PATCH', '-F', 'draft=false', '-F', 'prerelease=true', '-f', 'make_latest=false']);
  appendFileSync(process.env.GITHUB_OUTPUT, `tag=${tag}\nurl=${release.html_url}\n`);
  console.log(`Published verified platform preview: ${release.html_url}`);
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch(error => { console.error(error.message); process.exitCode = 1; });
