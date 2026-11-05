// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

import { nsZenDOMOperatedFeature } from "chrome://browser/content/zen-components/ZenCommonUtils.mjs";
import {
  domainKey,
  planGroupOps,
} from "chrome://browser/content/zen-components/ZenTweaksGrouping.mjs";

const PREF_HIDE_TOOLBAR = "zen.tweaks.hide-toolbar";
const PREF_REVEAL_ON_HOVER = "zen.tweaks.reveal-toolbar-on-hover";
const PREF_SHOW_WITH_SIDEBAR = "zen.tweaks.show-toolbar-with-sidebar";
const PREF_SHOW_ON_NEW_TAB = "zen.tweaks.show-toolbar-on-new-tab";
const PREF_SHOW_ON_COPY = "zen.tweaks.show-toolbar-on-copy";
const PREF_TOGGLE_TOOLBAR = "zen.tweaks.toggle-toolbar";
const PREF_QUIET_DOWNLOADS = "zen.tweaks.quiet-downloads";
const PREF_HIDE_HISTORY = "zen.tweaks.hide-history-suggestions";
const PREF_HIDE_LOGO = "zen.tweaks.hide-newtab-logo";
const PREF_HIDE_PERSONALIZE = "zen.tweaks.hide-personalize-button";
const PREF_GROUP_TABS = "zen.tweaks.group-tabs-by-domain";
const PREF_UNLOAD_TAB = "zen.tweaks.unload-tab";
const PREF_CLOSE_FROM_SWITCHER = "zen.tweaks.close-from-tab-switcher";
const PREF_IGNORE_PENDING = "zen.tabs.ctrl-tab.ignore-pending-tabs";

const DOWNLOADS_PREF = "browser.download.alwaysOpenPanel";
const HISTORY_PREF = "browser.urlbar.suggest.history";
const LOGO_PREF = "browser.newtabpage.activity-stream.logowordmark.visibility";

const NEW_TAB_LOGO_CSS =
  ".logo-and-wordmark, .logo, .wordmark { display: none !important; }";
const NEW_TAB_PERSONALIZE_CSS =
  ".personalize-button, .customize-button { display: none !important; }";

const TWEAK_PREFS = [
  PREF_HIDE_TOOLBAR,
  PREF_REVEAL_ON_HOVER,
  PREF_SHOW_WITH_SIDEBAR,
  PREF_SHOW_ON_NEW_TAB,
  PREF_SHOW_ON_COPY,
  PREF_TOGGLE_TOOLBAR,
  PREF_QUIET_DOWNLOADS,
  PREF_HIDE_HISTORY,
  PREF_HIDE_LOGO,
  PREF_HIDE_PERSONALIZE,
  PREF_GROUP_TABS,
  PREF_UNLOAD_TAB,
  PREF_CLOSE_FROM_SWITCHER,
  PREF_IGNORE_PENDING,
];

function boolPref(name, fallback = false) {
  return Services.prefs.getBoolPref(name, fallback);
}

function newtabSheet(css) {
  return `@-moz-document url-prefix("about:newtab"), url-prefix("about:home") { ${css} }`;
}

const NEW_TAB_SHEETS = [
  newtabSheet(NEW_TAB_LOGO_CSS),
  newtabSheet(NEW_TAB_PERSONALIZE_CSS),
  newtabSheet(`${NEW_TAB_LOGO_CSS} ${NEW_TAB_PERSONALIZE_CSS}`),
];

/**
 * Runtime half of Zen's DiaTweaks port. Visual switches live in
 * zen-tweaks.css; this applies the ones that have to change prefs,
 * menus, or tab groups.
 */
class nsZenTweaks extends nsZenDOMOperatedFeature {
  #hovering = false;
  #copyFlash = false;
  #copyTimer = 0;
  #undo = null;

  init() {
    this.#installMenus();
    this.#installListeners();
    this.#syncExternalPrefs();
    this.#syncNewTabSheet();
    this.updateToolbar();
  }

