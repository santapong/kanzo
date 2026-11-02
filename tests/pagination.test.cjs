"use strict";
const assert = require("node:assert/strict");
const test = require("node:test");
const { pageWindow, nextAfterPage, dropBefore } = require("../src/pagination.js");

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

test("header and footer use page boundaries regardless of clipped card geometry", () => {
  const items = Array.from({ length: 28 }, (_, i) => ({ id: i + 1 })), page = pageWindow(items.length, 2);
  const args = { items, page, movingId: 99, top: 200, bottom: 500,
    cards: items.slice(10, 20).map((item, i) => ({ id: item.id, top: 20 + i * 60, bottom: 80 + i * 60 })) };
  assert.equal(dropBefore({ ...args, y: 180 }), 11);
  assert.equal(dropBefore({ ...args, y: 510 }), 21);
  assert.equal(dropBefore({ ...args, y: 200, movingId: 11 }), 12);
});
test("interior scrolled-list drops retain the next clipped row as successor", () => {
  const items = Array.from({ length: 20 }, (_, i) => ({ id: i + 1 })), page = pageWindow(items.length);
  const cards = [{ id: 1, top: 0, bottom: 100 }, { id: 2, top: 100, bottom: 250 }, { id: 3, top: 250, bottom: 350 }];
  assert.equal(dropBefore({ items, page, movingId: 99, top: 200, bottom: 240, cards, y: 230 }), 3);
});
test("collapsed, empty and last-page destinations append deliberately", () => {
  const items = Array.from({ length: 12 }, (_, i) => ({ id: i + 1 })), page = pageWindow(items.length, 2);
  const args = { items, page, movingId: 99, top: 200, bottom: 500, cards: [], y: 550 };
  assert.equal(dropBefore({ ...args, collapsed: true }), null);
  assert.equal(dropBefore(args), null);
  assert.equal(dropBefore({ ...args, items: [], page: pageWindow(0), y: 100 }), null);
});
test("cross-column footer insertion into a full page reveals the next page", () => {
  const items = Array.from({ length: 24 }, (_, i) => ({ id: i + 1 })), page = pageWindow(items.length, 2);
  const before = dropBefore({ items, page, movingId: 99, top: 200, bottom: 500, cards: [], y: 550 });
  const saved = items.slice(); saved.splice(saved.findIndex((t) => t.id === before), 0, { id: 99 });
  assert.equal(before, 21);
  assert.equal(Math.floor(saved.findIndex((t) => t.id === 99) / page.pageSize) + 1, 3);
  assert.equal(saved.filter((t) => t.id === 99).length, 1);
});
