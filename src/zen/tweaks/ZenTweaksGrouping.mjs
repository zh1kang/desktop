// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

// Group Tabs by Domain, ported from DiaTweaks. The key is the site host with
// a leading "www." removed, not the registrable domain, so mail.google.com
// stays separate from google.com. Internal pages are skipped.

const PUNYCODE_BASE = 36;
const PUNYCODE_TMIN = 1;
const PUNYCODE_TMAX = 26;
const PUNYCODE_SKEW = 38;
const PUNYCODE_DAMP = 700;
const PUNYCODE_INITIAL_BIAS = 72;
const PUNYCODE_INITIAL_N = 128;
const PUNYCODE_DELIMITER = "-";

function adaptPunycodeBias(delta, numPoints, firstTime) {
  delta = firstTime ? Math.floor(delta / PUNYCODE_DAMP) : delta >> 1;
  delta += Math.floor(delta / numPoints);
  let k = 0;
  while (delta > ((PUNYCODE_BASE - PUNYCODE_TMIN) * PUNYCODE_TMAX) >> 1) {
    delta = Math.floor(delta / (PUNYCODE_BASE - PUNYCODE_TMIN));
    k += PUNYCODE_BASE;
  }
  return (
    k +
    Math.floor(
      ((PUNYCODE_BASE - PUNYCODE_TMIN + 1) * delta) / (delta + PUNYCODE_SKEW)
    )
  );
}

function punycodeDigit(code) {
  if (code >= 48 && code <= 57) {
    return code - 22;
  }
  if (code >= 65 && code <= 90) {
    return code - 65;
  }
  if (code >= 97 && code <= 122) {
    return code - 97;
  }
  return PUNYCODE_BASE;
}

function decodePunycode(input) {
  let n = PUNYCODE_INITIAL_N;
  let i = 0;
  let bias = PUNYCODE_INITIAL_BIAS;
  const output = [];
  let basic = input.lastIndexOf(PUNYCODE_DELIMITER);
  if (basic < 0) {
    basic = 0;
  }
  for (let j = 0; j < basic; j++) {
    output.push(input.charCodeAt(j));
  }
  let index = basic > 0 ? basic + 1 : 0;
  while (index < input.length) {
    const oldi = i;
    let w = 1;
    for (let k = PUNYCODE_BASE; ; k += PUNYCODE_BASE) {
      if (index >= input.length) {
        return null;
      }
      const digit = punycodeDigit(input.charCodeAt(index++));
      if (digit >= PUNYCODE_BASE) {
        return null;
      }
      i += digit * w;
      const t =
        k <= bias
          ? PUNYCODE_TMIN
          : k >= bias + PUNYCODE_TMAX
            ? PUNYCODE_TMAX
            : k - bias;
      if (digit < t) {
        break;
      }
      w *= PUNYCODE_BASE - t;
    }
    const outLen = output.length + 1;
    bias = adaptPunycodeBias(i - oldi, outLen, oldi === 0);
    n += Math.floor(i / outLen);
    i %= outLen;
    output.splice(i, 0, n);
    i++;
  }
  return String.fromCodePoint(...output);
}

function decodeLabel(label) {
  if (!label.startsWith("xn--")) {
    return label;
  }
  const decoded = decodePunycode(label.slice(4));
  return decoded ? decoded.toLowerCase() : label;
}

/**
 * Host key for a URL, or null when the page should not be grouped.
 *
 * @param {string} urlString
 * @returns {string|null}
 */
export function domainKey(urlString) {
  let url;
  try {
    url = new URL(urlString);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return null;
  }
  let host = url.hostname.toLowerCase();
  while (host.endsWith(".")) {
    host = host.slice(0, -1);
  }
  if (!host) {
    return null;
  }
  host = host.split(".").map(decodeLabel).join(".");
  if (host.startsWith("www.") && host.length > 4) {
    host = host.slice(4);
  }
  return host || null;
}

/**
 * Decide which loose tabs join a group titled with their host.
 * Tabs already in a differently titled group stay put. A group is created
 * only when at least two of its tabs are not in one yet.
 *
 * @param {{id: string, domain: string}[]} tabs
 * @param {{id: string, label: string, tabIds: string[]}[]} groups
 * @returns {{op: "create", label: string, ids: string[]} | {op: "add", groupId: string, ids: string[]}[]}
 */
export function planGroupOps(tabs, groups) {
  const groupTitleByTab = new Map();
  const homeId = new Map();
  const homeMembers = new Map();
  for (const group of groups) {
    if (!group?.id) {
      continue;
    }
    const title = group.label || "";
    for (const tabId of group.tabIds || []) {
      groupTitleByTab.set(tabId, title);
    }
    if (title && !homeId.has(title)) {
      homeId.set(title, group.id);
      homeMembers.set(title, new Set());
    }
    const members = homeMembers.get(title);
    if (members) {
      for (const tabId of group.tabIds || []) {
        members.add(tabId);
      }
    }
  }

  const pools = new Map();
  for (const tab of tabs) {
    if (!tab?.domain) {
      continue;
    }
    const title = groupTitleByTab.get(tab.id);
    if (title && title !== tab.domain) {
      continue;
    }
    let pool = pools.get(tab.domain);
    if (!pool) {
      pool = [];
      pools.set(tab.domain, pool);
    }
    pool.push(tab);
  }

  const ops = [];
  for (const [domain, pool] of pools) {
    if (pool.length < 2) {
      continue;
    }
    const members = homeMembers.get(domain) || new Set();
    const ids = pool.filter(tab => !members.has(tab.id)).map(tab => tab.id);
    if (!ids.length) {
      continue;
    }
    if (homeId.has(domain)) {
      ops.push({ op: "add", groupId: homeId.get(domain), ids });
    } else if (ids.length >= 2) {
      ops.push({ op: "create", label: domain, ids });
    }
  }
  return ops;
}
