import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createWorkbench } from "./workbench-fixture.mjs";

const output = process.env.CAGE_WORKSPACE_QA_OUTPUT || await mkdtemp(join(tmpdir(), "cage-default-workspace-ui-"));
await mkdir(output, { recursive: true });
const notice = "此历史会话仍使用原来的客机目录，文件保留在虚拟 Mac 内。要使用与主机共享的默认工作区，请从默认工作区新建会话。";
let allowed = false;
let screenAllowed = false, frameReads = 0, frameReadsAtClick = 0;
const actions = [];
const fixture = await createWorkbench({
  beforeNavigate: async (page, state) => {
    const panelImage = await page.evaluate(() => {
      const canvas = document.createElement("canvas");
      canvas.width = 480;
      canvas.height = 260;
      const context = canvas.getContext("2d");
      context.fillStyle = "#eee";
      context.fillRect(0, 0, canvas.width, canvas.height);
      return canvas.toDataURL("image/png").split(",")[1];
    });
    state.account.guest_system = state.status.guest_system = "macos";
    state.status.vm_running = state.status.ready = true;
    state.status.project_error = "请在虚拟 Mac 的项目授权窗口中选中此项目，然后重新打开";
    state.status.project_errors = [{ path: state.settings.workspace, message: state.status.project_error }];
    await page.route("**/api/projects/open", async route => {
      actions.push(route.request().postDataJSON());
      if (allowed) {
        state.status.project_error = "";
        state.status.project_errors = [];
      }
      return route.fulfill({ json: { workspace: state.settings.workspace, ...(allowed ? {} : { approval: "fixture-grant" }) } });
    });
    await page.route("**/api/macos/project-approval", route => {
      if (route.request().postDataJSON().action === "click") {
        frameReadsAtClick = frameReads;
        return route.fulfill({ json: { error: "accessibility_permission" } });
      }
      frameReads++;
      return route.fulfill({ json: screenAllowed
        ? { image: panelImage, window: 1, pid: 5, nonce: "fixture" }
        : { error: "project_screen_permission" } });
    });
    await page.route("**/api/cli/sessions/*/account", route => route.fulfill({ json: { supported: false, candidates: [], session: {} } }));
    await page.routeWebSocket("**/api/terminals/**", socket => socket.send(Buffer.from("隔离测试终端\r\n/Users/cage/.local/share/cage/workspace $ ")));
  },
});
const { page, state, browser, errors } = fixture;
try {
  await page.getByRole("button", { name: "连接项目", exact: true }).click();
  const project = page.getByRole("dialog", { name: "打开项目", exact: true });
  await project.waitFor();
  assert.equal(await project.getByRole("textbox", { name: "新项目文件夹", exact: true }).inputValue(), state.settings.workspace);
  await project.getByRole("button", { name: "打开项目", exact: true }).click();
  const permission = page.getByRole("dialog", { name: "允许客机访问所选项目", exact: true });
  await permission.waitFor();
  await permission.getByText(state.settings.workspace, { exact: true }).waitFor();
  await permission.getByRole("status").filter({ hasText: "屏幕与系统音频录制" }).waitFor();
  await page.screenshot({ path: join(output, "default-workspace-approval.png"), animations: "disabled" });
  screenAllowed = true;
  await permission.getByRole("img").click();
  const inputError = permission.getByRole("alert").filter({ hasText: "辅助功能" });
  await inputError.waitFor();
  await permission.getByRole("img").waitFor();
  assert.ok(frameReads > frameReadsAtClick, "next guest frame was fetched");
  assert.ok(await inputError.isVisible(), "polling must retain the failed click");
  allowed = true;
  await permission.getByRole("button", { name: "验证授权", exact: true }).click();
  await permission.waitFor({ state: "hidden" });
  assert.equal(actions.length, 2);
  assert.ok(actions.every(item => item.workspace === state.settings.workspace));

  state.terminals = [{ id: "legacy-default", kind: "claude", title: "历史默认会话", workspace: state.settings.workspace,
    cli_session_id: "01234567-1234-4234-8234-0123456789ab", workspace_notice: notice, closed: true }];
  await page.reload();
  await page.getByRole("tab", { name: "历史默认会话", exact: true }).click();
  await page.getByRole("status").filter({ hasText: notice }).waitFor();
  await page.screenshot({ path: join(output, "default-workspace-legacy-notice.png"), animations: "disabled" });
  assert.deepEqual(errors, []);
  const result = { passed: true, browser: browser.browserType().name(), actions, checks: ["default workspace reconnect opens existing project authorization", "missing screen permission shows the macOS settings path", "click permission error survives the next frame", "permission retry keeps the same host directory", "legacy guest-private workspace notice is visible in the terminal"] };
  await writeFile(join(output, "result.json"), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
} finally { await browser.close(); }
