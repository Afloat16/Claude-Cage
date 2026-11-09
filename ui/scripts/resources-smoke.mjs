import assert from "node:assert/strict";
import { createWorkbench } from "./workbench-fixture.mjs";

const { browser, page, errors } = await createWorkbench();
const windowsRuntime = process.env.CAGE_RESOURCE_RUNTIME === "hyperv";
let allocation = { automatic: true, memory_gib: 12, cpus: 5 };
let rejectSave = false;
const saves = [];
await page.route("**/api/environment/resources", async (route) => {
  if (route.request().method() === "POST") {
    if (rejectSave) return route.fulfill({ status: 400, contentType: "text/plain; charset=utf-8", body: "资源配置保存失败" });
    const body = route.request().postDataJSON();
    saves.push(body);
    if (body.allocation) allocation = body.allocation.automatic ? { automatic: true, memory_gib: 12, cpus: 5 } : body.allocation;
    return route.fulfill({ json: { ok: true } });
  }
  return route.fulfill({ json: { ...allocation, ...(windowsRuntime ? { runtime: "hyperv", min_memory_gib: 4, min_cpus: 2 } : {}), running: false, recommended_memory_bytes: 12 * 2 ** 30, recommended_cpus: rejectSave ? 6 : 5, max_memory_gib: 12, max_cpus: 5 } });
});
async function open() {
  await page.getByRole("button", { name: "设置", exact: true }).click();
  await page.getByRole("navigation", { name: "设置分组" }).getByRole("button", { name: "环境与恢复", exact: true }).click();
  await page.getByLabel("自动分配资源上限").waitFor();
}
try {
  await open();
  assert.equal(await page.getByLabel("自动分配资源上限").isChecked(), true);
  await page.getByLabel("自动分配资源上限").uncheck();
  if (windowsRuntime) {
    assert.equal(await page.getByLabel("内存上限（GiB）", { exact: true }).getAttribute("min"), "4");
    assert.equal(await page.getByLabel("CPU 逻辑核心数", { exact: true }).getAttribute("min"), "2");
    await page.getByLabel("内存上限（GiB）", { exact: true }).fill("3");
    await page.getByRole("button", { name: "保存资源配置", exact: true }).click();
    assert.equal(saves.length, 0);
    await page.getByText(/内存与 CPU 用量来自 Windows 客机的系统观测/).waitFor();
  }
  await page.getByLabel("内存上限（GiB）", { exact: true }).fill("4");
  await page.getByLabel("CPU 逻辑核心数", { exact: true }).fill("2");
  await page.screenshot({ path: "/tmp/cage-resource-settings.png", fullPage: true });
  await page.getByRole("button", { name: "保存资源配置", exact: true }).click();
  await page.getByText("已保存，下次启动环境时生效。", { exact: true }).waitFor();
  assert.deepEqual(allocation, { automatic: false, memory_gib: 4, cpus: 2 });
  await page.reload();
  await open();
  assert.equal(await page.getByLabel("内存上限（GiB）", { exact: true }).inputValue(), "4");
  assert.equal(await page.getByLabel("CPU 逻辑核心数", { exact: true }).inputValue(), "2");
  const count = saves.length;
  await page.getByLabel("内存上限（GiB）", { exact: true }).fill("13");
  await page.getByRole("button", { name: "保存资源配置", exact: true }).click();
  assert.equal(saves.length, count);
  await page.getByLabel("内存上限（GiB）", { exact: true }).fill("6");
  rejectSave = true;
  await page.getByRole("button", { name: "保存资源配置", exact: true }).click();
  await page.getByRole("alert").filter({ hasText: "资源配置保存失败" }).waitFor();
  await page.waitForResponse(response => response.url().endsWith("/api/environment/resources") && response.request().method() === "GET" && response.ok());
  await page.getByText("6 个逻辑核心", { exact: true }).waitFor();
  assert.equal(await page.getByRole("alert").filter({ hasText: "资源配置保存失败" }).isVisible(), true);
  assert.equal(await page.getByLabel("内存上限（GiB）", { exact: true }).inputValue(), "6");
  rejectSave = false;
  await page.getByLabel("自动分配资源上限").check();
  await page.getByRole("button", { name: "保存资源配置", exact: true }).click();
  await page.getByText("已保存，下次启动环境时生效。", { exact: true }).waitFor();
  assert.equal(allocation.automatic, true);
  assert.equal(await page.getByRole("alert").filter({ hasText: "资源配置保存失败" }).count(), 0);
  assert.deepEqual(errors, []);
  console.log("Resource settings: manual save, reload, bounds, failure retention, automatic mode passed.");
} finally { await browser.close(); }
