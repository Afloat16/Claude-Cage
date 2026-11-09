// Cage's private control pipe serves a person using the browser.
Object.defineProperty(Navigator.prototype, "webdriver", {
  get: () => false,
  configurable: true,
});
