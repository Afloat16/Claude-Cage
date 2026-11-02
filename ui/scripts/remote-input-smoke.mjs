// Start the UI dev server first. Uses the real noVNC keyboard and RFB encoder,
// with an in-memory socket; this does not replace native IME/guest acceptance.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { chromium } = require(
  process.env.CAGE_PLAYWRIGHT_MODULE || "playwright",
);
const browser = await chromium.launch({ headless: true, executablePath: process.env.CAGE_TEST_BROWSER_PATH });
const page = await browser.newPage();
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
const origin = process.env.CAGE_UI_URL || "http://127.0.0.1:5173";
try {
  await page.route("**/remote-input-smoke", (route) =>
    route.fulfill({
      contentType: "text/html; charset=utf-8",
      body: '<div id="remote"><canvas tabindex="-1"></canvas></div><input aria-label="本机地址栏">',
    }),
  );
  await page.goto(origin + "/remote-input-smoke");
  await page.evaluate(async () => {
    const [{ default: RFB }, { default: Keyboard }, { installRemoteInput }] =
      await Promise.all([
        import("/.generated/novnc/core/rfb.js"),
        import("/.generated/novnc/core/input/keyboard.js"),
        import("/src/remote-input.js"),
      ]);
    const container = document.querySelector("#remote");
    const rfb = new EventTarget();
    // Use production methods through the final wire encoder, without opening
    // a guest connection or capturing any user clipboard content.
    for (const name of [
      "sendKey",
      "_cageSendKey",
      "_cageQueueInput",
      "_handleKeyEvent",
      "cageSetKeyboardTarget",
      "focus",
      "blur",
    ])
      rfb[name] = RFB.prototype[name].bind(rfb);
    rfb._canvas = container.querySelector("canvas");
    rfb._keyboard = new Keyboard(rfb._canvas);
    rfb._rfbConnectionState = "connected";
    rfb._remoteCapsLock = rfb._remoteNumLock = null;
    const packets = [];
    let bytes = [];
    rfb._sock = {
      sQpush8(value) {
        bytes.push(value);
      },
      sQpush16(value) {
        bytes.push((value >> 8) & 255, value & 255);
      },
      sQpush32(value) {
        bytes.push(
          value >>> 24,
          (value >> 16) & 255,
          (value >> 8) & 255,
          value & 255,
        );
      },
      flush() {
        packets.push(bytes);
        bytes = [];
      },
    };
    const texts = [];
    rfb.cagePasteText = (text) =>
      rfb._cageQueueInput(() => {
        texts.push(text);
      });
    let active = true;
    const options = {
      mode: () => "mac",
      isActive: () => active,
      insertText: (text) => rfb.cagePasteText(text),
      onStatus() {},
      onFallback() {},
    };
    const install = () => installRemoteInput(rfb, container, options);
    window.probe = {
      rfb,
      packets,
      texts,
      input: install(),
      install,
      setActive: (value) => {
        active = value;
      },
    };
    rfb.focus();
  });
  const target = page.getByLabel("Cage 网页输入");
  const keys = () =>
    page.evaluate(() =>
      probe.packets.map((p) => {
        if (p.length !== 8 || p[0] !== 4)
          throw new Error("Unexpected RFB key packet");
        return {
          down: p[1],
          sym: ((p[4] << 24) | (p[5] << 16) | (p[6] << 8) | p[7]) >>> 0,
        };
      }),
    );
  const texts = () => page.evaluate(() => [...probe.texts]);
  const clear = () =>
    page.evaluate(() => {
      probe.packets.length = 0;
      probe.texts.length = 0;
    });
  const dispatch = (type, detail) =>
    target.evaluate(
      (node, { type, detail }) => {
        const EventType = type.startsWith("composition")
          ? CompositionEvent
          : InputEvent;
        node.dispatchEvent(new EventType(type, { bubbles: true, ...detail }));
      },
      { type, detail },
    );
  const compose = async (text) => {
    await dispatch("compositionstart", { data: "" });
    await dispatch("input", {
      data: "nihao",
      isComposing: true,
      inputType: "insertCompositionText",
    });
    await dispatch("compositionend", { data: text });
    await dispatch("input", { data: text, inputType: "insertFromComposition" });
  };
  await page.keyboard.type("abc");
  assert.deepEqual(
    (await keys()).filter((k) => k.down).map((k) => k.sym),
    [97, 98, 99],
  );
  assert.equal(await target.inputValue(), "");
  await clear();
  // Exercise Chromium's composition implementation as well as the explicit
  // cross-engine event sequences below. This still does not use macOS Pinyin.
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Input.imeSetComposition", {
    text: "nihao",
    selectionStart: 5,
    selectionEnd: 5,
  });
  assert.equal(await target.inputValue(), "nihao");
  assert.deepEqual(await keys(), []);
  await cdp.send("Input.insertText", { text: "你好" });
  assert.deepEqual(await texts(), ["你好"]);
  assert.deepEqual(await keys(), []);
  assert.equal(await target.inputValue(), "");
  await clear();
  await cdp.send("Input.insertText", { text: "🙂" });
  assert.deepEqual(await texts(), ["🙂"]);
  await clear();
  await cdp.detach();
  await dispatch("compositionstart", { data: "" });
  const accepted = await target.evaluate((node) =>
    node.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Process",
        code: "KeyN",
        keyCode: 229,
        bubbles: true,
        cancelable: true,
        isComposing: true,
      }),
    ),
  );
  assert.equal(
    accepted,
    true,
    "host IME key default action must remain enabled",
  );
  await page.keyboard.press("Space");
  assert.deepEqual(
    await keys(),
    [],
    "candidate selection must not reach the guest",
  );
  await dispatch("compositionend", { data: "你好🙂" });
  await dispatch("input", {
    data: "你好🙂",
    inputType: "insertFromComposition",
  });
  await page.keyboard.press("Enter");
  assert.deepEqual(
    (await keys()).filter((k) => k.down).map((k) => k.sym),
    [0xff0d],
  );
  assert.equal(await target.inputValue(), "");
  await clear();
  await compose("你");
  await compose("你");
  assert.deepEqual(await texts(), ["你", "你"]);
  await clear();
  // A delayed commit must keep subsequent Enter behind text completion.
  await page.evaluate(() => {
    probe.rfb._cageQueueInput(
      () =>
        new Promise((resolve) => {
          probe.finishText = resolve;
        }),
    );
  });
  await page.keyboard.press("Enter");
  assert.deepEqual(await keys(), []);
  await page.evaluate(() => probe.finishText());
  assert.deepEqual(
    (await keys()).map((k) => k.sym),
    [0xff0d, 0xff0d],
  );
  await clear();
  // On transfer failure, do not submit a form with the committed text missing.
  await page.evaluate(() => {
    probe.rfb._cageQueueInput(
      () =>
        new Promise((resolve, reject) => {
          probe.failText = reject;
        }),
    );
  });
  await page.keyboard.press("Enter");
  await page.evaluate(() => probe.failText(new Error("test transfer failure")));
  assert.deepEqual(await keys(), []);
  await compose("");
  assert.deepEqual(await keys(), []);
  await page.keyboard.down("Shift");
  await dispatch("compositionstart", { data: "" });
  await page.keyboard.up("Shift");
  assert.deepEqual(
    (await keys()).map((k) => k.down),
    [1, 0],
    "modifiers released during composition must not stick",
  );
  assert.equal(
    await page.evaluate(() => probe.input.edit("undo")),
    false,
    "native menus must edit the host composition",
  );
  await dispatch("compositionend", { data: "" });
  await clear();
  await page.getByLabel("本机地址栏").fill("本机文字");
  assert.deepEqual(await keys(), []);
  await page.evaluate(() => probe.rfb.focus());
  await page.keyboard.press("Meta+f");
  assert.deepEqual(
    (await keys()).filter((k) => k.down).map((k) => k.sym),
    [0xffe3, 102],
  );
  await clear();
  await page.evaluate(() => probe.setActive(false));
  await compose("后台不提交");
  assert.deepEqual(await keys(), []);
  await page.evaluate(() => {
    probe.setActive(true);
    probe.input.dispose();
    probe.input = probe.install();
    probe.rfb.focus();
  });
  assert.equal(await target.count(), 1);
  await page.keyboard.press("b");
  assert.deepEqual(
    (await keys()).filter((k) => k.down).map((k) => k.sym),
    [98],
  );
  await clear();
  await page.evaluate(() => {
    const oldTarget = document.activeElement;
    probe.input.dispose();
    oldTarget.dispatchEvent(
      new CompositionEvent("compositionend", { data: "迟到的文字" }),
    );
    probe.rfb.focus();
  });
  assert.equal(await target.count(), 0);
  assert.equal(
    await page.evaluate(() => document.activeElement.tagName),
    "CANVAS",
  );
  assert.deepEqual(await keys(), []);
  assert.deepEqual(errors, []);
  console.log(
    JSON.stringify(
      {
        passed: true,
        checks: [
          "real noVNC keyboard and RFB encoding",
          "English input",
          "Chromium IME engine commit",
          "composition default action",
          "candidate suppression",
          "Unicode text transfer",
          "text and Enter order",
          "failed transfer cancels queued Enter",
          "repeated commits",
          "cancel",
          "modifier release",
          "native edit routing",
          "local field isolation",
          "Command mapping",
          "inactive view",
          "reconnect and disposal",
        ],
        limitation:
          "Covers the Chromium composition engine and simulated event sequences; native macOS IME and guest rendering require separate acceptance.",
      },
      null,
      2,
    ),
  );
} finally {
  await browser.close();
}