  #installListeners() {
    for (const pref of TWEAK_PREFS) {
      Services.prefs.addObserver(pref, this);
    }
    Services.obs.addObserver(this, "browser-delayed-startup-finished");
    window.addEventListener("unload", () => this.#shutdown(), { once: true });
    window.addEventListener("mousemove", event => this.#onMouseMove(event));
    window.addEventListener("mouseout", event => this.#onMouseOut(event));
    window.addEventListener("keydown", event => this.#onKeyDown(event), true);
    gBrowser.tabContainer.addEventListener("TabSelect", () =>
      this.updateToolbar()
    );
    gBrowser.addTabsProgressListener(this);
    document.addEventListener("command", event => this.#onCommand(event), true);
    document.addEventListener("popupshowing", event => {
      if (event.target.id == "tabContextMenu") {
        this.#syncMenuItems();
      }
      if (event.target.parentElement?.id == "zen-spaces-menubar") {
        this.#installSpacesMenuItem();
      }
    });
    document.addEventListener("popupshown", event => {
      if (event.target.id == "ctrlTab-panel") {
        this.#hideSleepingPreviews();
      }
    });
    new MutationObserver(() => this.updateToolbar()).observe(
      document.documentElement,
      {
        attributes: true,
        attributeFilter: [
          "zen-sidebar-expanded",
          "zen-has-empty-tab",
          "zen-single-toolbar",
        ],
      }
    );
  }

  #shutdown() {
    for (const pref of TWEAK_PREFS) {
      Services.prefs.removeObserver(pref, this);
    }
    try {
      Services.obs.removeObserver(this, "browser-delayed-startup-finished");
    } catch (e) {}
    gBrowser.removeTabsProgressListener(this);
    clearTimeout(this.#copyTimer);
  }

  observe(subject, topic, data) {
    if (topic == "nsPref:changed") {
      this.#onPrefChanged(data);
      return;
    }
    if (
      topic == "browser-delayed-startup-finished" &&
      subject === window
    ) {
      Services.obs.removeObserver(this, topic);
      this.#installSpacesMenuItem();
      this.updateToolbar();
    }
  }

  onLocationChange(browser) {
    if (browser == gBrowser.selectedBrowser) {
      this.updateToolbar();
    }
  }

  #onPrefChanged(pref) {
    if (
      pref == PREF_QUIET_DOWNLOADS ||
      pref == PREF_HIDE_HISTORY ||
      pref == PREF_HIDE_LOGO
    ) {
      this.#syncExternalPrefs();
    }
    if (pref == PREF_HIDE_LOGO || pref == PREF_HIDE_PERSONALIZE) {
      this.#syncNewTabSheet();
    }
    if (pref == PREF_GROUP_TABS || pref == PREF_UNLOAD_TAB) {
      this.#syncMenuItems();
    }
    this.updateToolbar();
  }

  #onCommand(event) {
    const id = event.target.id;
    if (
      id != "cmd_zenCopyCurrentURL" &&
      id != "cmd_zenCopyCurrentURLMarkdown"
    ) {
      return;
    }
    if (!boolPref(PREF_SHOW_ON_COPY) || !boolPref(PREF_HIDE_TOOLBAR)) {
      return;
    }
    this.#copyFlash = true;
    this.updateToolbar();
    clearTimeout(this.#copyTimer);
    this.#copyTimer = setTimeout(() => {
      this.#copyFlash = false;
      this.updateToolbar();
    }, 1200);
  }

  #onMouseMove(event) {
    if (!boolPref(PREF_HIDE_TOOLBAR) || !boolPref(PREF_REVEAL_ON_HOVER)) {
      if (this.#hovering) {
        this.#hovering = false;
        this.updateToolbar();
      }
      return;
    }
    const hovering = this.#pointerInRevealZone(event);
    if (hovering != this.#hovering) {
      this.#hovering = hovering;
      this.updateToolbar();
    }
  }

