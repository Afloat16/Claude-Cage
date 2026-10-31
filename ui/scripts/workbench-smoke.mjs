import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createWorkbench } from "./workbench-fixture.mjs";

const output = fileURLToPath(
  new URL("../../docs/test-reports/2026-10-31-codex-layout/", import.meta.url),
);
await fs.mkdir(output, { recursive: true });
const { browser, page, state, errors } = await createWorkbench();
const checks = [];
const shot = (name) =>
  page.screenshot({ path: output + name + ".png", animations: "disabled" });
const settings = () => page.getByRole("button", { name: /^设置/ }).click();
const tabs = () => page.getByRole("tablist", { name: "工作区标签" });
try {
  await shot("main");
  await page
    .getByRole("button", { name: "启动 Cage 环境", exact: true })
    .click();
  await page
    .getByRole("heading", { name: "Cage 环境已就绪", exact: true })
    .waitFor();
  await page
    .getByRole("navigation", { name: "主导航" })
    .getByRole("button", { name: /^打开项目/ })
    .click();
  await page.getByRole("button", { name: "选择文件夹…", exact: true }).click();
  await page.waitForFunction(
    (path) => document.getElementById("project-path")?.value === path,
    state.chosenFolder,
  );
  assert.equal(
    await page.getByLabel("项目文件夹", { exact: true }).inputValue(),
    state.chosenFolder,
  );
  state.failJob = true;
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "打开项目", exact: true })
    .click();

  await page
    .getByRole("dialog")
    .getByRole("alert")
    .filter({ hasText: "项目文件夹连接失败" })
    .waitFor();
  assert.equal(
    await page.getByLabel("项目文件夹", { exact: true }).inputValue(),
    state.chosenFolder,
  );
  assert.ok(state.settings.workspace.endsWith(".claude-cage-workspace"));
  state.failJob = false;
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "打开项目", exact: true })
    .click();

  await page.getByRole("dialog").waitFor({ state: "hidden" });
  assert.equal(state.settings.workspace, state.chosenFolder);
  await page.reload();
  await page
    .getByRole("heading", { name: "design-lab", exact: true })
    .waitFor();
  assert.ok(
    (
      await page.evaluate(() =>
        JSON.parse(localStorage.getItem("cage-projects")),
      )
    ).includes(state.chosenFolder),
  );
  checks.push("本地选择器入口、异步失败保留路径、成功打开、最近项目刷新读回");
  await page
    .getByRole("heading", { name: "design-lab", exact: true })
    .waitFor();
  await page
    .getByRole("button", { name: "新建终端", exact: true })
    .first()
    .click();
  await page.getByRole("tab", { name: "终端 1", exact: true }).waitFor();
  await page.getByRole("button", { name: "管理 终端 1", exact: true }).click();
  await page.getByRole("menuitem", { name: "重命名标签" }).click();
  await page.getByLabel("标签名称").fill("开发终端");
  await page.getByRole("button", { name: "保存名称" }).click();
  await page.getByRole("tab", { name: "开发终端" }).waitFor();
  await page.getByRole("button", { name: "打开浏览器", exact: true }).click();
  await page.getByRole("tab", { name: "新标签页", exact: true }).waitFor();
  await page.getByLabel("网页地址或搜索").fill("localhost:3000");
  await page.getByRole("button", { name: "打开地址", exact: true }).click();
  await page.getByRole("tab", { name: "本地预览", exact: true }).waitFor();
  assert.equal(state.tabs[0].url, "http://localhost:3000/");
  await page
    .getByRole("button", { name: "管理 本地预览", exact: true })
    .click();
  await page.getByRole("menuitem", { name: "置顶标签", exact: true }).click();
  assert.equal(await tabs().getByRole("tab").first().innerText(), "本地预览");
  await page.getByRole("button", { name: "打开文件", exact: true }).click();
  await page
    .getByRole("tab", { name: "文件 · design-lab", exact: true })
    .waitFor();
  await page.getByRole("button", { name: "关闭当前标签", exact: true }).click();
  await page.getByRole("dialog", { name: "关闭文件编辑器？" }).waitFor();
  await page
    .getByRole("dialog")
    .last()
    .getByRole("button", { name: "取消", exact: true })
    .click();
  assert.equal(state.tabs.length, 2);
  await page
    .getByRole("tab", { name: "文件 · design-lab", exact: true })
    .locator("..")
    .dragTo(page.getByRole("tab", { name: "开发终端" }).locator(".."));
  await page.reload();
  await page.getByRole("tab", { name: "开发终端" }).waitFor();
  assert.deepEqual(await tabs().getByRole("tab").allTextContents(), [
    "本地预览",
    "文件 · design-lab",
    "开发终端",
  ]);
  await page.keyboard.press("Meta+3");
  await page.waitForFunction(
    () =>
      document.querySelector('[role="tab"][aria-selected="true"]')
        ?.textContent === "开发终端",
  );
  await shot("workspace-terminal");
  checks.push(
    "终端/浏览器/文件入口、地址导航、标签重命名/置顶/拖动及刷新、按显示顺序快捷切换、文件关闭取消",
  );
  const connections = state.terminalConnections;
  await settings();
  await page.getByRole("heading", { name: "通用", exact: true }).waitFor();
  await shot("settings");
  await page.getByRole("radio", { name: /^原生 Linux/ }).check();
  await page
    .getByRole("button", { name: "返回工作台", exact: true })
    .first()
    .click();
  await page.getByRole("dialog", { name: "放弃尚未保存的修改？" }).waitFor();
  await page
    .getByRole("dialog")
    .last()
    .getByRole("button", { name: "取消", exact: true })
    .click();
  assert.equal(
    await page.getByRole("radio", { name: /^原生 Linux/ }).isChecked(),
    true,
  );
  state.failSave = true;
  await page.getByRole("button", { name: "保存设置", exact: true }).click();
  await page.getByRole("alert").filter({ hasText: "保存失败" }).waitFor();
  assert.equal(
    await page.getByRole("radio", { name: /^原生 Linux/ }).isChecked(),
    true,
  );
  state.failSave = false;
  await page.getByRole("button", { name: "保存设置", exact: true }).click();
  await page
    .getByRole("region", { name: "设置", exact: true })
    .waitFor({ state: "hidden" });
  assert.equal(state.settings.keyboard, "native");
  assert.equal(state.terminalConnections, connections);
  await settings();
  assert.equal(
    await page.getByRole("radio", { name: /^原生 Linux/ }).isChecked(),
    true,
  );
  await page.getByRole("button", { name: "时区与语言", exact: true }).click();
  await page.getByRole("switch", { name: /跟随出口 IP 的时区/ }).uncheck();
  await page.getByLabel("系统时区", { exact: true }).fill("Etc/UTC");
  await page.getByRole("button", { name: "保存并重启", exact: true }).click();
  await page.getByRole("dialog", { name: "应用设置并重启环境？" }).waitFor();
  await page
    .getByRole("dialog")
    .last()
    .getByRole("button", { name: "取消", exact: true })
    .click();
  assert.equal(state.settings.proxy_url, "socks5://127.0.0.1:17896");
  checks.push(
    "设置草稿离开确认、保存失败保留输入、保存成功读回、后台终端连接保留、重启取消",
  );
  await page.setViewportSize({ width: 820, height: 558 });
  await shot("settings-minimum");
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
    false,
  );
  await page.getByRole("button", { name: "时区与语言", exact: true }).click();
  await shot("settings-region-minimum");
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "放弃修改", exact: true }).click();
  await page
    .getByRole("navigation", { name: "主导航" })
    .getByRole("button", { name: /^打开项目/ })
    .click();
  await page
    .getByLabel("项目文件夹", { exact: true })
    .fill("/Users/shihao/Projects/another-project");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "打开项目", exact: true })
    .click();
  await page.getByRole("dialog").waitFor({ state: "hidden" });
  assert.equal(
    state.settings.workspace,
    "/Users/shihao/Projects/another-project",
  );
  assert.ok(state.terminals.length > 0);
  assert.ok(state.tabs.length > 0);
  assert.equal(
    await page.getByRole("tab", { name: "开发终端", exact: true }).count(),
    1,
  );
  await page.getByRole("button", { name: "工作台", exact: true }).click();
  await shot("main-minimum");
  await page.getByRole("button", { name: "收起侧栏", exact: true }).click();
  await page.reload();
  await page.getByRole("button", { name: "展开侧栏", exact: true }).waitFor();
  await page.setViewportSize({ width: 375, height: 812 });
  await shot("compact-workspace");
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
    false,
  );
  checks.push(
    "运行中项目切换保留终端和网页、820px 最小窗口、侧栏折叠刷新、375px 收起侧栏无横向溢出",
  );
  assert.deepEqual(errors, []);
  await fs.writeFile(
    output + "smoke-result.json",
    JSON.stringify(
      {
        passed: true,
        checks,
        pageErrors: errors,
        scope:
          "Mock API/native picker/terminal socket; no real VM, network or file edit verification.",
      },
      null,
      2,
    ),
  );
  console.log(JSON.stringify({ passed: true, checks }, null, 2));
} finally {
  await browser.close();
}
