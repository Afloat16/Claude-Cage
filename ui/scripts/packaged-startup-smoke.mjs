import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createRequire } from "node:module";

const run = promisify(execFile);
const bundle = process.argv[2];
assert.ok(bundle?.startsWith("/") && bundle.endsWith(".app"), "supply an absolute packaged App path");
const cage = path.join(bundle, "Contents/Resources/cage");
const profile = await fs.mkdtemp(path.join(os.tmpdir(), "cage-packaged-"));
const env = { ...process.env, CLAUDE_CAGE_CONFIG: path.join(profile, "config.json") };
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.CAGE_PLAYWRIGHT_MODULE || "playwright");
let browser;
try {
  const { stdout } = await run(cage, ["desktop", "--json"], { env });
  const entry = JSON.parse(stdout);
  assert.equal(entry.status, "ready");
  assert.equal(entry.controller.version, (await fs.readFile(new URL("../../VERSION", import.meta.url), "utf8")).trim());
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const statusResponse = page.waitForResponse((response) => response.url().endsWith("/api/status") && response.ok());
  await page.goto(entry.url);
  const status = await (await statusResponse).json();
  assert.equal(status.vm_running, false);
  await page.getByRole("button", { name: "配置网络与代理", exact: true }).waitFor();
  assert.equal(new URL(page.url()).hash, "", "launch ticket was not removed");
  await page.getByRole("button", { name: "配置网络与代理", exact: true }).click();
  await page.getByText("添加来源", { exact: true }).first().waitFor();
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ checks: ["packaged helper bootstrap", "real session and APIs", "embedded production UI loaded", "private profile onboarding", "launch ticket removed"], version: entry.controller.version }));
} finally {
  await browser?.close();
  await run(cage, ["prepare-update", "--json"], { env });
  await fs.rm(profile, { recursive: true, force: true });
  await fs.rm(profile + "-workspace", { recursive: true, force: true });
}
