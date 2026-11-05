// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const root = new URL("../../../..", import.meta.url);

function read(path) {
  return readFileSync(new URL(path, root), "utf8");
}

function ids(pattern, text) {
  return [...text.matchAll(pattern)].map(match => match[1]);
}

test("every tweak control has a pref, a setting, and a string", () => {
  const yaml = new Set(ids(/^- name: (zen\.tweaks\.[^\s]+)/gm, read("prefs/zen/tweaks.yaml")));
  const xhtml = read("src/browser/components/preferences/zenTweaks.inc.xhtml");
  const settings = read("src/browser/components/preferences/zen-settings.js");
  const prefsFtl = read("locales/en-US/browser/browser/preferences/zen-preferences.ftl");
  const browserFtl = read("locales/en-US/browser/browser/zen-general.ftl");
  const controls = ids(/preference="(zen\.tweaks\.[^"]+)"/g, xhtml);

  assert.ok(controls.length > 10);
  for (const pref of controls) {
    assert.ok(yaml.has(pref), `missing yaml pref ${pref}`);
    assert.match(settings, new RegExp(`id: "${pref.replaceAll(".", "\\.")}"`));
  }
  for (const name of yaml) {
    assert.ok(
      controls.includes(name) || name == "zen.tweaks.toggle-toolbar" || name == "zen.tweaks.extensions-shortcut",
      `yaml pref ${name} has no settings control`
    );
  }

  for (const id of ids(/data-l10n-id="([^"]+)"/g, xhtml)) {
    assert.match(prefsFtl, new RegExp(`^${id}\\b`, "m"), `missing preferences string ${id}`);
  }
  for (const id of ["zen-tweaks-group-tabs-menu", "zen-tweaks-unload-tab-menu", "zen-tweaks-group-tabs-none", "zen-tweaks-group-tabs-unavailable"]) {
    assert.match(browserFtl, new RegExp(`^${id}\\b`, "m"));
  }
});

test("css switches are real tweak prefs", () => {
  const yaml = new Set(ids(/^- name: ([^\s]+)/gm, read("prefs/zen/tweaks.yaml")));
  const css = read("src/zen/tweaks/zen-tweaks.css");
  const used = ids(/-moz-pref\("([^"]+)"/g, css);
  assert.ok(used.includes("zen.tweaks.hide-toolbar"));
  for (const pref of used) {
    assert.ok(yaml.has(pref), `css uses unknown pref ${pref}`);
  }
});

test("commands and shortcuts are registered", () => {
  const commands = read("src/browser/base/content/zen-commands.inc.xhtml");
  const keys = read("src/browser/base/content/zen-keysets.inc.xhtml");
  const handlers = read("src/zen/common/zen-sets.js");
  for (const id of [
    "cmd_zenTweaksToggleToolbar",
    "cmd_zenTweaksExtensions",
    "cmd_zenTweaksGroupTabs",
    "cmd_zenTweaksUnloadTab",
  ]) {
    assert.match(commands, new RegExp(`id="${id}"`));
    assert.match(handlers, new RegExp(`${id}:`));
  }
  assert.match(keys, /id="zen-tweaks-toggle-toolbar"/);
  assert.match(keys, /id="zen-tweaks-extensions"/);
  assert.match(read("src/zen/common/ZenPreloadedScripts.js"), /ZenTweaks\.mjs/);
  assert.match(read("src/browser/base/content/zen-assets.inc.xhtml"), /zen-tweaks\.css/);
  assert.match(read("src/browser/base/content/zen-assets.jar.inc.mn"), /zen\/tweaks\/jar\.inc\.mn/);
});
