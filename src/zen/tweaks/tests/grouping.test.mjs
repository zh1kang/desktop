// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

import assert from "node:assert/strict";
import test from "node:test";

import {
  domainKey,
  planGroupOps,
} from "../ZenTweaksGrouping.mjs";

test("domain keys drop www and skip internal pages", () => {
  assert.equal(domainKey("https://www.example.com/a"), "example.com");
  assert.equal(domainKey("https://WWW.Example.com."), "example.com");
  assert.equal(domainKey("https://mail.google.com/mail"), "mail.google.com");
  assert.equal(domainKey("http://example.com"), "example.com");
  assert.equal(domainKey("https://xn--n3h.com/"), "☃.com");
  assert.equal(domainKey("about:newtab"), null);
  assert.equal(domainKey("about:blank"), null);
  assert.equal(domainKey("chrome://browser/content/browser.xhtml"), null);
  assert.equal(domainKey("file:///tmp/a.html"), null);
  assert.equal(domainKey(""), null);
  assert.equal(domainKey("not a url"), null);
});

test("two loose tabs on one site become a group", () => {
  assert.deepEqual(
    planGroupOps(
      [
        { id: "1", domain: "example.com" },
        { id: "2", domain: "example.com" },
        { id: "3", domain: "other.test" },
      ],
      []
    ),
    [{ op: "create", label: "example.com", ids: ["1", "2"] }]
  );
});

test("a single extra tab joins the group already titled with that site", () => {
  assert.deepEqual(
    planGroupOps(
      [
        { id: "1", domain: "example.com" },
        { id: "2", domain: "example.com" },
      ],
      [{ id: "g1", label: "example.com", tabIds: ["1"] }]
    ),
    [{ op: "add", groupId: "g1", ids: ["2"] }]
  );
});

test("tabs in a differently named group stay put", () => {
  assert.deepEqual(
    planGroupOps(
      [
        { id: "1", domain: "example.com" },
        { id: "2", domain: "example.com" },
      ],
      [{ id: "g1", label: "Reading", tabIds: ["1"] }]
    ),
    []
  );
});

test("a site that is already fully grouped is left alone", () => {
  assert.deepEqual(
    planGroupOps(
      [
        { id: "1", domain: "example.com" },
        { id: "2", domain: "example.com" },
      ],
      [{ id: "g1", label: "example.com", tabIds: ["1", "2"] }]
    ),
    []
  );
});
