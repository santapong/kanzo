// Pure rendering windows. Complete board records remain the source for relationships and totals.
"use strict";

(() => {
  function pageWindow(total, requestedPage = 1, requestedSize = 10) {
    const finiteInteger = (value, fallback) => Number.isFinite(Number(value)) ? Math.floor(Number(value)) : fallback;
    total = Math.max(0, finiteInteger(total, 0));
    const size = finiteInteger(requestedSize, 10);
    const pageSize = [10, 25, 50].includes(size) ? size : 10;
    const pageCount = Math.max(1, Math.ceil(total / pageSize));
    const page = Math.min(pageCount, Math.max(1, finiteInteger(requestedPage, 1)));
    const start = (page - 1) * pageSize, end = Math.min(total, start + pageSize);
    return { total, page, pageSize, pageCount, start, end, from: total ? start + 1 : 0, to: end,
      hasPrevious: page > 1, hasNext: page < pageCount };
  }

  // A bottom drop on a partial page belongs before the first unseen task, not
  // at the end of the entire column. Ignore the moving task if it is that row.
  function nextAfterPage(items, window, movingId) {
    return items.slice(window.end).find((item) => item.id !== movingId)?.id ?? null;
  }

  // Header/footer targets refer to the complete rendered page even when its
  // list is scrolled. Interior coordinates keep clipped next rows as anchors.
  function dropBefore({ items, page, movingId, collapsed, y, top, bottom, cards }) {
    if (collapsed) return null;
    const next = nextAfterPage(items, page, movingId);
    if (y <= top) return items.slice(page.start, page.end).find((item) => item.id !== movingId)?.id ?? next;
    if (y >= bottom) return next;
    return cards.find((card) => card.id !== movingId && y < (card.top + card.bottom) / 2)?.id ?? next;
  }

  const api = Object.freeze({ pageWindow, nextAfterPage, dropBefore });
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (typeof window !== "undefined") window.KanzoPagination = api;
})();
