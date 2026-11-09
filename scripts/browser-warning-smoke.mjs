import assert from "node:assert/strict";
import { createPrivacyController } from "./browser-privacy-fixture.mjs";

const fixture = await createPrivacyController();
try {
  const { api, evaluate, waitFor, origin, restart } = fixture;
  async function check(id) {
    await waitFor(() => evaluate(id, "document.readyState === 'complete'"), "page loaded");
    assert.deepEqual(await evaluate(id, "[navigator.webdriver, globalThis.webdriverAtLoad]"), [false, false]);
  }
  await check((await api("/tabs")).active);
  for (const incognito of [false, true]) {
    const tab = await api("/new", { url: origin + "/identity", incognito });
    await check(tab.id);
    const frameIdentity = await evaluate(tab.id, `new Promise(resolve => {
      const frame = document.createElement('iframe');
      const received = event => {
        if (event.source !== frame.contentWindow || !('fixtureIdentity' in (event.data || {}))) return;
        removeEventListener('message', received); frame.remove(); resolve(event.data.fixtureIdentity);
      };
      addEventListener('message', received);
      frame.src = ${JSON.stringify(origin.replace("localhost", "127.0.0.1") + "/frame")};
      document.body.append(frame);
    })`);
    assert.equal(frameIdentity, false, "cross-site frame must retain the same browser identity");
    await fixture.cdp(tab.id, "Runtime.evaluate", {
      expression: `window.open(${JSON.stringify(origin + "/popup")}, '_blank'); true`,
      userGesture: true,
    });
    const popup = await waitFor(async () => (await api("/tabs")).tabs.find(item => item.url === origin + "/popup"), "popup loaded");
    await check(popup.id);
    await api("/close", { id: popup.id });
    await api("/navigate", { id: tab.id, url: origin + "/next" });
    await check(tab.id);
    await api("/close", { id: tab.id });
  }
  await restart();
  await check((await api("/tabs")).active);
  const beforeAudit = (await api("/tabs")).tabs.map(tab => tab.id);
  const audit = await api("/audit", { timezone: "UTC", network: false });
  assert.ok(audit.language && audit.timezone);
  assert.deepEqual((await api("/tabs")).tabs.map(tab => tab.id), beforeAudit, "settings audit must not retain a diagnostic tab");
  console.log("PASS: first page script, normal/private navigation and profile restart retain browser identity without the warning flag");
} finally { await fixture.close(); }
