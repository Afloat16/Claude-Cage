import assert from "node:assert/strict";
import test from "node:test";
import { needsProxySetup } from "./onboarding-state.mjs";

const settings = { proxy_url: "socks5://127.0.0.1:17896" };
test("fresh default endpoint and imported but unselected nodes still need setup", () => {
  assert.equal(needsProxySetup(settings, {}, { active: false }), true);
  assert.equal(
    needsProxySetup(settings, {}, { active: false, selected: "node" }),
    true,
  );
  assert.equal(needsProxySetup({ proxy_url: "" }, {}, {}), true);
});
test("applied built-in node and external profiles can start without onboarding", () => {
  assert.equal(
    needsProxySetup(settings, {}, { active: true, selected: "node" }),
    false,
  );
  assert.equal(
    needsProxySetup({ proxy_url: "http://127.0.0.1:7890" }, {}, {}),
    false,
  );
  assert.equal(needsProxySetup(settings, { can_restore: true }, {}), false);
  assert.equal(needsProxySetup(settings, { vm_running: true }, {}), false);
});
