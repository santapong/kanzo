"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const source = fs.readFileSync(path.join(__dirname, "../src/theme.js"), "utf8");

function browser({ saved = null, dark = false, blocked = false, legacyMedia = false } = {}) {
  let stored = saved;
  const events = [], listeners = {}, mediaListeners = [];
  const media = { matches: dark };
  if (legacyMedia) media.addListener = (callback) => mediaListeners.push(callback);
  else media.addEventListener = (name, callback) => { assert.equal(name, "change"); mediaListeners.push(callback); };
  const storage = {
    getItem(name) { assert.equal(name, "kanzo.theme"); if (blocked) throw new Error("denied"); return stored; },
    setItem(name, value) { assert.equal(name, "kanzo.theme"); if (blocked) throw new Error("denied"); stored = value; },
  };
  const document = { documentElement: { dataset: {} } };
  const window = {
    localStorage: storage,
    matchMedia(query) { assert.equal(query, "(prefers-color-scheme: dark)"); return media; },
    CustomEvent: class { constructor(type, options) { this.type = type; this.detail = options.detail; } },
    addEventListener(type, callback) { (listeners[type] ||= []).push(callback); },
    dispatchEvent(event) { events.push(event); for (const callback of listeners[event.type] || []) callback(event); },
  };
  vm.runInNewContext(source, { window, document });
  return {
    api: window.KanzoTheme, dataset: document.documentElement.dataset, events,
    stored: () => stored,
    mediaChange(value) { media.matches = value; for (const callback of mediaListeners) callback(); },
    storageChange(value, key = "kanzo.theme", area = storage) {
      if (area === storage) stored = value;
      for (const callback of listeners.storage || []) callback({ key, newValue: value, storageArea: area });
    },
  };
}

test("fresh and invalid preferences default to System before board code runs", () => {
  for (const saved of [null, "", "invalid", "DARK"]) {
    const b = browser({ saved, dark: true });
    assert.equal(b.api.getPreference(), "system");
    assert.equal(b.dataset.themePreference, "system");
    assert.equal(b.dataset.theme, "dark");
    assert.equal(b.stored(), saved, "boot does not overwrite stored data");
  }
});

test("valid saved manual choices win over the OS and remain manual after OS changes", () => {
  for (const [saved, os] of [["light", true], ["dark", false]]) {
    const b = browser({ saved, dark: os });
    assert.equal(b.api.getPreference(), saved);
    assert.equal(b.dataset.theme, saved);
    const eventCount = b.events.length;
    b.mediaChange(!os);
    assert.equal(b.dataset.theme, saved);
    assert.equal(b.events.length, eventCount);
  }
});

test("System follows live OS changes with both media listener APIs", () => {
  for (const legacyMedia of [false, true]) {
    const b = browser({ saved: "system", dark: false, legacyMedia });
    assert.equal(b.dataset.theme, "light");
    b.mediaChange(true);
    assert.equal(b.dataset.theme, "dark");
    assert.equal(b.dataset.themePreference, "system");
    b.mediaChange(false);
    assert.equal(b.dataset.theme, "light");
  }
});

test("explicit changes persist and emit resolved theme without board re-rendering", () => {
  const b = browser({ dark: true });
  assert.equal(b.api.setPreference("light"), "light");
  assert.equal(b.stored(), "light");
  assert.equal(b.dataset.theme, "light");
  assert.equal(b.events.at(-1).type, "kanzo:theme-change");
  assert.equal(b.events.at(-1).detail.preference, "light");
  assert.equal(b.events.at(-1).detail.theme, "light");
  b.api.setPreference("system");
  assert.equal(b.dataset.theme, "dark");
  b.mediaChange(false);
  assert.equal(b.dataset.theme, "light");
});

test("denied storage still keeps manual changes for the current tab", () => {
  const b = browser({ saved: "light", dark: false, blocked: true });
  assert.equal(b.api.getPreference(), "system");
  b.api.setPreference("dark");
  assert.equal(b.api.getPreference(), "dark");
  b.api.apply();
  b.mediaChange(true);
  b.mediaChange(false);
  assert.equal(b.dataset.theme, "dark");
  b.api.setPreference("system");
  b.mediaChange(true);
  assert.equal(b.dataset.theme, "dark");
  assert.equal(b.api.getPreference(), "system");
});

test("another tab can synchronize the theme without unrelated storage changes", () => {
  const b = browser({ dark: false });
  b.storageChange("dark");
  assert.equal(b.api.getPreference(), "dark");
  assert.equal(b.dataset.theme, "dark");
  b.storageChange("light", "unrelated-key");
  b.storageChange("light", "kanzo.theme", {});
  assert.equal(b.api.getPreference(), "dark");
  b.storageChange(null, null);
  assert.equal(b.api.getPreference(), "system");
  assert.equal(b.dataset.theme, "light");
  b.storageChange("not-a-theme");
  assert.equal(b.api.getPreference(), "system");
});
