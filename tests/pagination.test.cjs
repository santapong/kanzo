"use strict";
const assert = require("node:assert/strict");
const test = require("node:test");
const { pageWindow, nextAfterPage } = require("../src/pagination.js");

test("empty lists have a valid disabled first page and no inverted range", () => {
  const page = pageWindow(0, 99, 10);
  assert.deepEqual([page.page, page.pageCount, page.from, page.to, page.hasPrevious, page.hasNext], [1, 1, 0, 0, false, false]);
});
test("all pages concatenate without duplicated or missing filtered rows", () => {
  const all = Array.from({ length: 73 }, (_, id) => ({ id, included: id % 2 === 0 }));
  const matching = all.filter((item) => item.included), result = [];
  for (let n = 1; n <= pageWindow(matching.length).pageCount; n++) {
    const page = pageWindow(matching.length, n, 10);
    result.push(...matching.slice(page.start, page.end).map((item) => item.id));
  }
  assert.deepEqual(result, matching.map((item) => item.id));
  assert.equal(new Set(result).size, 37);
});
test("shrink and page-size changes clamp the current page", () => {
  assert.equal(pageWindow(19, 4, 10).page, 2);
  assert.deepEqual([pageWindow(19, 4, 10).from, pageWindow(19, 4, 10).to], [11, 19]);
  assert.equal(pageWindow(19, 4, 25).page, 1);
  assert.equal(pageWindow(100, 0, 50).page, 1);
});
test("unsupported sizes and nonfinite inputs resolve to safe windows", () => {
  assert.equal(pageWindow(11, 1, 10000).pageSize, 10);
  assert.equal(pageWindow(11, NaN, "25").pageSize, 25);
  assert.equal(pageWindow(Infinity, Infinity, Infinity).total, 0);
});
test("bottom drop preserves the unseen page boundary and skips the moving row", () => {
  const items = Array.from({ length: 24 }, (_, i) => ({ id: i + 1 }));
  const first = pageWindow(items.length, 1, 10), last = pageWindow(items.length, 3, 10);
  assert.equal(nextAfterPage(items, first, 3), 11);
  assert.equal(nextAfterPage(items, first, 11), 12);
  assert.equal(nextAfterPage(items, last, 21), null);
});
