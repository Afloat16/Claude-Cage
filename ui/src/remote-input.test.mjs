import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
const source = readFileSync(
  new URL("./remote-input.js", import.meta.url),
  "utf8",
)
  .replace(/^import[\s\S]*?;\n/gm, "")
  .replace("export function installRemoteInput", "function installRemoteInput");
function fixture(native = false) {
  const doc = new EventTarget(),
    win = new EventTarget(),
    canvas = {},
    local = {},
    keys = [],
    pastes = [],
    writes = [],
    statuses = [];
  let reads = 0,
    mode = "mac";
  doc.activeElement = canvas;
  doc.body = { append() {} };
  doc.createElement = () => ({
    style: {},
    setAttribute() {},
    focus() {
      doc.activeElement = this;
    },
    remove() {},
  });
  const rfb = new EventTarget();
  rfb.sendKey = (...args) => keys.push(args);
  rfb.focus = () => {
    doc.activeElement = canvas;
  };
  rfb.cagePasteText = (text) => {
    pastes.push(text);
    return Promise.resolve();
  };
  const context = {
    document: doc,
    window: win,
    setTimeout,
    clearTimeout,
    Promise,
    Map,
    Set,
    console,
    readClipboard: async () => {
      reads++;
      return "中文🙂";
    },
    writeClipboard: async (text) => writes.push(text),
    nativeAvailable: () => native,
    getKeycode: (e) => e.code,
    getKeysym: (e) =>
      ({ Shift: 0xffe1, Control: 0xffe3, Alt: 0xffe9, Meta: 0xffeb })[e.key] ??
      (e.key.length === 1 ? e.key.codePointAt(0) : null),
  };
  const install = vm.runInNewContext(source + "\ninstallRemoteInput;", context);
  const controller = install(
    rfb,
    { contains: (element) => element === canvas },
    {
      mode: () => mode,
      onStatus: (t) => statuses.push(t),
      onFallback() {},
      isActive: () => true,
    },
  );
  const key = (type, key, code, extra = {}) => {
    const event = new Event(type, { cancelable: true });
    Object.assign(event, {
      key,
      code,
      metaKey: false,
      ctrlKey: false,
      shiftKey: false,
      altKey: false,
      ...extra,
    });
    doc.dispatchEvent(event);
    return event;
  };
  return {
    doc,
    win,
    rfb,
    keys,
    pastes,
    writes,
    statuses,
    controller,
    key,
    local,
    setMode: (value) => {
      mode = value;
    },
    reads: () => reads,
  };
}
test("Mac find and redo preserve the Linux Ctrl/Shift chord", () => {
  const f = fixture();
  try {
    assert.equal(
      f.key("keydown", "f", "KeyF", { metaKey: true }).defaultPrevented,
      true,
    );
    assert.deepEqual(
      f.keys.map((k) => [k[0], k[2]]),
      [
        [0xffe3, true],
        [102, true],
        [102, false],
        [0xffe3, false],
      ],
    );
    f.keys.length = 0;
    f.key("keydown", "\0", "KeyZ", { metaKey: true, shiftKey: true });
    assert.deepEqual(
      f.keys.map((k) => [k[0], k[2]]),
      [
        [0xffe3, true],
        [0xffe1, true],
        [90, true],
        [90, false],
        [0xffe1, false],
        [0xffe3, false],
      ],
    );
  } finally {
    f.controller.dispose();
  }
});
test("local fields and native keyboard mode do not acquire mapped shortcuts", () => {
  const f = fixture();
  try {
    f.doc.activeElement = f.local;
    assert.equal(
      f.key("keydown", "f", "KeyF", { metaKey: true }).defaultPrevented,
      false,
    );
    assert.equal(f.keys.length, 0);
    f.rfb.focus();
    f.setMode("native");
    f.key("keydown", "f", "KeyF", { metaKey: true });
    assert.equal(f.keys.length, 0);
  } finally {
    f.controller.dispose();
  }
});
test("background clipboard notifications never write to the host", async () => {
  const f = fixture();
  try {
    const clipboard = new Event("clipboard");
    clipboard.detail = { text: "guest text" };
    f.rfb.dispatchEvent(clipboard);
    await Promise.resolve();
    assert.equal(f.reads(), 0);
    assert.deepEqual(f.writes, []);
    f.key("keydown", "c", "KeyC", { metaKey: true });
    f.rfb.dispatchEvent(clipboard);
    await Promise.resolve();
    assert.deepEqual(f.writes, ["guest text"]);
  } finally {
    f.controller.dispose();
  }
});
test("native menu paste accepts every rapid gesture, without debouncing", async () => {
  const f = fixture(true);
  try {
    for (let i = 0; i < 10; i++)
      f.key("keydown", "v", "KeyV", { metaKey: true });
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(f.reads(), 10);
    assert.equal(f.pastes.length, 10);
    assert.ok(f.pastes.every((t) => t === "中文🙂"));
  } finally {
    f.controller.dispose();
  }
});
test("mapped modifier is released even after focus is lost", () => {
  const f = fixture();
  try {
    f.key("keydown", "Shift", "ShiftLeft", { metaKey: true, shiftKey: true });
    f.doc.activeElement = f.local;
    f.win.dispatchEvent(new Event("blur"));
    assert.deepEqual(f.keys, [
      [0xffe1, "ShiftLeft", true],
      [0xffe1, "ShiftLeft", false],
    ]);
  } finally {
    f.controller.dispose();
  }
});

test("a clipboard read finishing after disconnect is not pasted into a stale connection", async () => {
  const f = fixture(true);
  f.controller.readAndPaste();
  f.controller.dispose();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(f.pastes.length, 0);
});

test("malformed native Command letters retain clipboard and redo semantics", async () => {
  const f = fixture(true);
  try {
    f.key("keydown", "\u0016", "KeyV", { metaKey: true });
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(f.reads(), 1);
    assert.equal(f.pastes.length, 1);
    assert.equal(f.keys.length, 0);
    for (const letter of ["\ufffd", "\uf700", "Ω"]) {
      f.keys.length = 0;
      f.key("keydown", letter, "KeyZ", { metaKey: true, shiftKey: true });
      assert.deepEqual(
        f.keys.map((k) => [k[0], k[2]]),
        [
          [0xffe3, true],
          [0xffe1, true],
          [90, true],
          [90, false],
          [0xffe1, false],
          [0xffe3, false],
        ],
      );
    }
  } finally {
    f.controller.dispose();
  }
});