  #onMouseOut(event) {
    if (event.relatedTarget) {
      return;
    }
    if (this.#hovering) {
      this.#hovering = false;
      this.updateToolbar();
    }
  }

  #pointerInRevealZone(event) {
    const single = document.documentElement.hasAttribute("zen-single-toolbar");
    const anchor = document.getElementById(
      single ? "navigator-toolbox" : "zen-appcontent-navbar-wrapper"
    );
    if (!anchor) {
      return false;
    }
    const rect = anchor.getBoundingClientRect();
    const nav = document.getElementById("nav-bar")?.getBoundingClientRect();
    const overNav =
      nav &&
      nav.height > 8 &&
      event.clientX >= nav.left &&
      event.clientX <= nav.right &&
      event.clientY >= nav.top - 4 &&
      event.clientY <= nav.bottom + 8;
    const overStrip =
      event.clientX >= rect.left &&
      event.clientX <= rect.right &&
      event.clientY >= rect.top - 4 &&
      event.clientY <= rect.top + 14;
    return overNav || overStrip;
  }

  #onNewTabPage() {
    if (document.documentElement.getAttribute("zen-has-empty-tab") == "true") {
      return true;
    }
    let spec = "";
    try {
      spec = gBrowser.currentURI?.spec || "";
    } catch (e) {}
    return (
      spec == "about:newtab" ||
      spec == "about:home" ||
      spec.startsWith("about:newtab?")
    );
  }

  updateToolbar() {
    const hide = boolPref(PREF_HIDE_TOOLBAR);
    let show = !hide;
    if (hide) {
      show =
        this.#copyFlash ||
        (this.#hovering && boolPref(PREF_REVEAL_ON_HOVER)) ||
        (boolPref(PREF_SHOW_WITH_SIDEBAR) &&
          document.documentElement.hasAttribute("zen-sidebar-expanded")) ||
        (boolPref(PREF_SHOW_ON_NEW_TAB) && this.#onNewTabPage());
    }
    document.documentElement.toggleAttribute(
      "zen-tweaks-toolbar-revealed",
      show
    );
  }

  toggleToolbar() {
    // The shortcut stays useful after it shows the bar again, so it is its
    // own switch rather than a child that turns off with the toolbar.
    if (!boolPref(PREF_TOGGLE_TOOLBAR)) {
      return;
    }
    Services.prefs.setBoolPref(PREF_HIDE_TOOLBAR, !boolPref(PREF_HIDE_TOOLBAR));
  }

  openExtensions() {
    if (!boolPref("zen.tweaks.extensions-shortcut")) {
      return;
    }
    gUnifiedExtensions?.togglePanel();
  }

  #installMenus() {
    const context = document.getElementById("tabContextMenu");
    if (context && !document.getElementById("context_zenTweaksGroupTabs")) {
      const fragment = window.MozXULElement.parseXULToFragment(`
        <menuseparator id="context_zenTweaksSeparator"/>
        <menuitem id="context_zenTweaksGroupTabs"
                  data-l10n-id="zen-tweaks-group-tabs-menu"
                  command="cmd_zenTweaksGroupTabs"/>
        <menuitem id="context_zenTweaksUnloadTab"
                  data-l10n-id="zen-tweaks-unload-tab-menu"
                  command="cmd_zenTweaksUnloadTab"/>
      `);
      const anchor =
        document.getElementById("context_closeTab") ||
        document.getElementById("context_pinTab");
      if (anchor) {
        anchor.after(fragment);
      } else {
        context.append(fragment);
      }
    }
    this.#syncMenuItems();
    this.#installSpacesMenuItem();
  }

  #installSpacesMenuItem() {
    const popup = document
      .getElementById("zen-spaces-menubar")
      ?.querySelector("menupopup");
    if (!popup || document.getElementById("menu_zenTweaksGroupTabs")) {
      return;
    }
    popup.append(
      window.MozXULElement.parseXULToFragment(`
        <menuseparator id="menu_zenTweaksSeparator"/>
        <menuitem id="menu_zenTweaksGroupTabs"
                  data-l10n-id="zen-tweaks-group-tabs-menu"
                  command="cmd_zenTweaksGroupTabs"/>
      `)
    );
    this.#syncMenuItems();
  }

  #syncMenuItems() {
    const group = boolPref(PREF_GROUP_TABS, true);
    const unload = boolPref(PREF_UNLOAD_TAB);
    for (const id of ["context_zenTweaksGroupTabs", "menu_zenTweaksGroupTabs"]) {
      document.getElementById(id)?.toggleAttribute("hidden", !group);
    }
    document
      .getElementById("context_zenTweaksUnloadTab")
      ?.toggleAttribute("hidden", !unload);
    const separator = document.getElementById("context_zenTweaksSeparator");
    separator?.toggleAttribute("hidden", !group && !unload);
    document
      .getElementById("menu_zenTweaksSeparator")
      ?.toggleAttribute("hidden", !group);
  }

  #contextTab() {
    const menu = document.getElementById("tabContextMenu");
    if (menu?.state == "open" && window.TabContextMenu?.contextTab) {
      return TabContextMenu.contextTab;
    }
    return gBrowser.selectedTab;
  }

  unloadContextTab() {
    if (!boolPref(PREF_UNLOAD_TAB)) {
      return;
    }
    const tab = this.#contextTab();
    if (!tab || tab.hasAttribute("zen-empty-tab")) {
      return;
    }
    Promise.resolve(gBrowser.explicitUnloadTabs([tab])).catch(error => {
      console.error("ZenTweaks: unload failed", error);
    });
  }

  #onKeyDown(event) {
    if (this.#consumeUndo(event)) {
      return;
    }
    if (!boolPref(PREF_CLOSE_FROM_SWITCHER)) {
      return;
    }
    const panel = document.getElementById("ctrlTab-panel");
    if (!panel || panel.state != "open") {
      return;
    }
    // Ctrl-Tab keeps Control down. W and ⌘W both close; ⌘W alone would
    // close the window, so Control has to be part of the chord.
    if (
      !event.ctrlKey ||
      event.key.toLowerCase() != "w" ||
      event.altKey ||
      event.shiftKey ||
      event.repeat
    ) {
      return;
    }
    const tab = this.#ctrlTabSelected();
    if (!tab) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    gBrowser.removeTab(tab);
  }

  // The next real key undoes a grouping, or forgets it. Modifier keys are
  // ignored so Command-Z still arrives as one chord.
  #consumeUndo(event) {
    if (!this.#undo || event.repeat) {
      return false;
    }
    if (
      event.key == "Meta" ||
      event.key == "Control" ||
      event.key == "Shift" ||
      event.key == "Alt"
    ) {
      return false;
    }
    const accel =
      AppConstants.platform == "macosx" ? event.metaKey : event.ctrlKey;
    const entries = this.#undo;
    this.#undo = null;
    if (
      event.key.toLowerCase() != "z" ||
      !accel ||
      event.shiftKey ||
      event.altKey
    ) {
      return false;
    }
    event.preventDefault();
    event.stopPropagation();
    for (const { tab, previousGroup } of entries) {
      if (!tab.isConnected) {
        continue;
      }
      if (previousGroup?.isConnected) {
        previousGroup.addTabs?.([tab]);
      } else if (tab.group) {
        gBrowser.ungroupTab(tab);
      }
    }
    return true;
  }

  #ctrlTabSelected() {
    if (typeof ctrlTab == "undefined") {
      return null;
    }
    const selected = ctrlTab.selected;
    return selected?.tab || selected || null;
  }

  #hideSleepingPreviews() {
    if (!boolPref(PREF_IGNORE_PENDING)) {
      return;
    }
    const panel = document.getElementById("ctrlTab-panel");
    for (const preview of panel?.querySelectorAll(".ctrlTab-preview") || []) {
      const tab = preview.tab || preview._tab;
      if (tab?.hasAttribute("pending")) {
        preview.hidden = true;
      }
    }
  }

  #tabKey(tab) {
    return tab.linkedPanel || tab.id;
  }

  #eligibleTabs() {
    const workspace = gZenWorkspaces?.activeWorkspace;
    const tabs = [];
    for (const tab of gBrowser.tabs) {
      if (
        tab.pinned ||
        tab.hasAttribute("zen-essential") ||
        tab.hasAttribute("zen-empty-tab")
      ) {
        continue;
      }
      const workspaceId = tab.getAttribute("zen-workspace-id");
      if (workspace && workspaceId && workspaceId != workspace) {
        continue;
      }
      if (tab.group?.hasAttribute("split-view-group") || tab.group?.isZenFolder) {
        continue;
      }
      let spec = "";
      try {
        spec = tab.linkedBrowser?.currentURI?.spec || "";
      } catch (e) {}
      const domain = domainKey(spec);
      if (!domain) {
        continue;
      }
      tabs.push({ id: this.#tabKey(tab), domain, tab });
    }
    return tabs;
  }

  groupTabsByDomain() {
    if (!boolPref(PREF_GROUP_TABS, true)) {
      return;
    }
    if (typeof gBrowser.addTabGroup != "function") {
      gZenUIManager?.showToast("zen-tweaks-group-tabs-unavailable");
      return;
    }
    const tabs = this.#eligibleTabs();
    const byId = new Map(tabs.map(entry => [entry.id, entry.tab]));
    const groups = [];
    for (const group of gBrowser.tabGroups || []) {
      if (group.isZenFolder || group.hasAttribute?.("split-view-group")) {
        continue;
      }
      groups.push({
        id: group.id,
        label: group.label || "",
        tabIds: [...group.tabs].map(tab => this.#tabKey(tab)),
      });
    }
    const ops = planGroupOps(tabs, groups);
    if (!ops.length) {
      gZenUIManager?.showToast("zen-tweaks-group-tabs-none");
      return;
    }
    const undo = [];
    try {
      for (const op of ops) {
        const opTabs = op.ids.map(id => byId.get(id)).filter(Boolean);
        for (const tab of opTabs) {
          undo.push({ tab, previousGroup: tab.group || null });
        }
        if (op.op == "create") {
          gBrowser.addTabGroup(opTabs, {
            label: op.label,
            insertBefore: opTabs[0],
          });
        } else {
          const group = [...gBrowser.tabGroups].find(
            candidate => candidate.id == op.groupId
          );
          group?.addTabs(opTabs);
        }
      }
    } catch (error) {
      console.error("ZenTweaks: group tabs failed", error);
      if (undo.length) {
        this.#undo = undo;
      }
      gZenUIManager?.showToast("zen-tweaks-group-tabs-unavailable");
      return;
    }
    this.#undo = undo;
  }

  #remember(stashPref, read) {
    if (!Services.prefs.prefHasUserValue(stashPref)) {
      Services.prefs.setStringPref(stashPref, read());
    }
  }

  #restore(stashPref, write) {
    if (!Services.prefs.prefHasUserValue(stashPref)) {
      return;
    }
    write(Services.prefs.getStringPref(stashPref));
    Services.prefs.clearUserPref(stashPref);
  }

  #syncExternalPrefs() {
    this.#syncBoolMirror(PREF_QUIET_DOWNLOADS, DOWNLOADS_PREF, false);
    this.#syncBoolMirror(PREF_HIDE_HISTORY, HISTORY_PREF, false);
    const stash = `${PREF_HIDE_LOGO}.previous`;
    if (boolPref(PREF_HIDE_LOGO)) {
      this.#remember(stash, () =>
        Services.prefs.getStringPref(LOGO_PREF, "always")
      );
      Services.prefs.setStringPref(LOGO_PREF, "never");
    } else {
      this.#restore(stash, value => Services.prefs.setStringPref(LOGO_PREF, value));
    }
  }

  #syncBoolMirror(tweakPref, targetPref, valueWhenOn) {
    const stash = `${tweakPref}.previous`;
    if (boolPref(tweakPref)) {
      this.#remember(stash, () =>
        String(Services.prefs.getBoolPref(targetPref, !valueWhenOn))
      );
      Services.prefs.setBoolPref(targetPref, valueWhenOn);
    } else {
      this.#restore(stash, value =>
        Services.prefs.setBoolPref(targetPref, value == "true")
      );
    }
  }

  #syncNewTabSheet() {
    const rules = [];
    if (boolPref(PREF_HIDE_LOGO)) {
      rules.push(NEW_TAB_LOGO_CSS);
    }
    if (boolPref(PREF_HIDE_PERSONALIZE)) {
      rules.push(NEW_TAB_PERSONALIZE_CSS);
    }
    const wanted = rules.length ? newtabSheet(rules.join(" ")) : null;
    const sss = Cc["@mozilla.org/content/style-sheet-service;1"].getService(
      Ci.nsIStyleSheetService
    );
    for (const css of NEW_TAB_SHEETS) {
      const uri = Services.io.newURI(
        `data:text/css;charset=utf-8,${encodeURIComponent(css)}`
      );
      const registered = sss.sheetRegistered(uri, sss.USER_SHEET);
      if (css == wanted && !registered) {
        sss.loadAndRegisterSheet(uri, sss.USER_SHEET);
      } else if (css != wanted && registered) {
        sss.unregisterSheet(uri, sss.USER_SHEET);
      }
    }
  }
}

window.gZenTweaks = new nsZenTweaks();
