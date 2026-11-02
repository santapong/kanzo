// The Kanzo board. Plain JavaScript, no build step; served at /app.js.
"use strict";

// The board runs on browsers back to Safari 13.1, Chrome 80 and Firefox 78. These
// two are newer than that, and are all it needs on top.
if (!Element.prototype.replaceChildren) {
  Element.prototype.replaceChildren = function (...nodes) {
    this.textContent = "";
    this.append(...nodes);
  };
}
if (!HTMLFormElement.prototype.requestSubmit) {
  HTMLFormElement.prototype.requestSubmit = function () {
    if (this.reportValidity()) this.dispatchEvent(new Event("submit", { cancelable: true }));
  };
}

const $ = (sel, root = document) => root.querySelector(sel);
const STATUS_COLORS = ["#8a8a83", "#3b82f6", "#e8a317", "#2f9e44", "#ae3ec9", "#e8590c"];

const state = {
  project: "@dashboard", // project slug or @dashboard/all/@review/@archive
  scope: "active",
  harness: { profiles: {}, plans: {}, time_entries: [], events: [] },
  statusFilter: "",
  taskQuery: "",
  tagFilter: "",
  ownerFilter: "",
  scheduleFilter: "",
  filtersExpanded: false,
  unscheduledExpanded: false,
  weekOffset: 0,
  monthOffset: 0,
  taskTab: "overview",
  typeFilter: "",
  projectQuery: "",
  board: null,           // last /api/board reply
  changes: null,         // change counter seen last
  task: null,            // open task id
  dragging: null,        // id of the card being dragged
  dropped: false,        // the current drag ended in a drop
  layout: "",            // key of the rendered column layout
  allDone: false,        // show every card in the done column
  menu: null,            // slug of the project whose "⋯" menu is open, or "settings"
};
const acceptanceDrafts = new Map();
const paginationPages = new Map(), paginationSizes = new Map();
let paginationSignature = "";

function paginationWindow(name, items) {
  const signature = JSON.stringify([state.project, state.scope, state.projectQuery, state.taskQuery,
    state.statusFilter, state.typeFilter, state.tagFilter, state.ownerFilter, state.scheduleFilter,
    state.weekOffset, state.monthOffset]);
  if (signature !== paginationSignature) { paginationPages.clear(); paginationSignature = signature; }
  const key = `${state.project}:${state.scope}:${name}`;
  const page = window.KanzoPagination.pageWindow(items.length, paginationPages.get(key) || 1, paginationSizes.get(key) || 10);
  paginationPages.set(key, page.page);
  return { ...page, key, items: items.slice(page.start, page.end) };
}

function changePage(page, value, action, size) {
  paginationPages.set(page.key, value);
  if (size) { paginationSizes.set(page.key, size); paginationPages.set(page.key, 1); }
  render();
  const nav = document.querySelector(`.pagination[data-page-key="${CSS.escape(page.key)}"]`);
  const cards = nav?.closest(".column")?.querySelector(".cards");
  if (cards) cards.scrollTop = 0;
  else nav?.scrollIntoView({ block: "nearest", inline: "nearest" });
  const target = nav?.querySelector(`[data-page-action="${action}"]:not(:disabled)`) || nav?.querySelector("select");
  target?.focus({ preventScroll: true });
}

function renderPager(page, label) {
  const summary = `${page.from}–${page.to} of ${page.total}`;
  const sizes = el("select", { class: "pagination-size", "aria-label": `${label} items per page`,
    onchange: (event) => changePage(page, 1, "size", Number(event.target.value)) },
    ...[10, 25, 50].map((size) => el("option", { value: size }, `${size} per page`)));
  sizes.value = String(page.pageSize);
  return el("nav", { class: "pagination", "aria-label": `${label} pagination`, "data-page-key": page.key },
    el("span", { class: "pagination-summary", role: "status" }, summary),
    el("div", { class: "pagination-controls" },
      el("button", { class: "btn quiet", "data-page-action": "previous", disabled: !page.hasPrevious,
        "aria-label": `Previous ${label} page`, onclick: () => changePage(page, page.page - 1, "previous") }, "Previous"),
      el("span", { class: "pagination-page" }, `Page ${page.page} of ${page.pageCount}`),
      el("button", { class: "btn quiet", "data-page-action": "next", disabled: !page.hasNext,
        "aria-label": `Next ${label} page`, onclick: () => changePage(page, page.page + 1, "next") }, "Next"), sizes));
}

// ---------- helpers ----------

async function api(method, path, body) {
  const res = await fetch("/api" + path, {
    method,
    headers: body ? { "Content-Type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || res.statusText);
  return data;
}

function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k.startsWith("on")) node.addEventListener(k.slice(2), v);
    else if (k === "class") node.className = v;
    else node.setAttribute(k, v === true ? "" : v);
  }
  node.append(...children.flat().filter((c) => c != null && c !== false));
  return node;
}

// Line icons (from Lucide, ISC licence), drawn in the text colour.
const ICONS = {
  newProject: '<path d="M12 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.4 2.6a2.1 2.1 0 0 1 3 3L12 15l-4 1 1-4Z"/>',
  board: '<rect width="18" height="18" x="3" y="3" rx="2"/><path d="M8 7v7M12 7v4M16 7v9"/>',
  folder: '<path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  close: '<path d="M18 6 6 18M6 6l12 12"/>',
  more: '<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>',
  plus: '<path d="M5 12h14M12 5v14"/>',
  trash: '<path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6M10 11v6M14 11v6"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  human: '<circle cx="12" cy="8" r="4"/><path d="M5 21v-1a6 6 0 0 1 6-6h2a6 6 0 0 1 6 6v1"/>',
  github: '<path d="M15 22v-4a4.8 4.8 0 0 0-1-3.5c3 0 6-2 6-5.5.1-1.3-.3-2.5-1-3.5.3-1.2.3-2.4 0-3.5 0 0-1 0-3 1.5a12 12 0 0 0-8 0C6 2 5 2 5 2c-.3 1.2-.3 2.4 0 3.5A5.4 5.4 0 0 0 4 9c0 3.5 3 5.5 6 5.5-.4.5-.7 1-.8 1.7-.2.6-.3 1.2-.2 1.8v4"/><path d="M9 18c-4.5 2-5-2-7-2"/>',
  sync: '<path d="M12 13v8"/><path d="M4 14.9A7 7 0 1 1 15.7 8h1.8a4.5 4.5 0 0 1 2.5 8.2"/><path d="m8 17 4-4 4 4"/>',
  collapse: '<path d="m13 17 5-5-5-5M6 17l5-5-5-5"/>',
  expand: '<path d="m11 17-5-5 5-5M18 17l-5-5 5-5"/>',
  rename: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/>',
  update: '<circle cx="12" cy="12" r="9"/><path d="M12 7v9M8 12l4 4 4-4"/>',
  settings: '<path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/>',
  send: '<path d="M12 19V5M5 12l7-7 7 7"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 16v-4M12 8h.01"/>',
  home: '<path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1h-5v-8H9v8H4a1 1 0 0 1-1-1Z"/>',
  list: '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>',
  timeline: '<path d="M3 5h18M7 9h10M4 13h8M12 17h8M3 3v18"/>',
  calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 11h18"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  archive: '<rect x="3" y="4" width="18" height="4" rx="1"/><path d="M5 8v12h14V8M10 12h4"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.5 1.5M17.5 17.5 19 19M5 19l1.5-1.5M17.5 6.5 19 5"/>',
  menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
  play: '<path d="m8 4 12 8-12 8Z"/>',
  stop: '<rect x="5" y="5" width="14" height="14" rx="1"/>',
  book: '<path d="M12 6v15M3 4c4-1 7 0 9 2 2-2 5-3 9-2v15c-4-1-7 0-9 2-2-2-5-3-9-2Z"/>',
  arrow: '<path d="m9 5 7 7-7 7"/>',
};

function icon(name, color) {
  const span = el("span", { class: "icon", style: color ? `color:${color}` : null });
  span.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name]}</svg>`;
  return span;
}

document.querySelectorAll("[data-icon]").forEach((n) => n.replaceWith(icon(n.dataset.icon)));

let toastTimer;
// Copies a task's key, like api#12, to paste to an agent. The clipboard API needs a
// secure page; a board opened from another device over plain HTTP falls back.
async function copyKey(text) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const area = el("textarea", { style: "position:fixed;opacity:0" });
    area.value = text;
    document.body.append(area);
    area.select();
    document.execCommand("copy");
    area.remove();
  }
  toast(`Copied ${text}`);
}

function toast(message) {
  document.querySelector(".toast")?.remove();
  const t = el("div", { class: "toast" }, message);
  document.body.append(t);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.remove(), 3500);
}

// The colours a project can be given; the names match PROJECT_COLORS in store.rs.
const PROJECT_COLORS = {
  gray: "#8e8e93", red: "#ef4444", orange: "#f97316", yellow: "#eab308", green: "#22c55e",
  teal: "#14b8a6", blue: "#3b82f6", purple: "#a855f7", pink: "#ec4899",
};

// The colour picked for a project, or until then one chosen from its slug.
function projectColorName(slug) {
  const picked = state.board?.projects.find((p) => p.slug === slug)?.color;
  if (PROJECT_COLORS[picked]) return picked;
  const names = Object.keys(PROJECT_COLORS).filter((n) => n !== "gray");
  let h = 0;
  for (const c of slug) h = (h * 31 + c.charCodeAt(0)) % 997;
  return names[h % names.length];
}

function projectColor(slug) {
  return PROJECT_COLORS[projectColorName(slug)];
}

// How many columns a status is past todo: -1 for backlog, and 0 for a status the board
// doesn't know.
function statusStep(status) {
  const { statuses } = state.board;
  const i = statuses.indexOf(status);
  return i < 0 ? 0 : i - statuses.indexOf("todo");
}

function statusColor(status) {
  const i = state.board ? statusStep(status) : 0;
  return STATUS_COLORS[Math.max(i, 0) % STATUS_COLORS.length];
}

// A column's status as a small progress circle, as in Linear: dashed for backlog, empty
// for todo, filling up across the board, a check for done. A shape, so it can't be taken
// for a project's colour dot.
function statusIcon(status) {
  const step = statusStep(status), steps = statusStep("done");
  const f = Math.max(step, 0) / steps;
  const color = statusColor(status);
  const dash = step < 0 ? ' stroke-dasharray="2.36 2.36"' : "";
  let inside = "";
  if (f >= 1) {
    inside = `<circle cx="7" cy="7" r="6" fill="${color}"/>` +
      '<path d="m4.4 7.2 1.8 1.8 3.4-3.6" fill="none" stroke="var(--bg)" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>';
  } else if (f > 0) {
    const r = 3.4, a = f * 2 * Math.PI;
    const x = (7 + r * Math.sin(a)).toFixed(2), y = (7 - r * Math.cos(a)).toFixed(2);
    inside = `<path d="M7 7L7 ${7 - r}A${r} ${r} 0 ${f > 0.5 ? 1 : 0} 1 ${x} ${y}Z" fill="${color}"/>`;
  }
  const span = el("span", { class: "status-icon" });
  span.innerHTML = `<svg viewBox="0 0 14 14" aria-hidden="true"><circle cx="7" cy="7" r="6" fill="none" stroke="${color}" stroke-width="1.5"${dash}/>${inside}</svg>`;
  return span;
}

const key = (t) => `${t.project}#${t.id}`;

function parseTime(ts) {
  return new Date(ts.replace(" ", "T"));
}

function ago(ts) {
  const s = (Date.now() - parseTime(ts)) / 1000;
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 86400 * 7) return `${Math.floor(s / 86400)}d ago`;
  return parseTime(ts).toLocaleDateString();
}

function timeEl(ts) {
  return el("time", { datetime: ts, title: parseTime(ts).toLocaleString() }, ago(ts));
}

// ---------- Markdown (small, escapes everything first) ----------

function escapeHtml(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// Code spans, links and bare URLs are swapped for placeholders as soon as they are
// rendered, so later rules never see, or rewrite, the HTML they produced. The input
// is already HTML-escaped, so it holds no tags or raw quotes of its own.
function inline(s) {
  const saved = [];
  const keep = (html) => `\u0000${saved.push(html) - 1}\u0000`;
  const link = (url, text) => keep(`<a href="${url}" target="_blank" rel="noopener">${text}</a>`);
  s = s
    .replace(/\u0000/g, "")
    .replace(/`([^`]+)`/g, (_, code) => keep(`<code>${code}</code>`))
    .replace(/\[([^\]]+)\]\(((?:https?:\/\/|mailto:)[^\s)\u0000]+)\)/g, (_, text, url) => link(url, emphasis(text)))
    .replace(/(^|[\s(])(https?:\/\/[^\s)\u0000]+)/g, (_, before, url) => before + link(url, url));
  const restore = (html) => html.replace(/\u0000(\d+)\u0000/g, (_, i) => restore(saved[i]));
  return restore(emphasis(s));
}

function emphasis(s) {
  return s
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[^\w*])\*(?!\s)(.+?)\*(?!\w)/g, "$1<em>$2</em>")
    .replace(/(^|[^\w])_(?!\s)(.+?)_(?!\w)/g, "$1<em>$2</em>")
    .replace(/~~(.+?)~~/g, "<del>$1</del>");
}

function markdown(src) {
  const lines = escapeHtml(src.replace(/\r\n?/g, "\n")).split("\n");
  const out = [];
  let para = [];
  let list = null; // { type: "ul" | "ol", items: [] }
  const flushPara = () => { if (para.length) out.push(`<p>${inline(para.join("<br>"))}</p>`); para = []; };
  const flushList = () => {
    if (!list) return;
    out.push(`<${list.type}>${list.items.join("")}</${list.type}>`);
    list = null;
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    let m;
    if ((m = line.match(/^\s*```/))) {
      flushPara(); flushList();
      const code = [];
      while (++i < lines.length && !/^\s*```/.test(lines[i])) code.push(lines[i]);
      out.push(`<pre><code>${code.join("\n")}</code></pre>`);
    } else if ((m = line.match(/^(#{1,6})\s+(.*)$/))) {
      flushPara(); flushList();
      const n = Math.min(m[1].length, 4);
      out.push(`<h${n}>${inline(m[2])}</h${n}>`);
    } else if ((m = line.match(/^\s*(?:[-*+]|(\d+)[.)])\s+(.*)$/))) {
      flushPara();
      const type = m[1] ? "ol" : "ul";
      if (list && list.type !== type) flushList();
      list = list || { type, items: [] };
      const check = m[2].match(/^\[( |x|X)\]\s+(.*)$/);
      list.items.push(check
        ? `<li class="check"><input type="checkbox" disabled ${check[1] === " " ? "" : "checked"}> ${inline(check[2])}</li>`
        : `<li>${inline(m[2])}</li>`);
    } else if ((m = line.match(/^&gt;\s?(.*)$/))) {
      flushPara(); flushList();
      const quote = [m[1]];
      while (i + 1 < lines.length && (m = lines[i + 1].match(/^&gt;\s?(.*)$/))) { quote.push(m[1]); i++; }
      out.push(`<blockquote>${inline(quote.join("<br>"))}</blockquote>`);
    } else if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) {
      flushPara(); flushList();
      out.push("<hr>");
    } else if (line.trim() === "") {
      flushPara(); flushList();
    } else if (list && /^\s{2,}\S/.test(line)) {
      list.items[list.items.length - 1] = list.items[list.items.length - 1].replace(/<\/li>$/, ` ${inline(line.trim())}</li>`);
    } else {
      flushList();
      para.push(line);
    }
  }
  flushPara(); flushList();
  return out.join("");
}

// ---------- board ----------

// Loads can overlap (a poll, a drop, an edit); only the newest one may render,
// so a slow older reply never undoes what is on screen.
let boardRequest = 0;

async function loadBoard() {
  const request = ++boardRequest;
  try {
    // The server leaves out older done tasks unless asked: the board does not show
    // them, and the done column only grows. Search needs them all.
    const done = "&done=all"; // Filters and hierarchy checks need the complete project history.
    const [board, harness] = await Promise.all([
      api("GET", "/board?project=" + encodeURIComponent(isPortfolioRoute(state.project) ? "all" : state.project) + done),
      api("GET", "/harness"),
    ]);
    if (request !== boardRequest) return;
    state.harness = harness;
    for (const p of board.projects) {
      const profile = profileFor(p.slug);
      p.portfolio = { category: profile.category || "Needs classification", state: profile.visibility || "review", eligible: profile.visibility === "active", reason: profile.context_notes || "", category_source: "project profile" };
    }
    board.portfolio = { projects: board.projects.map((p) => ({ slug: p.slug, ...p.portfolio })), categories: [...new Set(board.projects.map((p) => p.portfolio.category))] };
    if (request !== boardRequest) return;
    state.board = board;
    if (!isPortfolioRoute(state.project)) state.scope = scopeForProject(state.project);
    state.changes = board.changes;
    $("#offline").hidden = true;
    render();
  } catch (e) {
    if (request !== boardRequest) return;
    if (state.project !== "all" && /no project/.test(e.message)) {
      setProject("all");
    } else {
      toast(e.message);
    }
  }
}

// The address is #project or #project/task-id, so a task can be linked to.
function updateHash() {
  const hash = "#" + state.project + (state.task ? "/" + state.task : "");
  if (location.hash !== hash) history.replaceState(null, "", hash);
}

function readHash() {
  let hash = location.hash.slice(1);
  try { hash = decodeURIComponent(hash); } catch {}
  const [slug, task] = hash.split("/");
  return { slug: slug || null, task: Number(task) || null };
}

function setProject(slug) {
  state.project = slug;
  closeSidebar();
  if (["@dashboard", "all", "@projects", "@planning", "@timeline", "@calendar", "@time"].includes(slug)) state.scope = "active";
  else if (slug === "@review" || slug === "@archive") state.scope = slug.slice(1);
  else {
    clearTaskFilters(false);
    if (state.board) state.scope = scopeForProject(slug);
  }
  try { localStorage.setItem("kanzo.project", slug); } catch {}
  updateHash();
  state.layout = "";
  loadBoard();
}

function render() {
  renderNav();
  renderDateControls();
  renderTimerIndicator();
  renderHeader();
  renderTaskFilters();
  if (state.project !== "all" && isPortfolioRoute(state.project)) {
    $("#columns").hidden = true;
    $("#dashboard").hidden = false;
    renderWorkspaceView();
  } else {
    $("#dashboard").hidden = true;
    $("#columns").hidden = false;
    renderColumns();
  }
}

function isPortfolioRoute(slug) { return ["@dashboard", "all", "@projects", "@planning", "@timeline", "@calendar", "@time", "@review", "@archive"].includes(slug); }
function projectMeta(p) {
  return p?.portfolio || state.board?.portfolio?.projects?.find((m) => m.slug === p?.slug) ||
    { category: "Needs classification", state: "review", eligible: false, reason: "Activity metadata is unavailable." };
}
function scopeForProject(slug) {
  const p = state.board?.projects.find((p) => p.slug === slug);
  const kind = projectMeta(p).state;
  return kind === "active" ? "active" : kind === "review" ? "review" : "archive";
}
function scopeProjects(scope = state.scope) {
  return (state.board?.projects || []).filter((p) => {
    const m = projectMeta(p);
    return scope === "active" ? m.state === "active" : scope === "review" ? m.state === "review" : ["inactive", "alias"].includes(m.state);
  });
}
function visibleProjects() {
  const words = state.projectQuery.toLowerCase().trim().split(/\s+/).filter(Boolean);
  return scopeProjects().filter((p) => (!state.typeFilter || projectMeta(p).category === state.typeFilter) &&
    words.every((w) => [p.name, p.slug, ...p.repos, projectMeta(p).category].join(" ").toLowerCase().includes(w)));
}
function taskScopeRows() {
  if (!isPortfolioRoute(state.project)) return state.board?.tasks || [];
  const slugs = new Set(scopeProjects().map((p) => p.slug));
  return (state.board?.tasks || []).filter((t) => slugs.has(t.project));
}
function matchesTaskFilters(t) {
  const p = planFor(t.id), words = state.taskQuery.toLowerCase().trim().split(/\s+/).filter(Boolean);
  const project = state.board?.projects.find((project) => project.slug === t.project);
  const text = [key(t), t.title, t.description, ...t.tags, project?.name || ""].join(" ").toLowerCase();
  const scheduled = !!(p.planned_start || p.planned_end || p.due_date);
  return (!state.typeFilter || profileFor(t.project).category === state.typeFilter) &&
    (!state.statusFilter || t.status === state.statusFilter) && (!state.tagFilter || t.tags.includes(state.tagFilter)) &&
    (!state.ownerFilter || p.owner === state.ownerFilter) &&
    (!state.scheduleFilter || (state.scheduleFilter === "yes") === scheduled) && words.every((word) => text.includes(word));
}
function visibleTasks() {
  return taskScopeRows().filter((t) => matchesTaskFilters(t) && (state.project !== "@planning" || t.status === "todo"));
}
function hasTaskFilters() { return [state.taskQuery.trim(), state.statusFilter, state.typeFilter, state.tagFilter, state.ownerFilter, state.scheduleFilter].some(Boolean); }
function clearTaskFilters(redraw = true) {
  for (const field of ["taskQuery", "statusFilter", "typeFilter", "tagFilter", "ownerFilter", "scheduleFilter"]) state[field] = "";
  if (redraw) { state.layout = ""; render(); }
}
function chooseTag(tag) { state.tagFilter = tag; closeTask(); render(); }
function renderTaskFilters() {
  const root = $("#task-filters"), hidden = ["@projects", "@review", "@archive"].includes(state.project);
  root.hidden = hidden;
  $("#filter-empty").hidden = true;
  if (hidden) return;
  const source = taskScopeRows();
  let reorderNote = $("#board-reorder-note");
  if (!reorderNote) { reorderNote = el("p", { id: "board-reorder-note", class: "board-reorder-note" }, "Clear task filters to reorder cards. Status changes remain available in task details."); root.append(reorderNote); }
  reorderNote.hidden = !hasTaskFilters() || (isPortfolioRoute(state.project) && state.project !== "all");
  root.classList.toggle("filters-open", state.filtersExpanded);
  const advancedCount = [state.statusFilter, state.typeFilter, state.tagFilter, state.ownerFilter, state.scheduleFilter].filter(Boolean).length;
  $("#filters-toggle").textContent = advancedCount ? `Filters (${advancedCount})` : "Filters";
  $("#filters-toggle").setAttribute("aria-expanded", String(state.filtersExpanded));
  const setOptions = (id, values, current, placeholder) => {
    const select = $(id);
    if (document.activeElement === select) return;
    const items = [...new Set([...values.filter(Boolean), ...(current ? [current] : [])])].sort((a, b) => a.localeCompare(b));
    select.replaceChildren(el("option", { value: "" }, placeholder), ...items.map((value) => el("option", { value }, value)));
    select.value = current;
  };
  if (document.activeElement !== $("#task-query")) $("#task-query").value = state.taskQuery;
  setOptions("#filter-status", state.board.statuses, state.statusFilter, "All states");
  setOptions("#filter-type", scopeProjects().map((p) => profileFor(p.slug).category), state.typeFilter, "All types");
  setOptions("#filter-tag", source.flatMap((t) => t.tags), state.tagFilter, "All tags");
  setOptions("#filter-owner", source.map((t) => planFor(t.id).owner), state.ownerFilter, "All owners");
  $("#filter-schedule").value = state.scheduleFilter;
  const matches = visibleTasks(), base = source.filter((t) => state.project !== "@planning" || t.status === "todo");
  const summaries = matches.filter((t) => childrenOf(t.id).length).length;
  $("#filter-count").textContent = `${matches.length} of ${base.length} tasks${summaries ? ` · ${summaries} summaries` : ""}`;
  $("#filters-clear").disabled = !hasTaskFilters();
  const fields = [["taskQuery", "Search", state.taskQuery.trim()], ["statusFilter", "State", state.statusFilter], ["typeFilter", "Type", state.typeFilter], ["tagFilter", "Tag", state.tagFilter], ["ownerFilter", "Owner", state.ownerFilter], ["scheduleFilter", "Dates", state.scheduleFilter === "yes" ? "Scheduled" : state.scheduleFilter === "no" ? "Unscheduled" : ""]];
  $("#filter-chips").replaceChildren(...fields.filter(([, , value]) => value).map(([field, label, value]) =>
    el("button", { class: "filter-chip", "aria-label": `Remove ${label.toLowerCase()} filter: ${value}`, onclick: () => { state[field] = ""; state.layout = ""; render(); } }, `${label}: ${value} ×`)));
  if (hasTaskFilters() && !matches.length) $("#filter-empty").hidden = false;
  const tags = [...new Set((state.board?.tasks || []).flatMap((t) => t.tags))].sort();
  $("#tag-suggestions").replaceChildren(...tags.map((tag) => el("option", { value: tag })));
}
let taskFilterTimer;
$("#task-query").addEventListener("input", (e) => {
  state.taskQuery = e.target.value;
  clearTimeout(taskFilterTimer);
  taskFilterTimer = setTimeout(render, 120);
});
for (const [id, field] of [["#filter-status", "statusFilter"], ["#filter-type", "typeFilter"], ["#filter-tag", "tagFilter"], ["#filter-owner", "ownerFilter"], ["#filter-schedule", "scheduleFilter"]]) {
  $(id).addEventListener("change", (e) => { state[field] = e.target.value; state.layout = ""; render(); });
}
$("#filters-clear").addEventListener("click", () => clearTaskFilters());
$("#filters-toggle").addEventListener("click", () => { state.filtersExpanded = !state.filtersExpanded; renderTaskFilters(); });
$("#filter-empty-clear").addEventListener("click", () => clearTaskFilters());
$("#task-search-open").addEventListener("click", () => openSearch());
function renderNav() {
  if (renaming && document.contains(renaming.input)) return;
  const projects = visibleProjects();
  const link = (slug, name, count, glyph) =>
    el("a", { href: "#" + slug, class: state.project === slug ? "active" : null,
      onclick: (e) => { e.preventDefault(); setProject(slug); } },
      glyph, el("span", { class: "name" }, name), el("span", { class: "count" }, String(count)));
  const item = (p) => renaming && renaming.slug === p.slug
    ? el("div", { class: "item renaming" }, icon("folder", projectColor(p.slug)), renaming.input)
    : el("div", { class: "item" + (state.menu === p.slug ? " menu-open" : "") },
      link(p.slug, p.name, p.open, icon("folder", projectColor(p.slug))),
      el("button", { class: "more", title: "Project options", "aria-label": `More for ${p.name}`, "aria-haspopup": "menu",
        onclick: (e) => toggleProjectMenu(p, e.currentTarget) }, icon("more")));
  const groups = new Map();
  for (const p of projects) {
    const category = projectMeta(p).category || "Needs classification";
    if (!groups.has(category)) groups.set(category, []);
    groups.get(category).push(p);
  }
  const grouped = [...groups].sort(([a], [b]) => a.localeCompare(b)).map(([category, list]) => {
    const details = el("details", { class: "project-group" });
    details.open = localStorageGet("kanzo.group." + category) !== "closed";
    details.addEventListener("toggle", () => { try { localStorage.setItem("kanzo.group." + category, details.open ? "open" : "closed"); } catch {} });
    details.append(el("summary", {}, el("span", {}, category), el("span", { class: "count" }, String(list.length))),
      ...list.sort((a, b) => a.name.localeCompare(b.name)).map(item));
    return details;
  });
  const active = scopeProjects("active"), review = scopeProjects("review"), archive = scopeProjects("archive");
  $("#nav").replaceChildren(
    link("@dashboard", "Overview", "", icon("home")),
    link("@projects", "Projects", active.length, icon("folder")),
    link("@planning", "Planning queue", activeLeaves().filter((t) => t.status === "todo").length, icon("list")),
    link("all", "Board", "", icon("board")),
    link("@timeline", "Timeline", "", icon("timeline")),
    link("@calendar", "Calendar", "", icon("calendar")),
    link("@time", "Time log", "", icon("clock")),
    el("div", { class: "nav-secondary" }, link("@review", "Needs review", review.length, icon("info")), link("@archive", "Archive", archive.length, icon("archive"))),
    el("div", { class: "label" }, state.scope === "active" ? "Active projects by type" : state.scope === "review" ? "Projects needing review" : "Archived projects by type"),
    ...grouped,
    ...(!projects.length ? [el("p", { class: "nav-empty" }, "No projects match this view.")] : []));
}

// ---------- project menu ----------

// The "⋯" menu of a sidebar project. `state.menu` holds its slug, so the row keeps
// its highlight while the sidebar is redrawn by polling.
function toggleProjectMenu(p, button) {
  const wasOpen = state.menu === p.slug;
  closeMenu();
  if (wasOpen) return;
  state.menu = p.slug;
  button.closest(".item").classList.add("menu-open");
  const swatches = el("div", { class: "swatches", role: "group", "aria-label": "Color" });
  const drawSwatches = () => swatches.replaceChildren(...Object.entries(PROJECT_COLORS).map(([name, hex]) => {
    const current = projectColorName(p.slug) === name;
    return el("button", { class: "swatch", style: `background:${hex}`, title: name, "aria-label": name,
                          "aria-pressed": String(current), onclick: () => pickColor(p.slug, name).then(drawSwatches) },
      current ? icon("check") : null);
  }));
  drawSwatches();
  // Linked repos, each with an unlink button, and a field to link another.
  const repos = el("div", { class: "repos" });
  const drawRepos = (list, focus) => {
    const input = el("input", { class: "field", placeholder: "Link a repo: owner/repo", "aria-label": "Link a GitHub repo",
                                autocomplete: "off", spellcheck: "false" });
    input.addEventListener("keydown", async (e) => {
      if (e.key !== "Enter" || !input.value.trim()) return;
      const q = await changeRepo(p.slug, "POST", input.value);
      if (q) drawRepos(q.repos, true);
    });
    repos.replaceChildren(...list.map((r) => el("div", { class: "repo" }, el("span", { class: "name" }, r),
      el("button", { class: "unlink", title: `Unlink ${r}`, "aria-label": `Unlink ${r}`,
                     onclick: async () => { const q = await changeRepo(p.slug, "DELETE", r); if (q) drawRepos(q.repos); } },
        icon("close")))), input);
    if (focus) input.focus();
  };
  drawRepos(p.repos);
  const rename = el("button", { onclick: () => startRename(p) }, icon("rename"), "Rename");
  const remove = el("button", { class: "danger", onclick: () => { closeMenu(); deleteProject(p); } },
    icon("trash"), "Delete project");
  const menu = el("div", { class: "menu", role: "menu", tabindex: "-1" },
    el("div", { class: "label" }, "Color"), swatches, el("div", { class: "label" }, "Repos"), repos,
    el("div", { class: "sep" }),
    el("button", { onclick: () => { closeMenu(); showCategoryDialog(p); } }, icon("folder"), "Categorize project"),
    el("button", { onclick: () => { closeMenu(); savePortfolio(p.slug, { visibility: projectMeta(p).state === "active" ? "inactive" : "active" }); } }, icon("folder"), projectMeta(p).state === "active" ? "Move to archive" : "Restore to active"),
    el("button", { onclick: () => { closeMenu(); showProjectProfile(p); } }, icon("info"), "Project brief & context"),
    rename, remove);
  document.body.append(menu);
  const r = button.getBoundingClientRect();
  const below = r.bottom + 4 + menu.offsetHeight <= innerHeight;
  menu.style.top = `${Math.max(8, below ? r.bottom + 4 : r.top - 4 - menu.offsetHeight)}px`;
  menu.style.left = `${Math.max(8, Math.min(r.left, innerWidth - menu.offsetWidth - 8))}px`;
  // Focus the menu itself, so Tab reaches its buttons without one looking selected.
  menu.focus();
}

// Renaming a project, as in ChatGPT: its sidebar row becomes a field. Enter or leaving it
// saves, Esc cancels. The slug, and so the task keys, stay.
let renaming = null; // { slug, input }

function startRename(p) {
  closeMenu();
  const input = el("input", { class: "field", "aria-label": `Rename ${p.name}`, spellcheck: "false", autocomplete: "off" });
  input.value = p.name;
  renaming = { slug: p.slug, input };
  let finished = false;
  const finish = async (save) => {
    if (finished) return;
    finished = true;
    const name = input.value.trim();
    renaming = null;
    if (save && name && name !== p.name) {
      try { await api("PATCH", `/projects/${encodeURIComponent(p.slug)}`, { name }); } catch (err) { toast(err.message); }
    }
    loadBoard();
  };
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); finish(true); }
    else if (e.key === "Escape") { e.stopPropagation(); finish(false); }
  });
  input.addEventListener("blur", () => finish(true));
  renderNav();
  input.focus();
  input.select();
}

// Links (POST) or unlinks (DELETE) a repo; returns the project, or null after showing the error.
async function changeRepo(slug, method, repo) {
  try {
    const p = await api(method, `/projects/${encodeURIComponent(slug)}/repos`, { repo });
    loadBoard();
    return p;
  } catch (err) { toast(err.message); return null; }
}

async function pickColor(slug, color) {
  try {
    await api("PATCH", `/projects/${encodeURIComponent(slug)}`, { color });
    await loadBoard();
  } catch (err) { toast(err.message); }
}

function closeMenu() {
  if (!state.menu) return;
  state.menu = null;
  document.querySelector(".menu")?.remove();
  document.querySelectorAll(".nav .menu-open").forEach((i) => i.classList.remove("menu-open"));
  $("#settings").classList.remove("open");
}

// A click elsewhere closes the menu; one on a "⋯" or the Settings button is left to toggle it.
document.addEventListener("mousedown", (e) => {
  if (!e.target.closest(".menu, .nav .more, #settings")) closeMenu();
});
// A click outside the task panel closes it. Cards are left to open their own task,
// and the project menu to do its job.
document.addEventListener("mousedown", (e) => {
  if (state.task && e.button === 0 && !e.target.closest("#panel, .card, .menu, .search-dialog, dialog, #theme-control, #timer-indicator, #sidebar-toggle, #sidebar-scrim")) closeTask();
});
window.addEventListener("resize", closeMenu);
window.addEventListener("blur", closeMenu);
$("#nav").addEventListener("scroll", closeMenu);

function currentProject() {
  return state.board.projects.find((p) => p.slug === state.project) || null;
}

function renderHeader() {
  const p = currentProject();
  const header = $("#header");
  $("#new-task").hidden = state.scope !== "active" || !scopeProjects().length;
  $("#project-notice").hidden = !p;
  if (!p) {
    const titles = { "@dashboard": "Portfolio planning", "@projects": "Projects", "@planning": "Planning queue", "@timeline": "Timeline", "@calendar": "Calendar", "@time": "Time log", all: "Task board", "@review": "Needs review", "@archive": "Archive" };
    const list = scopeProjects().filter((p) => !state.typeFilter || projectMeta(p).category === state.typeFilter);
    header.replaceChildren(el("h1", {}, titles[state.project] || "Task board"),
      el("span", { class: "sub" }, state.project === "@dashboard" ? "Your projects. A clear next step." : `${list.length} projects`));
    if (["@projects", "@review", "@archive"].includes(state.project) && state.typeFilter) header.append(el("button", { class: "filter-chip", onclick: () => { state.typeFilter = ""; render(); } }, state.typeFilter + " ×"));
    $("#project-notice").hidden = true;
    return;
  }
  const m = projectMeta(p);
  header.replaceChildren(el("h1", {}, p.name), el("span", { class: "sub" }, `${p.open} open tasks`),
    el("button", { class: "filter-chip", onclick: () => showCategoryDialog(p), title: "Change project type" }, m.category || "Categorize"),
    ...p.repos.map((r) => el("a", { class: "repo-link", href: `https://github.com/${r}`, target: "_blank", rel: "noopener" }, icon("github"), r)));
  const notice = $("#project-notice");
  notice.replaceChildren(el("summary", {}, el("span", {}, m.state === "active" ? (m.band === "2to3months" ? "Activity warning" : "Active project") : m.state === "review" ? "Needs review" : "Archived project"), el("span", { class: "notice-toggle" }, "Project notes")),
    el("div", { class: "notice-body" }, el("p", { class: "notice-reason" }, m.reason || "No project notes recorded."),
      ...(m.state !== "active" ? [el("p", {}, "Excluded from automatic selection."), el("button", { class: "btn", onclick: () => savePortfolio(p.slug, { visibility: "active" }) }, "Restore to active")] : [])));
}

function projectDate(value) {
  if (!value) return "Activity unknown";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? "Activity unknown" : d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}
async function savePortfolio(slug, patch) {
  try {
    const profile = profileFor(slug);
    if (Object.prototype.hasOwnProperty.call(patch, "category")) profile.category = patch.category || "Needs classification";
    if (patch.visibility) profile.visibility = patch.visibility;
    await api("PUT", `/projects/${encodeURIComponent(slug)}/profile`, profile);
    await loadBoard();
    toast(patch.visibility === "inactive" ? "Project archived. Task history preserved." : patch.visibility === "active" ? "Project restored to active." : "Project organization saved.");
    return true;
  } catch (err) { toast(err.message); return false; }
}
let categoryProject = null;
function showCategoryDialog(p) {
  categoryProject = p;
  const current = projectMeta(p).category || "Needs classification";
  const choices = [...new Set([...(state.board.portfolio?.categories || []), ...state.board.projects.map((p) => projectMeta(p).category), current].filter(Boolean))].sort();
  $("#category-title").textContent = `Categorize ${p.name}`;
  $("#category-choice").replaceChildren(...choices.map((c) => el("option", { value: c }, c)), el("option", { value: "__new__" }, "+ Create a new type…"));
  $("#category-choice").value = current;
  $("#category-new").value = ""; $("#category-new-wrap").hidden = true; $("#category-error").hidden = true;
  $("#category-dialog").showModal(); $("#category-choice").focus();
}
$("#category-choice").addEventListener("change", () => {
  $("#category-new-wrap").hidden = $("#category-choice").value !== "__new__";
  if (!$("#category-new-wrap").hidden) $("#category-new").focus();
});
$("#category-cancel").addEventListener("click", () => $("#category-dialog").close());
$("#category-reset").addEventListener("click", async () => {
  if (categoryProject && await savePortfolio(categoryProject.slug, { category: null })) $("#category-dialog").close();
});
$("#category-form").addEventListener("submit", async (e) => {
  e.preventDefault(); if (!categoryProject) return;
  const category = $("#category-choice").value === "__new__" ? $("#category-new").value.trim() : $("#category-choice").value;
  if (!category || category.length > 64) { $("#category-error").textContent = "Enter a project type of 1–64 characters."; $("#category-error").hidden = false; return; }
  const button = $("#category-save"); button.disabled = true;
  try {
    await api("PUT", `/projects/${encodeURIComponent(categoryProject.slug)}/profile`, { ...profileFor(categoryProject.slug), category });
    $("#category-dialog").close(); await loadBoard(); toast("Project type saved.");
  } catch (err) { $("#category-error").textContent = err.message; $("#category-error").hidden = false; }
  finally { button.disabled = false; }
});
$("#project-filter").addEventListener("input", (e) => {
  state.projectQuery = e.target.value; renderNav();
  if (["@projects", "@review", "@archive"].includes(state.project)) renderProjectList();
});

async function deleteProject(p) {
  const tasks = p.total ? ` and its ${p.total} task${p.total > 1 ? "s" : ""}, with their comments` : "";
  if (!confirm(`Delete project ${p.slug}${tasks}? This cannot be undone.`)) return;
  try {
    await api("DELETE", `/projects/${encodeURIComponent(p.slug)}`);
    if (panelTask?.project === p.slug) { fresh = null; closeTask(); }
    if (state.project === p.slug) setProject("all"); else loadBoard();
  } catch (err) { toast(err.message); }
}

function renderColumns() {
  const statuses = state.statusFilter ? state.board.statuses.filter((s) => s === state.statusFilter) : state.board.statuses;
  const projects = isPortfolioRoute(state.project) ? scopeProjects() : state.board.projects;
  const tasks = visibleTasks();
  const columns = $("#columns");
  if (!projects.length) {
    state.layout = "";
    columns.style.display = "flex";
    columns.replaceChildren(el("div", { class: "empty" },
      el("h1", {}, "Welcome to Kanzo"),
      el("p", {}, "Create your first project in the sidebar. Link it to a GitHub repo and agents working in that repo will find it on their own."),
      el("button", { class: "btn primary", onclick: showNewProject }, "New project")));
    return;
  }
  columns.style.display = "";

  // Build the columns once per layout so a refresh never wipes a half-typed task.
  const layout = statuses.join(",") + "|" + state.project + "|" + state.scope + "|" + state.typeFilter + "|" + state.statusFilter;
  if (state.layout !== layout) {
    state.layout = layout;
    columns.replaceChildren(...statuses.map((status) => {
      const collapsible = status === "backlog" || status === "done";
      const col = el("section", { class: "column", "data-status": status },
        el("h2", {},
          statusIcon(status), status,
          el("span", { class: "count" }),
          collapsible ? el("button", { class: "collapse", onclick: (e) => { e.stopPropagation(); setCollapsed(status, !isCollapsed(status)); } }) : null),
        el("div", { class: "cards" }), el("div", { class: "column-pagination" }),
      );
      wireDrop(col, col.querySelector(".cards"), status);
      if (collapsible) col.addEventListener("click", () => { if (isCollapsed(status)) setCollapsed(status, false); });
      return col;
    }));
    showCollapsed();
  }

  // During a drag the DOM is being moved by hand; refresh once it ends.
  if (state.dragging) return;
  const all = isPortfolioRoute(state.project);
  for (const status of statuses) {
    const col = columns.querySelector(`[data-status="${CSS.escape(status)}"]`);
    const mine = tasks.filter((t) => t.status === status);
    // Older done tasks the server left out (see loadBoard).
    const last = status === statuses[statuses.length - 1];
    const hidden = last && !state.allDone && !isPortfolioRoute(state.project) ? state.board.done_hidden || 0 : 0;
    const count = mine.length + hidden;
    col.querySelector("h2 .count").textContent = count ? String(count) : "";
    const more = hidden
      ? el("button", { class: "ghost more", onclick: () => { state.allDone = true; loadBoard(); } }, `Show ${hidden} older`)
      : null;
    const page = paginationWindow(`column:${status}`, mine);
    col._pagination = { items: mine, window: page };
    col.querySelector(".cards").replaceChildren(...[more].filter(Boolean), ...page.items.map((t) => card(t, all)));
    col.querySelector(".column-pagination").replaceChildren(renderPager(page, status));
  }
}

// Backlog and done, which only grows, start collapsed to a thin strip, as in Trello or
// Linear, and each browser remembers the choice. Cards can still be dropped on a strip.
function isCollapsed(status) {
  return localStorageGet(`kanzo.${status}Collapsed`) !== "0";
}

function setCollapsed(status, collapsed) {
  try { localStorage.setItem(`kanzo.${status}Collapsed`, collapsed ? "1" : "0"); } catch {}
  showCollapsed();
}

function showCollapsed() {
  const columns = $("#columns");
  const cols = [...columns.querySelectorAll(".column")];
  if (!cols.length) return;
  for (const col of cols) {
    const button = col.querySelector(".collapse");
    if (!button) continue;
    const { status } = col.dataset;
    const collapsed = isCollapsed(status);
    col.classList.toggle("collapsed", collapsed);
    // The arrows point the way the column folds: to the right edge, or for backlog,
    // to the left one.
    const left = status === "backlog";
    button.replaceChildren(icon(collapsed !== left ? "expand" : "collapse"));
    button.title = collapsed ? `Show ${status}` : `Collapse ${status}`;
    button.setAttribute("aria-label", button.title);
  }
  columns.style.gridTemplateColumns = cols.map((c) => (c.classList.contains("collapsed") ? "48px" : "minmax(260px, 1fr)")).join(" ");
}

// A description as one line of plain text for a card: Markdown markers dropped, lines joined.
function plainText(md) {
  return md.split("\n")
    .map((l) => l.replace(/^\s*(#{1,6}|>|[-*+]|\d+[.)])\s+/, "").replace(/^\[[ xX]\]\s+/, ""))
    .filter((l) => l.trim() && !/^\s*```/.test(l))
    .join(" ")
    .replace(/\*\*|__|`/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function card(t, showProject) {
  const node = el("div", { class: "card" + (state.task === t.id ? " open" : ""), draggable: String(!hasTaskFilters()), "data-id": t.id,
                           onclick: () => openTask(t.id) },
    el("div", { class: "head" },
      el("div", { class: "title" }, t.title),
      // On "All projects" a dot in the project's colour tells the projects apart.
      t.human ? el("span", { class: "human-mark", title: "Human task: agents skip it" }, icon("human")) : null,
      el("span", { class: "num", title: `Copy ${key(t)}`, onclick: (e) => { e.stopPropagation(); copyKey(key(t)); } },
        showProject ? el("span", { class: "dot", style: `background:${projectColor(t.project)}` }) : null, `#${t.id}`)),
    t.description ? el("div", { class: "desc" }, plainText(t.description)) : null,
    t.tags.length ? el("div", { class: "tags" }, t.tags.map((tag) => el("button", { type: "button", class: "tag", title: `Filter by tag: ${tag}`, onclick: (e) => { e.stopPropagation(); chooseTag(tag); } }, tag))) : null);
  node.addEventListener("dragstart", (e) => {
    if (hasTaskFilters()) { e.preventDefault(); return; }
    state.dragging = t.id;
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", String(t.id));
    requestAnimationFrame(() => node.classList.add("dragging"));
  });
  node.addEventListener("dragend", () => {
    node.classList.remove("dragging");
    document.querySelectorAll(".drop-line").forEach((d) => d.remove());
    state.dragging = null;
    // A drop reloads once the move is saved; a cancelled drag puts the card back.
    if (!state.dropped) loadBoard();
    state.dropped = false;
  });
  return node;
}

// The whole column takes drops; cards land in its list.
function wireDrop(col, list, status) {
  const line = el("div", { class: "drop-line" });
  const cardAfter = (y) => {
    const cards = [...list.querySelectorAll(".card:not(.dragging)")];
    return cards.find((c) => { const r = c.getBoundingClientRect(); return y < r.top + r.height / 2; }) || null;
  };
  col.addEventListener("dragover", (e) => {
    if (!state.dragging || hasTaskFilters()) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    const after = cardAfter(e.clientY);
    if (after) list.insertBefore(line, after); else list.append(line);
  });
  col.addEventListener("dragleave", (e) => {
    if (!col.contains(e.relatedTarget)) line.remove();
  });
  col.addEventListener("drop", async (e) => {
    e.preventDefault();
    const id = state.dragging;
    if (!id) return;
    if (hasTaskFilters()) { line.remove(); toast("Clear task filters before reordering cards."); return; }
    const after = cardAfter(e.clientY);
    const dragged = document.querySelector(`.card[data-id="${id}"]`);
    if (dragged) list.insertBefore(dragged, line.parentNode === list ? line : null);
    line.remove();
    state.dropped = true;
    if (fresh === id) fresh = null;
    const before = after ? Number(after.dataset.id) : col.classList.contains("collapsed") ? null
      : window.KanzoPagination.nextAfterPage(col._pagination?.items || [], col._pagination?.window || { end: 0 }, id);
    try {
      await api("POST", `/tasks/${id}/move`, { status, before });
      if (state.task === id) refreshTask();
    } catch (err) { toast(err.message); }
    loadBoard();
  });
}

function localStorageGet(k) {
  try { return localStorage.getItem(k); } catch { return null; }
}

// ---------- new task ----------

// New task creates the task in todo at once and opens it like any other, with its title
// selected to type over; its Status field moves it elsewhere. Closed untouched, it is
// deleted again.
const NEW_TITLE = "New task";
let fresh = null; // id of the task just added, until something in it is saved

async function newTask() {
  const projects = !isPortfolioRoute(state.project) ? state.board.projects.filter((p) => p.slug === state.project)
    : scopeProjects().filter((p) => !state.typeFilter || projectMeta(p).category === state.typeFilter);
  if (!projects.length) { toast("Create a project first"); return; }
  const last = localStorageGet("kanzo.newTaskProject");
  const project = !isPortfolioRoute(state.project) ? state.project
    : projects.some((p) => p.slug === last) ? last : projects[0].slug;
  try {
    const task = await api("POST", "/tasks", { project, title: NEW_TITLE });
    await openTask(task.id);
    fresh = task.id;
    loadBoard();
    $("#p-title").focus({ preventScroll: true });
    $("#p-title").select();
  } catch (err) { toast(err.message); }
}

function dropFresh() {
  if (!fresh) return;
  const id = fresh;
  fresh = null;
  api("DELETE", `/tasks/${id}`).then(loadBoard, () => {});
}

// Leaving the page also counts as closing the task.
window.addEventListener("pagehide", () => {
  if (fresh) fetch(`/api/tasks/${fresh}`, { method: "DELETE", keepalive: true });
});

// ---------- new project ----------

function showNewProject() {
  $("#project-dialog").hidden = false;
  $("#new-project [name=slug]").focus();
}

function hideNewProject() {
  $("#new-project").reset();
  $("#project-dialog").hidden = true;
}

$("#new-task").addEventListener("click", newTask);
$("#new-project-toggle").addEventListener("click", showNewProject);
$("#new-project-cancel").addEventListener("click", hideNewProject);
$("#project-dialog").addEventListener("mousedown", (e) => { if (e.target.id === "project-dialog") hideNewProject(); });
$("#project-dialog").addEventListener("keydown", (e) => { if (e.key === "Escape") { e.stopPropagation(); hideNewProject(); } });
$("#new-project").addEventListener("submit", async (e) => {
  e.preventDefault();
  const f = new FormData(e.target);
  try {
    const p = await api("POST", "/projects", { slug: f.get("slug"), name: f.get("name"), repo: f.get("repo") || null });
    hideNewProject();
    setProject(p.slug);
  } catch (err) { toast(err.message); }
});

// ---------- task panel ----------

// Every field is editable in place and saves when it loses focus.
const panel = $("#panel");
let panelTask = null;

async function openTask(id) {
  leavePanelField();
  if (fresh !== id) dropFresh();
  if (state.task !== id) state.taskTab = "overview";
  state.task = id;
  document.body.classList.add("detail-open");
  document.querySelectorAll(".card.open").forEach((c) => c.classList.remove("open"));
  document.querySelector(`.card[data-id="${id}"]`)?.classList.add("open");
  $("#p-comment").value = "";
  pending = [];
  renderPending();
  fit($("#p-comment"));
  updateHash();
  await refreshTask();
  if (state.task !== id) return;
  panel.classList.add("shown");
  panel.setAttribute("aria-hidden", "false");
}

// Blurring a field saves it, so do that before the panel lets go of a task.
function leavePanelField() {
  if (panel.contains(document.activeElement)) document.activeElement.blur();
}

function closeTask() {
  leavePanelField();
  dropFresh();
  state.task = null;
  panelTask = null;
  updateHash();
  panel.classList.remove("shown");
  document.body.classList.remove("detail-open");
  panel.setAttribute("aria-hidden", "true");
  document.querySelectorAll(".card.open").forEach((c) => c.classList.remove("open"));
}

async function refreshTask() {
  const id = state.task;
  if (!id) return;
  let data;
  try {
    const reply = await Promise.all([api("GET", `/tasks/${id}`), api("GET", `/tasks/${id}/context`)]);
    data = reply[0];
    if (state.task === id) state.taskContext = reply[1];
  } catch (e) {
    if (state.task === id && /no task/.test(e.message)) { toast("That task was deleted"); closeTask(); }
    return;
  }
  // Another task may have taken the panel meanwhile.
  if (state.task !== id) return;
  const { task, comments, images } = data;
  renderTaskHarness(task, state.taskContext);
  panelTask = task;
  $("#p-key").textContent = key(task);
  $("#p-key").title = key(task);
  $("#p-key").title = `Copy ${key(task)}`;
  // Never overwrite what is being typed or picked.
  if (!$("#p-project").contains(document.activeElement)) renderProjectPick(task);
  for (const [field, value] of [[$("#p-title"), task.title], [$("#p-desc"), task.description], [$("#p-tags"), task.tags.join(", ")]]) {
    if (document.activeElement !== field) { field.value = value; fit(field); }
  }
  showDesc();
  const status = $("#p-status");
  const statuses = state.board ? state.board.statuses : [task.status];
  status.replaceChildren(...statuses.map((s) => el("option", { value: s, disabled: s === "done" && task.status !== "done" }, s === "done" && task.status !== "done" ? "Done — accept with evidence" : s)));
  if (!statuses.includes(task.status)) status.append(el("option", { value: task.status }, task.status));
  status.value = task.status;
  $("#p-human").checked = task.human;
  $("#p-created").replaceChildren(timeEl(task.created_at));
  $("#p-updated").replaceChildren(timeEl(task.updated_at));
  $("#p-comment-count").textContent = comments.length ? String(comments.length) : "";
  $("#p-images").replaceChildren(...images.filter((i) => i.comment_id === null).map((i) =>
    thumb(i.file, async () => {
      try { await api("DELETE", `/images/${i.id}`); refreshTask(); } catch (err) { toast(err.message); }
    })));
  $("#p-comments").replaceChildren(...comments.map((c) => {
    const body = el("div", { class: "md" });
    body.innerHTML = markdown(c.body);
    const attached = images.filter((i) => i.comment_id === c.id);
    return el("div", { class: "comment" },
      el("div", { class: "who" }, el("b", {}, c.author), " · ", timeEl(c.created_at),
        el("button", { class: "remove", title: "Delete comment", "aria-label": "Delete comment",
                       onclick: () => deleteComment(c) }, icon("trash"))),
      c.body ? body : null,
      attached.length ? el("div", { class: "thumbs" }, attached.map((i) => thumb(i.file))) : null);
  }));
}

async function deleteComment(c) {
  if (!confirm("Delete this comment? This cannot be undone.")) return;
  try {
    await api("DELETE", `/comments/${c.id}`);
    await refreshTask();
    loadBoard();
  } catch (err) { toast(err.message); }
}

// The project tag doubles as a picker that moves the task to another project.
function renderProjectPick(task) {
  const projects = state.board ? state.board.projects.map((p) => p.slug) : [];
  if (!projects.includes(task.project)) projects.push(task.project);
  const select = el("select", { title: "Project", "aria-label": "Project" },
    ...projects.map((slug) => el("option", { value: slug }, slug)));
  select.value = task.project;
  select.addEventListener("change", () => {
    try { localStorage.setItem("kanzo.newTaskProject", select.value); } catch {}
    patchTask({ project: select.value });
  });
  $("#p-project").replaceChildren(el("label", { class: "tag project-pick" },
    el("span", { class: "dot", style: `background:${projectColor(task.project)}` }), select));
}

// Textareas grow with their text instead of scrolling.
function fit(t) {
  if (t.tagName !== "TEXTAREA") return;
  t.style.height = "auto";
  t.style.height = t.scrollHeight + "px";
}

async function patchTask(fields) {
  if (!panelTask) return;
  if (fresh === panelTask.id) fresh = null;
  try {
    await api("PATCH", `/tasks/${panelTask.id}`, fields);
    await refreshTask();
    loadBoard();
  } catch (e) { toast(e.message); refreshTask(); }
}

// Escape undoes the field's edit; on a task just added and not saved yet, it drops the task.
function cancelField(e, saved) {
  e.stopPropagation();
  if (fresh && fresh === state.task) { closeTask(); return; }
  e.target.value = saved;
  fit(e.target);
  e.target.blur();
}

$("#p-close").addEventListener("click", closeTask);
$("#p-key").addEventListener("click", () => { if (panelTask) copyKey(key(panelTask)); });
for (const field of [$("#p-title"), $("#p-desc")]) field.addEventListener("input", () => fit(field));

// ⌘↵ in the title or description saves and closes.
$("#p-title").addEventListener("keydown", (e) => {
  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); closeTask(); }
  // The title is one line: Enter, like Tab, goes on to the description.
  else if ((e.key === "Enter" || e.key === "Tab") && !e.shiftKey) { e.preventDefault(); editDesc(); }
  else if (e.key === "Escape") cancelField(e, panelTask ? panelTask.title : "");
});
$("#p-title").addEventListener("blur", (e) => {
  if (!panelTask) return;
  const v = e.target.value.trim();
  if (v && v !== panelTask.title) patchTask({ title: v });
  else { e.target.value = panelTask.title; fit(e.target); }
});

$("#p-desc").addEventListener("keydown", (e) => {
  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); closeTask(); }
  else if (e.key === "Escape") cancelField(e, panelTask ? panelTask.description : "");
});
$("#p-desc").addEventListener("blur", (e) => {
  if (panelTask && e.target.value.trim() !== panelTask.description) patchTask({ description: e.target.value });
  showDesc();
});

// The description shows rendered, like a comment, and turns into its textarea to edit.
// Empty, the textarea stays, so its placeholder has something to click.
function showDesc() {
  const desc = $("#p-desc"), view = $("#p-desc-view");
  const editing = document.activeElement === desc || !desc.value.trim();
  desc.hidden = !editing;
  view.hidden = editing;
  if (!editing) view.innerHTML = markdown(desc.value);
}

function editDesc() {
  const desc = $("#p-desc");
  $("#p-desc-view").hidden = true;
  desc.hidden = false;
  fit(desc);
  desc.focus();
}

// A click on a link opens it instead of editing.
$("#p-desc-view").addEventListener("mousedown", (e) => { if (e.target.closest("a")) e.preventDefault(); });
$("#p-desc-view").addEventListener("focus", editDesc);

$("#p-status").addEventListener("change", (e) => patchTask({ status: e.target.value }));
$("#p-human").addEventListener("change", (e) => patchTask({ human: e.target.checked }));

// ---------- images ----------

// Pasting or dropping an image attaches it, as in ChatGPT: to the task from the title or
// the description, to the comment being written from the comment box. Text is left alone.
let pending = []; // images waiting in the comment box, by file name

function imagesIn(transfer) {
  if (!transfer) return [];
  const fromItems = transfer.items ? [...transfer.items].filter((i) => i.kind === "file").map((i) => i.getAsFile()) : [];
  return (fromItems.length ? fromItems : [...(transfer.files || [])]).filter((f) => f && f.type.startsWith("image/"));
}

async function uploadImage(image) {
  const res = await fetch("/api/images", { method: "POST", headers: { "Content-Type": image.type }, body: image });
  const reply = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(reply.error || res.statusText);
  return reply.file;
}

async function attachImages(images, toComment) {
  if (!panelTask) return;
  const task = panelTask.id;
  try {
    for (const image of images) {
      const file = await uploadImage(image);
      if (toComment) {
        pending.push(file);
        renderPending();
      } else {
        await api("POST", `/tasks/${task}/images`, { file });
        if (fresh === task) fresh = null;
      }
    }
    if (!toComment) refreshTask();
  } catch (err) { toast(err.message); }
}

// A thumbnail that opens the full image; with `onRemove`, an × to take it off.
function thumb(file, onRemove) {
  return el("div", { class: "thumb" },
    el("a", { href: `/images/${file}`, target: "_blank", rel: "noopener" }, el("img", { src: `/images/${file}`, alt: "Attached image" })),
    onRemove ? el("button", { type: "button", class: "remove-image", title: "Remove image", "aria-label": "Remove image", onclick: onRemove }, icon("close")) : null);
}

function renderPending() {
  $("#p-pending").replaceChildren(...pending.map((file, i) => thumb(file, () => { pending.splice(i, 1); renderPending(); })));
  $("#p-send").disabled = !$("#p-comment").value.trim() && !pending.length;
}

for (const field of [$("#p-title"), $("#p-desc"), $("#p-comment")]) {
  field.addEventListener("paste", (e) => {
    const images = imagesIn(e.clipboardData);
    if (!images.length) return;
    e.preventDefault();
    attachImages(images, field.id === "p-comment");
  });
}
for (const [zone, toComment] of [[$("#p-desc").closest(".section"), false], [$("#p-comment-form"), true]]) {
  zone.addEventListener("dragover", (e) => {
    if (!e.dataTransfer || ![...e.dataTransfer.types].includes("Files")) return;
    e.preventDefault();
    zone.classList.add("dropping");
  });
  zone.addEventListener("dragleave", (e) => { if (!zone.contains(e.relatedTarget)) zone.classList.remove("dropping"); });
  zone.addEventListener("drop", (e) => {
    zone.classList.remove("dropping");
    const images = imagesIn(e.dataTransfer);
    if (!images.length) return;
    e.preventDefault();
    attachImages(images, toComment);
  });
}

// Tags are typed comma-separated and tidied the way the server stores them.
const cleanTags = (text) => [...new Set(text.split(",").map((t) => t.trim().replace(/\s+/g, " ").toLowerCase()).filter(Boolean))];
$("#p-tags").addEventListener("keydown", (e) => {
  if (e.key === "Enter") { e.preventDefault(); e.target.blur(); }
  else if (e.key === "Escape") cancelField(e, panelTask ? panelTask.tags.join(", ") : "");
});
$("#p-tags").addEventListener("blur", (e) => {
  if (!panelTask) return;
  const tags = cleanTags(e.target.value);
  if (tags.join(",") !== panelTask.tags.join(",")) patchTask({ tags: tags.join(", ") });
  else e.target.value = panelTask.tags.join(", ");
});

$("#p-comment-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const body = $("#p-comment").value.trim();
  if ((!body && !pending.length) || !panelTask) return;
  try {
    await api("POST", `/tasks/${panelTask.id}/comments`, { body, images: pending });
    if (fresh === panelTask.id) fresh = null;
    $("#p-comment").value = "";
    pending = [];
    renderPending();
    fit($("#p-comment"));
    await refreshTask();
    loadBoard();
  } catch (err) { toast(err.message); }
});
// The send button is live only once there is something to send.
$("#p-comment").addEventListener("input", (e) => { $("#p-send").disabled = !e.target.value.trim() && !pending.length; fit(e.target); });
$("#p-comment").addEventListener("keydown", (e) => {
  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); $("#p-comment-form").requestSubmit(); }
});

$("#p-delete").addEventListener("click", async () => {
  if (!panelTask) return;
  const extra = panelTask.comments ? ` and its ${panelTask.comments} comment${panelTask.comments > 1 ? "s" : ""}` : "";
  if (!confirm(`Delete ${key(panelTask)}${extra}? This cannot be undone.`)) return;
  try {
    if (fresh === panelTask.id) fresh = null;
    await api("DELETE", `/tasks/${panelTask.id}`);
    closeTask();
    loadBoard();
  } catch (err) { toast(err.message); }
});

// ---------- search ----------

// The search window, as in ChatGPT: tasks of every project, found by the server, open
// ones first. Arrows pick, Enter opens, Esc closes. Without words it shows the latest changes.
let results = [], selected = 0, searchRequest = 0, searchTimer, searchOffset = 0, searchTotal = 0, searchReturnFocus;

function openSearch() {
  searchReturnFocus = document.activeElement;
  closeMenu();
  $("#search-dialog").hidden = false;
  $("#search").value = state.taskQuery;
  $("#search-scope").value = state.scope === "archive" ? "inactive" : state.scope === "review" ? "review" : "active";
  $("#search").focus();
  runSearch();
}

function closeSearch() {
  ++searchRequest;
  clearTimeout(searchTimer);
  $("#search-dialog").hidden = true;
  if (searchReturnFocus?.isConnected) searchReturnFocus.focus();
}

function resetSearchResults() {
  ++searchRequest;
  results = []; selected = 0; searchOffset = 0; searchTotal = 0;
  $("#search-results").replaceChildren();
  $("#search-more").hidden = true;
  $("#search-more").disabled = true;
  $("#search-summary").textContent = "Searching…";
}
async function runSearch(append = false) {
  if (!append) resetSearchResults();
  const q = $("#search").value.trim();
  const request = ++searchRequest;
  const params = new URLSearchParams({ q, visibility: $("#search-scope").value, limit: "30", offset: String(searchOffset) });
  $("#search-more").disabled = true;
  $("#search-summary").textContent = "Searching…";
  try {
    const page = await api("GET", "/tasks/query?" + params);
    if (request !== searchRequest || $("#search-dialog").hidden) return;
    results = append ? [...results, ...page.tasks] : page.tasks;
    searchOffset = page.offset + page.tasks.length;
    searchTotal = page.total;
    selected = 0;
    $("#search-summary").textContent = `${results.length} of ${searchTotal} matching tasks · includes completed work · view filters do not apply`;
    $("#search-more").hidden = !page.has_more;
    $("#search-more").disabled = false;
    $("#search-results").replaceChildren(
      ...results.map((t, i) => el("button", { type: "button", class: "result" + (i === 0 ? " selected" : ""),
        onmousemove: () => select(i), onclick: () => pick(t) },
        el("span", { class: "dot", style: `background:${projectColor(t.project)}` }),
        el("span", { class: "title" }, t.title),
        el("span", { class: "meta" }, el("span", { class: "mono" }, key(t)), t.status))),
      ...(results.length ? [] : [el("div", { class: "note" }, "No tasks match this search and project visibility.")]));
  } catch (err) {
    if (request !== searchRequest) return;
    results = [];
    $("#search-results").replaceChildren(el("div", { class: "note" }, err.message));
    $("#search-summary").textContent = "Search could not finish. Try again.";
    $("#search-more").hidden = true;
  }
}

function select(i) {
  const rows = $("#search-results").querySelectorAll(".result");
  if (!rows.length) return;
  selected = (i + rows.length) % rows.length;
  rows.forEach((r, j) => r.classList.toggle("selected", j === selected));
  rows[selected].scrollIntoView({ block: "nearest" });
}

// Opens the task, in its own project unless the board shows all of them.
function pick(t) {
  closeSearch();
  if (isPortfolioRoute(state.project) || state.project !== t.project) setProject(t.project);
  openTask(t.id);
}

$("#search-open").addEventListener("click", openSearch);
$("#search").addEventListener("input", () => {
  clearTimeout(searchTimer); resetSearchResults();
  searchTimer = setTimeout(() => runSearch(), 120);
});
$("#search-scope").addEventListener("change", () => { clearTimeout(searchTimer); runSearch(); });
$("#search-more").addEventListener("click", () => runSearch(true));
$("#search-close").addEventListener("click", closeSearch);
$("#search-dialog").addEventListener("keydown", (e) => { if (e.key === "Escape") { e.stopPropagation(); closeSearch(); } });
$("#search").addEventListener("keydown", (e) => {
  if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); select(selected + (e.key === "ArrowDown" ? 1 : -1)); }
  else if (e.key === "Enter" && results[selected]) { e.preventDefault(); pick(results[selected]); }
  else if (e.key === "Escape") { e.stopPropagation(); closeSearch(); }
});
$("#search-dialog").addEventListener("mousedown", (e) => { if (e.target.id === "search-dialog") closeSearch(); });

// ---------- keyboard, polling, start ----------

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && document.querySelector("dialog[open]")) return;
  const typing = e.target.closest("input, textarea, select");
  if (e.key === "Escape" && state.menu) { closeMenu(); return; }
  if (e.key === "Escape" && state.task && !typing) closeTask();
  if ((e.key === "/" && !typing && !e.metaKey && !e.ctrlKey) || (e.key === "k" && (e.metaKey || e.ctrlKey))) {
    e.preventDefault();
    openSearch();
  }
  if (e.key === "n" && !typing && !e.metaKey && !e.ctrlKey) {
    if (!$("#new-task").hidden) { e.preventDefault(); newTask(); }
  }
});

window.addEventListener("hashchange", () => {
  const { slug, task } = readHash();
  if ((slug || "@dashboard") !== state.project) setProject(slug || "@dashboard");
  if (task && task !== state.task) openTask(task);
  else if (!task && state.task) closeTask();
});

// Agents change the board through `kanzo mcp`; a cheap counter tells us when.
async function poll() {
  if (document.hidden) return schedulePoll();
  try {
    const { changes } = await api("GET", "/changes");
    $("#offline").hidden = true;
    if (changes !== state.changes) {
      state.changes = changes;
      await loadBoard();
      if (state.task) refreshTask();
    }
  } catch {
    $("#offline").hidden = false;
  }
  schedulePoll();
}

// The next check starts only after this one finished, so a slow or busy server
// never piles up requests.
function schedulePoll() {
  setTimeout(poll, 2000);
}
schedulePoll();

// ---------- sync ----------

// Sync runs `kanzo sync`: it commits the board and pulls or pushes it through the data
// folder's git remote. When both machines changed it, the board asks which to keep.
let syncing = false;

async function syncNow(keep) {
  if (syncing) return;
  syncing = true;
  toast("Syncing…");
  let diverged = null;
  try {
    const res = await fetch("/api/sync", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ keep }) });
    const reply = await res.json().catch(() => ({}));
    if (res.ok) { toast(reply.message); loadBoard(); }
    else if (reply.diverged) diverged = reply;
    else toast(reply.error || res.statusText);
  } catch (err) { toast(err.message); }
  syncing = false;
  if (diverged) chooseSide(diverged);
}

function chooseSide({ first }) {
  const repo = repoName(syncRemote);
  if (first) {
    // A repo another machine already syncs with: most likely, this machine is joining it.
    if (confirm(`${repo} already has a board. Use it on this machine?\n\nThis machine's current board is kept in kanzo.db.bak.`)) syncNow("remote");
    else if (confirm(`Replace the board in ${repo} with this machine's board instead?`)) syncNow("local");
    return;
  }
  if (confirm("This machine and another one both changed the board since the last sync, and boards can't be merged.\n\nKeep THIS machine's board, and overwrite the other one?")) syncNow("local");
  else if (confirm("Take the other machine's board instead? This machine's board is kept in kanzo.db.bak.")) syncNow("remote");
}

// The repo the board syncs with; null before it's set up.
let syncRemote = null;

// "you/kanzo-data" from any of its URLs.
function repoName(url) {
  return (url || "").replace(/\.git$/, "").split(/[/:]/).filter(Boolean).slice(-2).join("/");
}

async function loadSyncRemote() {
  try { syncRemote = (await api("GET", "/sync")).remote; } catch {}
  return syncRemote;
}

// Sync asks for a repo, in Settings, the first time.
async function sync() {
  closeMenu();
  if (await loadSyncRemote()) syncNow();
  else openSettings("sync");
}

$("#sync-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const save = $("#sync-save");
  save.disabled = true;
  save.textContent = "Checking…";
  try {
    const res = await fetch("/api/sync", { method: "PUT", headers: { "Content-Type": "application/json" },
                                           body: JSON.stringify({ url: $("#sync-url").value }) });
    const reply = await res.json().catch(() => ({}));
    if (res.ok) {
      syncRemote = reply.remote;
      closeSettings();
      syncNow();
    } else {
      $("#sync-error").textContent = reply.error || res.statusText;
      $("#sync-error").hidden = false;
    }
  } catch (err) {
    $("#sync-error").textContent = err.message;
    $("#sync-error").hidden = false;
  }
  save.disabled = false;
  save.textContent = "Save and sync";
});

// ---------- menu and settings ----------

// The Settings button at the bottom of the sidebar opens a menu, as in Claude: Settings,
// Check for updates and Sync.
function toggleSettingsMenu() {
  const wasOpen = state.menu === "settings";
  closeMenu();
  if (wasOpen || !state.board) return;
  state.menu = "settings";
  const button = $("#settings");
  button.classList.add("open");
  const menu = el("div", { class: "menu", role: "menu", tabindex: "-1" },
    el("button", { onclick: () => openSettings() }, icon("settings"), "Settings"),
    el("button", { onclick: () => { closeMenu(); checkForUpdates(); } }, icon("update"), "Check for updates",
      el("span", { class: "value" }, `v${state.board.version}`)),
    el("button", { onclick: sync }, icon("sync"), "Sync"));
  document.body.append(menu);
  const r = button.getBoundingClientRect();
  menu.style.width = `${r.width}px`;
  menu.style.left = `${r.left}px`;
  menu.style.top = `${r.top - 6 - menu.offsetHeight}px`;
  menu.focus();
}

$("#settings").addEventListener("click", toggleSettingsMenu);

// The settings window, as in Claude's: categories on the left, their settings on the right.
function openSettings(section = "board") {
  closeMenu();
  $("#settings-backlog").checked = state.board?.statuses.includes("backlog") ?? false;
  $("#sync-url").value = syncRemote || "";
  $("#sync-create").hidden = !!syncRemote;
  $("#sync-error").hidden = true;
  $("#settings-version").textContent = state.board ? `Kanzo ${state.board.version}` : "";
  showSection(section);
  $("#settings-dialog").hidden = false;
  if (section === "sync") $("#sync-url").focus();
  else $("#settings-close").focus();
}

function showSection(section) {
  document.querySelectorAll("#settings-nav button").forEach((b) => b.classList.toggle("active", b.dataset.section === section));
  document.querySelectorAll(".settings-pane").forEach((p) => { p.hidden = p.dataset.section !== section; });
}

function closeSettings() {
  $("#settings-dialog").hidden = true;
}

$("#settings-nav").addEventListener("click", (e) => {
  const b = e.target.closest("button");
  if (b) showSection(b.dataset.section);
});
$("#settings-close").addEventListener("click", closeSettings);
$("#settings-dialog").addEventListener("mousedown", (e) => { if (e.target.id === "settings-dialog") closeSettings(); });
$("#settings-dialog").addEventListener("keydown", (e) => { if (e.key === "Escape") { e.stopPropagation(); closeSettings(); } });
$("#settings-backlog").addEventListener("change", async (e) => {
  const box = e.target;
  try {
    await api("PATCH", "/settings", { backlog: box.checked });
    loadBoard();
  } catch (err) { box.checked = !box.checked; toast(err.message); }
});
$("#settings-update").addEventListener("click", checkForUpdates);

// ---------- update ----------

// Kanzo checks GitHub for a newer release once a day and offers it at the bottom of the
// sidebar; its menu asks right away. Installing replaces the running board and
// restarts it, and the page reloads once it's back.
async function checkUpdate() {
  try {
    showUpdate(await api("GET", "/update"));
  } catch {}
}

function showUpdate({ current, available }) {
  const button = $("#update");
  button.hidden = !available;
  if (!available) return;
  $("#update-label").textContent = `Update to ${available}`;
  button.title = `You have ${current}`;
  button.onclick = () => {
    if (confirm(`Update Kanzo from ${current} to ${available}? The board restarts, which takes a few seconds.`)) installUpdate(available);
  };
}

async function checkForUpdates() {
  toast("Checking for updates…");
  try {
    const status = await api("GET", "/update?now=1");
    showUpdate(status);
    if (status.available) {
      if (confirm(`Kanzo ${status.available} is out (you have ${status.current}). Download and install it now? The board restarts.`)) {
        installUpdate(status.available);
      }
    } else if (status.latest) {
      toast(`Kanzo is up to date (${status.current})`);
    } else {
      toast("Can't reach GitHub to check for updates");
    }
  } catch (err) { toast(err.message); }
}

async function installUpdate(available) {
  const button = $("#update");
  button.hidden = false;
  button.disabled = true;
  $("#update-label").textContent = "Updating…";
  try {
    await api("POST", "/update");
  } catch (err) {
    toast(err.message);
    button.disabled = false;
    $("#update-label").textContent = `Update to ${available}`;
    return;
  }
  // The old program answered, then gives way to the new one: wait for it, then reload.
  await new Promise((r) => setTimeout(r, 1500));
  for (let i = 0; i < 60; i++) {
    try { await api("GET", "/update"); break; } catch { await new Promise((r) => setTimeout(r, 1000)); }
  }
  location.reload();
}


// ---------- native planning workspace ----------
const PROFILE_DEFAULTS = { category: "Needs classification", visibility: "review", goal: "", source_path: "", source_revision: "", allowed_scope: "", acceptance: "", budget: "", instructions: [], skills: [], memories: [], context_notes: "" };
const PLAN_DEFAULTS = { parent_id: null, depends_on: [], planned_start: null, planned_end: null, due_date: null, estimate_seconds: null, owner: "", deliverable: "", acceptance: "", allowed_scope: "", budget: "", context_links: [] };
function profileFor(slug) {
  const source = state.harness?.profiles?.[slug] || {};
  return Object.fromEntries(Object.entries(PROFILE_DEFAULTS).map(([k, v]) => [k, source[k] ?? (Array.isArray(v) ? [] : v)]));
}
function planFor(id) {
  const source = state.harness?.plans?.[String(id)] || {};
  return Object.fromEntries(Object.entries(PLAN_DEFAULTS).map(([k, v]) => [k, source[k] ?? (Array.isArray(v) ? [] : v)]));
}
function taskById(id) { return state.board?.tasks.find((t) => t.id === Number(id)); }
function allActiveTasks() {
  const projects = new Set(scopeProjects("active").filter((p) => !state.typeFilter || profileFor(p.slug).category === state.typeFilter).map((p) => p.slug));
  return (state.board?.tasks || []).filter((t) => projects.has(t.project) && matchesTaskFilters(t));
}
function childrenOf(id) { return (state.board?.tasks || []).filter((t) => planFor(t.id).parent_id === id); }
function activeLeaves() { return allActiveTasks().filter((t) => !childrenOf(t.id).length); }
function taskTitle(t) { return t.title.replace(/^\[[^\]]+\]\s*/, ""); }
function countBy(items, fn) { const counts = {}; for (const item of items) { const name = fn(item); counts[name] = (counts[name] || 0) + 1; } return counts; }
function dateISO() { return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Bangkok", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date()); }
function addDays(iso, n) { const d = new Date(iso + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
function instantDay(value) { const parsed = new Date(value); return Number.isNaN(parsed.getTime()) ? null : new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Bangkok", year: "numeric", month: "2-digit", day: "2-digit" }).format(parsed); }
function scheduleOccurs(plan, day) { const start = plan.planned_start || plan.planned_end; const end = plan.planned_end || plan.planned_start; return plan.due_date === day || !!(start && end && start <= day && end >= day); }
function dayDiff(a, b) { return Math.round((new Date(a + "T12:00:00Z") - new Date(b + "T12:00:00Z")) / 86400000); }
function weekDays() { const today = dateISO(), day = new Date(today + "T12:00:00Z").getUTCDay(); const start = addDays(today, -((day + 6) % 7) + state.weekOffset * 7); return Array.from({ length: 7 }, (_, i) => addDays(start, i)); }
function displayDay(iso, options = {}) { return new Date(iso + "T12:00:00Z").toLocaleDateString(undefined, { timeZone: "UTC", day: "numeric", month: "short", ...options }); }
function shortDuration(seconds) {
  const n = Math.max(0, Math.round(Number(seconds) || 0)), h = Math.floor(n / 3600), m = Math.floor(n % 3600 / 60);
  return h ? `${h}h ${m}m` : m ? `${m}m` : `${n}s`;
}
function mergeTimeEntries(entries, extra = []) { return [...new Map([...entries, ...extra].map((entry) => [String(entry.id), entry])).values()]; }
function timeEntries(taskId) { return mergeTimeEntries(state.harness?.time_entries || [], state.harness?.active_timers || []).filter((entry) => taskId == null || entry.task_id === taskId); }
function completedSeconds(entries) { return entries.reduce((n, e) => n + (e.ended_at && Number.isFinite(e.seconds) ? e.seconds : 0), 0); }
function recordedSecondsForTasks(taskIds, actor = "human") {
  const ids = new Set(taskIds), totals = state.harness?.time_totals?.by_task;
  if (totals) return [...ids].reduce((n, id) => n + Number(totals[String(id)]?.by_actor?.[actor] || 0), 0);
  return completedSeconds(timeEntries().filter((entry) => ids.has(entry.task_id) && entry.actor === actor));
}
function runningTimer() { return timeEntries().find((e) => e.actor === "human" && !e.ended_at && e.kind === "timer") || null; }
function elapsedSeconds(entry) { const t = new Date(entry.started_at).getTime(); return Number.isFinite(t) ? Math.max(0, Math.floor((Date.now() - t) / 1000)) : 0; }
function taskButton(t, extra = {}) { return el("button", { class: "work-task-link", onclick: () => { setProject(t.project); openTask(t.id); }, ...extra }, el("span", { class: "project-dot", style: `--project-color:${projectColor(t.project)}` }), el("span", { class: "work-task-title" }, taskTitle(t))); }
function scheduleTaskButton(task) { const button = taskButton(task); if (childrenOf(task.id).length) button.append(el("span", { class: "status-pill" }, "Summary")); return button; }
function sectionHead(title, aside) { return el("div", { class: "workspace-card-head" }, el("h2", {}, title), aside || null); }
function emptyState(title, text, action) { return el("div", { class: "workspace-empty" }, icon("info"), el("strong", {}, title), el("p", {}, text), action || null); }
function filterBoard({ category = "", status = "" } = {}) { state.typeFilter = category; state.statusFilter = status; setProject("all"); }
function chartRows(entries, denominator, onPick, colors) {
  const max = Math.max(1, ...entries.map(([, n]) => n));
  return el("div", { class: "chart-rows" }, ...entries.map(([label, n], i) =>
    el("button", { class: "chart-row", onclick: () => onPick(label), "aria-label": `${label}: ${n} of ${denominator}` },
      el("span", { class: "chart-label" }, label), el("span", { class: "chart-track" }, el("span", { class: "chart-fill", style: `width:${n / max * 100}%;--chart-color:${colors[i % colors.length]}` })), el("span", { class: "chart-value" }, String(n)))));
}
function renderWorkspaceView() {
  renderDateControls(); renderTimerIndicator();
  if (state.project === "@dashboard") renderPlanningDashboard();
  else if (state.project === "@timeline") $("#dashboard").replaceChildren(timelinePanel(false));
  else if (state.project === "@calendar") renderCalendar();
  else if (state.project === "@time") renderTimeView();
  else renderProjectList();
}
function renderDateControls() {
  const root = $("#view-date-controls");
  if (!["@dashboard", "@timeline", "@calendar"].includes(state.project)) { root.replaceChildren(); return; }
  const month = state.project === "@calendar", days = weekDays();
  const anchor = new Date(dateISO() + "T12:00:00Z"); anchor.setUTCMonth(anchor.getUTCMonth() + state.monthOffset, 1);
  const label = month ? anchor.toLocaleDateString(undefined, { month: "long", year: "numeric", timeZone: "UTC" }) : `${displayDay(days[0])} – ${displayDay(days[6], { year: "numeric" })}`;
  const step = (n) => { if (month) state.monthOffset += n; else state.weekOffset += n; renderWorkspaceView(); };
  root.replaceChildren(el("button", { class: "btn quiet", onclick: () => { state.weekOffset = 0; state.monthOffset = 0; renderWorkspaceView(); } }, month ? "This month" : "This week"),
    el("div", { class: "date-stepper" }, el("button", { class: "btn quiet", "aria-label": "Previous period", onclick: () => step(-1) }, "‹"), el("button", { class: "btn quiet", "aria-label": "Next period", onclick: () => step(1) }, "›")), el("span", { class: "date-label" }, label));
}
function renderPlanningDashboard() {
  const projects = scopeProjects("active").filter((p) => !state.typeFilter || profileFor(p.slug).category === state.typeFilter), tasks = activeLeaves(), containers = allActiveTasks().length - tasks.length;
  const statuses = state.board.statuses.map((s) => [s, tasks.filter((t) => t.status === s).length]);
  const types = Object.entries(countBy(projects, (p) => profileFor(p.slug).category)).sort((a, b) => b[1] - a[1]);
  const activeIds = new Set(allActiveTasks().map((t) => t.id));
  const entries = timeEntries().filter((e) => activeIds.has(e.task_id) && e.actor === "human");
  const logged = recordedSecondsForTasks(activeIds), openTimer = runningTimer();
  const metric = (symbol, value, label, note) => el("div", { class: "planning-metric" }, icon(symbol), el("div", {}, el("strong", {}, String(value)), el("span", {}, label), note ? el("small", {}, note) : null));
  const stats = el("section", { class: "planning-metrics", "aria-label": "Portfolio summary" },
    metric("folder", projects.length, "Active projects", hasTaskFilters() ? "Project count uses the type filter" : ""), metric("list", tasks.filter((t) => t.status !== "done").length, "Open leaf tasks", `${containers} summary containers`),
    metric("calendar", tasks.filter((t) => t.status === "todo").length, "Todo work", "Dependencies are checked before execution"),
    metric("clock", logged ? shortDuration(logged) : "No time entries", "Recorded human work", openTimer ? "A human timer is running" : "Estimates are separate"));
  const statusCard = el("section", { class: "workspace-card" }, sectionHead("Current task states", el("span", { class: "denominator" }, `${tasks.length} leaf tasks`)), chartRows(statuses, tasks.length, (status) => filterBoard({ status }), ["var(--teal)", "var(--blue)", "var(--amber)", "var(--purple)", "var(--gray)"]));
  const typesCard = el("section", { class: "workspace-card" }, sectionHead("Active projects by type"), chartRows(types, projects.length, (category) => filterBoard({ category }), ["var(--purple)", "var(--blue)", "var(--teal)", "var(--amber)", "var(--gray)"]));
  const days = weekDays(), scheduled = allActiveTasks().filter((t) => { const p = planFor(t.id); return p.planned_start || p.planned_end || p.due_date; });
  const agenda = el("section", { class: "workspace-card weekly-agenda" }, sectionHead("Weekly agenda"), el("p", { class: "workspace-subtitle" }, `${displayDay(days[0])} – ${displayDay(days[6])} · Asia/Bangkok`),
    ...days.map((day) => { const mine = scheduled.filter((t) => { const p = planFor(t.id); return scheduleOccurs(p, day); });
      return el("div", { class: "agenda-day" }, el("div", { class: "agenda-date" }, el("strong", {}, displayDay(day, { weekday: "short", day: undefined, month: undefined })), el("small", {}, displayDay(day))), el("div", { class: "agenda-tasks" }, ...mine.slice(0, 3).map((t) => el("div", {}, scheduleTaskButton(t), el("small", {}, planFor(t.id).due_date === day ? "Due date" : "Planned · all day"))),
        ...(mine.length > 3 ? [el("button", { class: "text-button agenda-more", onclick: () => setProject("@timeline") }, `+${mine.length - 3} more · View full week`)] : []), ...(!mine.length ? [el("span", { class: "agenda-empty" }, "—")] : []))); }));
  const timeCard = el("section", { class: "workspace-card time-summary" }, sectionHead("Time tracking"),
    logged > 0 || entries.length ? el("div", { class: "time-total" }, icon("clock"), el("strong", {}, shortDuration(logged)), el("span", {}, "Recorded human effort")) : emptyState("No entries yet", "Estimates and actual time are separate.", null),
    el("button", { class: "btn primary", onclick: () => showTimeDialog() }, "Add time entry"));
  $("#dashboard").replaceChildren(stats, el("div", { class: "overview-grid" }, el("div", { class: "overview-main" }, el("div", { class: "overview-charts" }, statusCard, typesCard), timelinePanel(true), completionPanel(tasks)), el("div", { class: "overview-side" }, agenda, timeCard)));
}
function timelinePanel(compact) {
  const days = weekDays(), tasks = allActiveTasks();
  const scheduled = tasks.filter((t) => days.some((day) => scheduleOccurs(planFor(t.id), day)));
  const unscheduled = activeLeaves().filter((t) => { const p = planFor(t.id); return !p.planned_start && !p.planned_end && !p.due_date; });
  const page = compact ? null : paginationWindow("timeline", scheduled), shown = compact ? scheduled.slice(0, 6) : page.items;
  const grid = el("div", { class: "timeline-grid", role: "table", "aria-label": "Planned tasks this week" }, el("div", { class: "timeline-label timeline-head", role: "columnheader" }, "Task"), ...days.map((d) => el("div", { class: "timeline-head", role: "columnheader" }, displayDay(d, { weekday: "short", month: undefined }))));
  for (const t of shown) {
    const p = planFor(t.id);
    grid.append(el("div", { class: "timeline-label", role: "rowheader" }, scheduleTaskButton(t)));
    for (const day of days) grid.append(el("div", { class: "timeline-cell", role: "cell" }, scheduleOccurs(p, day) ? el("button", { class: "timeline-bar" + (p.due_date === day ? " due" : ""), style: `--project-color:${projectColor(t.project)}`, "aria-label": `${childrenOf(t.id).length ? "Summary · " : ""}${taskTitle(t)}: ${displayDay(day)}`, onclick: () => showSchedule(t) }, p.due_date === day && !p.planned_start ? "◆" : "") : null));
  }
  if (!scheduled.length) grid.append(el("div", { class: "timeline-empty" }, "No tasks scheduled for this week. Add dates to show the plan here."));
  const tray = el("div", { class: "unscheduled-tray" }, icon("list"), el("div", {}, el("strong", {}, `Unscheduled leaf tasks · ${unscheduled.length}`), el("p", {}, "These tasks do not have dates yet. Schedule them when you are ready.")),
    el("button", { class: "btn quiet", onclick: () => { if (compact) setProject("@timeline"); else { state.unscheduledExpanded = !state.unscheduledExpanded; renderWorkspaceView(); } } }, compact ? "View unscheduled ›" : state.unscheduledExpanded ? "Hide tasks" : "Show tasks"));
  const panel = el("section", { class: "workspace-card timeline-panel" }, sectionHead(compact ? "Timeline preview" : "Weekly timeline", el("span", { class: "denominator" }, compact ? `${shown.length} of ${scheduled.length} scheduled tasks` : "Saved plan dates")),
    el("p", { class: "workspace-subtitle" }, `${displayDay(days[0])} – ${displayDay(days[6])} · Asia/Bangkok`), page ? renderPager(page, "scheduled tasks") : null, el("div", { class: "timeline-scroll" }, grid),
    compact ? el("button", { class: "btn quiet view-all-timeline", onclick: () => setProject("@timeline") }, "View full timeline") : null, tray);
  if (!compact) {
    const pendingPage = paginationWindow("unscheduled", unscheduled);
    panel.append(el("div", { id: "unscheduled-list", class: "unscheduled-list", hidden: !state.unscheduledExpanded }, renderPager(pendingPage, "unscheduled tasks"),
      ...pendingPage.items.map((t) => el("div", { class: "schedule-list-row" }, taskButton(t), el("button", { class: "btn quiet", onclick: () => showSchedule(t) }, "Schedule")))));
  }
  return panel;
}

function completionPanel(tasks) {
  const ids = new Set(tasks.map((t) => t.id)), accepted = (state.harness.events || []).filter((e) => e.kind === "accepted" && ids.has(e.task_id));
  if (!accepted.length) return el("section", { class: "workspace-card completion-history" }, sectionHead("Accepted completion history"), el("p", { class: "workspace-subtitle" }, state.harness.history_window?.events?.truncated ? "No accepted completions in the returned event window. Earlier history is outside this view." : "No accepted completions recorded yet. History starts when evidence is accepted; earlier task updates are not backfilled."));
  const days = weekDays(), counts = days.map((d) => [d, accepted.filter((e) => instantDay(e.at) === d).length]);
  return el("section", { class: "workspace-card" }, sectionHead("Accepted completion events", el("span", { class: "denominator" }, state.harness.history_window?.events?.truncated ? "Latest 500 recorded events" : "Recorded events only")), chartRows(counts.map(([d, n]) => [displayDay(d), n]), accepted.length, () => {}, ["var(--teal)"]));
}
function renderProjectList() {
  if (state.project === "@planning") {
    const tasks = activeLeaves().filter((t) => t.status === "todo"), page = paginationWindow("planning", tasks);
    $("#dashboard").replaceChildren(el("p", { class: "workspace-subtitle" }, "Todo leaf tasks. Dependencies, source scope and acceptance are checked before execution."),
      renderPager(page, "planning tasks"), el("section", { class: "workspace-card task-list" },
        ...page.items.map((t) => el("div", { class: "project-list-row" }, taskButton(t), el("span", { class: "status-pill" }, t.status), el("button", { class: "btn quiet", onclick: () => showSchedule(t) }, "Plan dates"))),
        ...(!tasks.length ? [emptyState("No todo work", "Select a project to plan the next concrete task.")] : [])));
    return;
  }
  const projects = visibleProjects().slice().sort((a, b) => profileFor(a.slug).category.localeCompare(profileFor(b.slug).category)
    || a.name.localeCompare(b.name) || a.slug.localeCompare(b.slug));
  const page = paginationWindow("projects", projects), dashboard = $("#dashboard");
  let toolbar = dashboard.querySelector(".project-list-toolbar");
  if (!toolbar) {
    const query = el("input", { class: "field", id: "project-query", type: "search", maxlength: 300,
      placeholder: "Search projects by name, repository or type…", "aria-label": "Search projects" });
    query.addEventListener("input", (event) => {
      state.projectQuery = event.target.value;
      $("#project-filter").value = state.projectQuery;
      renderNav(); renderProjectList();
    });
    toolbar = el("div", { class: "project-list-toolbar" }, el("p", { class: "workspace-subtitle" }), query);
    dashboard.replaceChildren(toolbar);
  }
  const query = toolbar.querySelector("#project-query");
  if (document.activeElement !== query) query.value = state.projectQuery;
  toolbar.querySelector("p").textContent = state.scope === "active"
    ? "Active projects, grouped by type. Search first, then browse a page at a time."
    : "History is preserved. Restore a project when its work should return to active planning.";
  // Retain the toolbar node: filtering must not detach a focused search field or reset its caret.
  for (const child of [...dashboard.children]) if (child !== toolbar) child.remove();
  dashboard.append(renderPager(page, "projects"),
    ...[...new Set(page.items.map((p) => profileFor(p.slug).category))].map((category) => el("section", { class: "workspace-card project-list" }, sectionHead(category),
      ...page.items.filter((p) => profileFor(p.slug).category === category).map((p) => el("div", { class: "project-list-row" },
        el("a", { href: "#" + p.slug, onclick: (event) => { event.preventDefault(); setProject(p.slug); } }, icon("folder", projectColor(p.slug)), el("strong", {}, p.name), el("small", {}, `${p.open} open tasks`)),
        el("button", { class: "btn quiet", onclick: () => showProjectProfile(p) }, "Project brief"), el("button", { class: "filter-chip", onclick: () => showCategoryDialog(p) }, "Categorize"))))),
    ...(!projects.length ? [emptyState("No matching projects", "Clear the project search or type filter to see more projects.")] : []));
}

function renderCalendar() {
  const today = dateISO(), anchor = new Date(today + "T12:00:00Z"); anchor.setUTCMonth(anchor.getUTCMonth() + state.monthOffset, 1);
  const first = anchor.toISOString().slice(0, 10), start = addDays(first, -((anchor.getUTCDay() + 6) % 7));
  const days = Array.from({ length: 42 }, (_, i) => addDays(start, i)), tasks = allActiveTasks();
  const grid = el("div", { class: "calendar-grid", role: "grid", "aria-label": "Saved task schedule" }, ...["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => el("div", { class: "calendar-weekday", role: "columnheader" }, d)));
  for (const day of days) {
    const mine = tasks.filter((t) => { const p = planFor(t.id); return scheduleOccurs(p, day); });
    grid.append(el("div", { class: "calendar-day" + (day.slice(0, 7) !== first.slice(0, 7) ? " other-month" : "") + (day === today ? " today" : ""), role: "gridcell", "aria-label": displayDay(day, { year: "numeric" }) }, el("span", { class: "calendar-number" }, String(Number(day.slice(8)))),
      ...mine.map((t) => el("button", { class: "calendar-task", style: `--project-color:${projectColor(t.project)}`, title: `${t.project} · ${taskTitle(t)}`, "aria-label": `${key(t)} · ${taskTitle(t)}`, onclick: () => { setProject(t.project); openTask(t.id); } }, planFor(t.id).due_date === day ? "◆ " : "", childrenOf(t.id).length ? "Summary · " : "", taskTitle(t)))));
  }
  const unscheduled = activeLeaves().filter((t) => { const p = planFor(t.id); return !p.planned_start && !p.planned_end && !p.due_date; });
  $("#dashboard").replaceChildren(el("p", { class: "workspace-subtitle" }, "All-day plans and due dates · Asia/Bangkok. Select a task for its full details. Summary milestones and leaf tasks use the same dates as Timeline."), el("section", { class: "workspace-card calendar-panel" }, grid), el("p", { class: "workspace-subtitle" }, `${unscheduled.length} leaf tasks are unscheduled and remain visible in Timeline.`));
}
function renderTimeView() {
  const tasks = allActiveTasks(), ids = new Set(tasks.map((t) => t.id)), entries = timeEntries().filter((e) => ids.has(e.task_id)), human = entries.filter((e) => e.actor === "human"), leaves = activeLeaves(), parentIds = new Set(tasks.filter((t) => childrenOf(t.id).length).map((t) => t.id));
  const leafIds = new Set(leaves.map((t) => t.id)), estimated = leaves.filter((t) => planFor(t.id).estimate_seconds != null), estimate = estimated.reduce((n, t) => n + planFor(t.id).estimate_seconds, 0);
  const controls = el("div", { class: "time-view-controls" }, el("p", { class: "workspace-subtitle" }, "Estimates, recorded human work and agent intervals are kept separate."), el("button", { class: "btn primary", onclick: () => showTimeDialog() }, "Add time entry"));
  const totals = el("div", { class: "planning-metrics time-metrics" }, ...[["Estimated leaf work", shortDuration(estimate), `${estimated.length} of ${leaves.length} leaf tasks estimated`], ["Recorded human work", shortDuration(recordedSecondsForTasks(ids)), "All-history closed human entries"], ["Direct coordination", shortDuration(recordedSecondsForTasks(parentIds)), "Parent-task effort, included once"], ["Running timer", runningTimer() ? "Active" : "None", "One human timer across sessions"]].map(([label, value, note]) => el("div", { class: "planning-metric" }, icon("clock"), el("div", {}, el("strong", {}, value), el("span", {}, label), el("small", {}, note)))));
  const byProject = scopeProjects("active").map((p) => { const mine = leaves.filter((t) => t.project === p.slug), myIds = new Set(mine.map((t) => t.id)); return { p, estimate: mine.reduce((n, t) => n + (planFor(t.id).estimate_seconds || 0), 0), hasEstimate: mine.some((t) => planFor(t.id).estimate_seconds != null), actual: recordedSecondsForTasks(myIds) }; }).filter((p) => p.hasEstimate || p.actual);
  const comparisons = el("section", { class: "workspace-card" }, sectionHead("Estimated and recorded leaf work"), ...byProject.map(({ p, estimate, hasEstimate, actual }) => { const max = Math.max(estimate, actual, 1); return el("div", { class: "time-comparison" }, el("strong", {}, p.name), el("div", { class: "effort-row" }, el("span", {}, "Estimate"), el("span", { class: "chart-track" }, el("span", { class: "chart-fill", style: `width:${estimate / max * 100}%;--chart-color:var(--purple)` })), el("span", {}, hasEstimate ? shortDuration(estimate) : "Not set")), el("div", { class: "effort-row" }, el("span", {}, "Recorded"), el("span", { class: "chart-track" }, el("span", { class: "chart-fill", style: `width:${actual / max * 100}%;--chart-color:var(--teal)` })), el("span", {}, shortDuration(actual)))); }), ...(!byProject.length ? [emptyState("No comparison yet", "Enter an estimate or record time to compare real values.")] : []));
  const timer = runningTimer(), history = entries.filter((entry) => entry.id !== timer?.id).slice().reverse(), page = paginationWindow("time", history);
  const pinned = timer ? el("section", { class: "workspace-card pinned-timer" }, sectionHead("Running human timer"),
    ...(!ids.has(timer.task_id) ? [el("p", { class: "workspace-subtitle" }, "This timer is outside the current task filters.")] : []), timeEntryRow(timer)) : null;
  const rows = el("section", { class: "workspace-card" }, sectionHead("Time entries", state.harness.history_window?.time_entries?.truncated ? el("span", { class: "denominator" }, "Latest 500 entries · totals use all history") : null),
    renderPager(page, "time entries"), ...(history.length ? page.items.map((entry) => timeEntryRow(entry)) : [emptyState("No entries yet", "Start a timer on a task, or add an explicit manual entry.")]));
  $("#dashboard").replaceChildren(controls, totals, ...(pinned ? [pinned] : []), comparisons, rows);
}
function timeEntryRow(entry) {
  const task = taskById(entry.task_id), running = !entry.ended_at;
  return el("div", { class: "time-entry-row" }, task ? taskButton(task) : el("span", {}, `Task #${entry.task_id}`), el("span", { class: "status-pill" }, `${entry.actor} · ${entry.kind}`), el("span", { class: "duration", "data-timer-id": running ? entry.id : null }, running ? shortDuration(elapsedSeconds(entry)) + " running" : shortDuration(entry.seconds)), el("small", {}, entry.note || ""), running && entry.actor === "human" ? el("button", { class: "btn quiet", onclick: () => stopTimer(entry) }, "Stop") : null);
}


// ---------- project briefs, task plans, context and explicit time ----------
function inputField(label, name, value = "", type = "text", hint = "") {
  const control = type === "textarea" ? el("textarea", { class: "field", name, rows: 3 }) : el("input", { class: "field", name, type });
  control.value = value ?? "";
  if (type === "number") { control.setAttribute("step", "any"); control.setAttribute("min", "0"); }
  const wrapper = el("label", { class: "form-field" }, el("span", {}, label), control, hint ? el("small", {}, hint) : null);
  return wrapper;
}
function formValue(form, name) { return form.elements.namedItem(name)?.value.trim() || ""; }
let workDialogSave = null;
function openWorkDialog(title, fields, onSave, label = "Save") {
  $("#work-dialog-title").textContent = title;
  $("#work-dialog-fields").replaceChildren(...fields);
  $("#work-dialog-error").hidden = true;
  $("#work-dialog-save").textContent = label;
  workDialogSave = onSave;
  $("#work-dialog").showModal();
  $("#work-dialog-fields").querySelector("input,select,textarea")?.focus();
}
$("#work-dialog-close").addEventListener("click", () => $("#work-dialog").close());
$("#work-dialog-cancel").addEventListener("click", () => $("#work-dialog").close());
$("#work-dialog-form").addEventListener("submit", async (event) => {
  event.preventDefault(); if (!workDialogSave) return;
  const button = $("#work-dialog-save"); button.disabled = true;
  try { await workDialogSave(event.currentTarget); $("#work-dialog").close(); await loadBoard(); if (state.task) await refreshTask(); }
  catch (err) { $("#work-dialog-error").textContent = err.message; $("#work-dialog-error").hidden = false; }
  finally { button.disabled = false; }
});
function showProjectProfile(project) {
  const p = profileFor(project.slug);
  const fields = [inputField("Project goal", "goal", p.goal, "textarea"), el("div", { class: "form-grid" }, inputField("Source path / repository", "source_path", p.source_path), inputField("Source revision", "source_revision", p.source_revision)),
    inputField("Allowed scope", "allowed_scope", p.allowed_scope, "textarea"), inputField("Acceptance / current gate", "acceptance", p.acceptance, "textarea"), inputField("Resource / attempt budget", "budget", p.budget),
    inputField("Project instructions", "instructions", p.instructions.join("\n"), "textarea", "Selected paths or references, one per line."), inputField("Relevant skills", "skills", p.skills.join("\n"), "textarea", "Skill names or paths, one per line."),
    inputField("Dated memory references", "memories", p.memories.join("\n"), "textarea", "References only. Stored notes do not establish current state."), inputField("Context notes", "context_notes", p.context_notes, "textarea")];
  openWorkDialog(`${project.name} · project brief`, fields, async (form) => {
    const next = { ...p };
    for (const key of ["goal", "source_path", "source_revision", "allowed_scope", "acceptance", "budget", "context_notes"]) next[key] = formValue(form, key);
    for (const key of ["instructions", "skills", "memories"]) next[key] = formValue(form, key).split("\n").map((v) => v.trim()).filter(Boolean);
    await api("PUT", `/projects/${encodeURIComponent(project.slug)}/profile`, next); toast("Project brief saved.");
  });
}
function showSchedule(task) {
  const plan = planFor(task.id);
  openWorkDialog(`Schedule · ${taskTitle(task)}`, [el("p", { class: "workspace-subtitle" }, "All-day dates · Asia/Bangkok. Timeline and Calendar share this plan."),
    el("div", { class: "form-grid" }, inputField("Planned start", "planned_start", plan.planned_start, "date"), inputField("Planned end", "planned_end", plan.planned_end, "date")),
    el("div", { class: "form-grid" }, inputField("Due date", "due_date", plan.due_date, "date"), inputField("Estimated minutes", "estimate", plan.estimate_seconds == null ? "" : plan.estimate_seconds / 60, "number"))], async (form) => {
      const estimate = formValue(form, "estimate");
      if (estimate && (!Number.isFinite(Number(estimate)) || Number(estimate) < 0)) throw new Error("Estimate must be a non-negative number of minutes.");
      await api("PUT", `/tasks/${task.id}/plan`, { ...plan, planned_start: formValue(form, "planned_start") || null, planned_end: formValue(form, "planned_end") || null, due_date: formValue(form, "due_date") || null, estimate_seconds: estimate === "" ? null : Math.round(Number(estimate) * 60) });
      toast("Task schedule saved.");
    });
}
function requestId() { return globalThis.crypto?.randomUUID?.() || "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => { const r = Math.floor(Math.random() * 16); return (c === "x" ? r : (r & 3) | 8).toString(16); }); }
async function startTimer(task) {
  try { await api("POST", `/tasks/${task.id}/timer`, { actor: "human", request_id: requestId() }); await loadBoard(); if (state.task) await refreshTask(); toast("Timer started."); }
  catch (err) { toast(err.message); }
}
async function stopTimer(entry) {
  try { await api("POST", `/time/${entry.id}/stop`, { actor: "human" }); await loadBoard(); if (state.task) await refreshTask(); toast("Timer stopped; recorded time saved."); }
  catch (err) { toast(err.message); }
}
function showTimeDialog(task = null) {
  const options = (state.board?.tasks || []).filter((t) => profileFor(t.project).visibility === "active");
  if (task && !options.some((t) => t.id === task.id)) options.push(task);
  if (!options.length) { toast("Create or select a task before recording time."); return; }
  const choice = el("select", { class: "field", name: "task_id", required: true }, ...options.map((t) => el("option", { value: t.id }, `${key(t)} · ${taskTitle(t)}`)));
  if (task) choice.value = task.id;
  openWorkDialog("Add recorded human time", [el("label", { class: "form-field" }, el("span", {}, "Task"), choice), inputField("Duration in minutes", "minutes", "", "number"), inputField("Work note / source", "note", "", "textarea", "Describe the actual work represented by this entry.")], async (form) => {
    const minutes = Number(formValue(form, "minutes"));
    if (!Number.isFinite(minutes) || minutes <= 0) throw new Error("Enter a positive duration in minutes.");
    const id = Number(formValue(form, "task_id"));
    await api("POST", `/tasks/${id}/time`, { actor: "human", seconds: Math.round(minutes * 60), note: formValue(form, "note"), request_id: requestId() });
    toast("Manual time entry saved.");
  }, "Add time entry");
}
function renderTimerIndicator() {
  const entry = runningTimer(), root = $("#timer-indicator");
  if (!entry) { root.replaceChildren(); return; }
  root.replaceChildren(el("button", { class: "timer-running", onclick: () => { const task = taskById(entry.task_id); if (task) { setProject(task.project); openTask(task.id); } } }, icon("clock"), el("span", { "data-timer-id": entry.id }, shortDuration(elapsedSeconds(entry)) + " running")), el("button", { class: "timer-stop", "aria-label": "Stop human timer", onclick: () => stopTimer(entry) }, icon("stop")));
}
function setTaskTab(tab) {
  state.taskTab = tab;
  document.querySelectorAll("[data-task-tab]").forEach((button) => button.setAttribute("aria-selected", String(button.dataset.taskTab === tab)));
  document.querySelectorAll("[data-task-pane]").forEach((pane) => { pane.hidden = pane.dataset.taskPane !== tab; });
}
document.querySelectorAll("[data-task-tab]").forEach((button) => button.addEventListener("click", () => setTaskTab(button.dataset.taskTab)));
function renderTaskHarness(task, context) {
  if (!context) return;
  const profile = context.profile || profileFor(task.project), plan = { ...PLAN_DEFAULTS, ...(context.plan || planFor(task.id)) };
  $("#task-owner-chip").replaceChildren(icon("human"), el("span", {}, plan.owner || "Owner not assigned"));
  $("#task-source-chip").replaceChildren(icon("github"), el("span", {}, profile.source_revision || "Source revision not set"));
  $("#task-project-brief").replaceChildren(el("h3", {}, "Project brief"), el("p", {}, profile.goal || "No project brief recorded yet."), el("button", { class: "text-button", onclick: () => { const p = state.board.projects.find((p) => p.slug === task.project); if (p) showProjectProfile(p); } }, "Edit project brief"));
  const currentForm = $("#task-plan-form");
  if (!currentForm || currentForm.dataset.taskId !== String(task.id) || (currentForm.dataset.dirty !== "true" && !currentForm.contains(document.activeElement))) renderTaskPlan(task, plan);
  renderSubtasks(task, context);
  renderContextDetail(task, context);
  renderTaskActivity(task, context);
  renderTaskAside(task, context);
  const accept = $("#task-acceptance");
  if (accept.dataset.taskId !== String(task.id) || (!accept.querySelector("textarea:focus") && !accept.querySelector("textarea[data-dirty=true]"))) {
    accept.dataset.taskId = String(task.id);
    const evidence = el("textarea", { class: "field", rows: 3, placeholder: "Record the evidence that satisfies this task's acceptance.", "aria-label": "Acceptance evidence" });
    evidence.value = acceptanceDrafts.get(task.id) || "";
    if (evidence.value) evidence.dataset.dirty = "true";
    evidence.addEventListener("input", () => { evidence.dataset.dirty = "true"; acceptanceDrafts.set(task.id, evidence.value); });
    const button = el("button", { type: "button", class: "btn primary", disabled: task.status !== "review", onclick: async () => {
      if (!evidence.value.trim()) { toast("Add acceptance evidence first."); return; }
      button.disabled = true;
      button.dataset.submitting = "true";
      try { await api("POST", `/tasks/${task.id}/accept`, { reviewer: "human", evidence: evidence.value.trim() }); acceptanceDrafts.delete(task.id); evidence.dataset.dirty = "false"; await loadBoard(); await refreshTask(); toast("Task accepted with evidence."); }
      catch (err) { toast(err.message); }
      finally {
        button.dataset.submitting = "false";
        button.disabled = panelTask?.id !== task.id || panelTask.status !== "review";
        if (state.task === task.id) await refreshTask();
      }
    } }, "Accept as done");
    accept.replaceChildren(el("div", { class: "section acceptance-section" }, el("h3", {}, "Acceptance evidence"), evidence, el("div", { class: "acceptance-actions" }, el("small", {}, task.status === "review" ? "Human acceptance checks the current task, children and prerequisites." : "Move completed work to Review before accepting it."), button)));
  }
  const acceptButton = accept.querySelector("button");
  if (acceptButton) acceptButton.disabled = task.status !== "review" || acceptButton.dataset.submitting === "true";
  const acceptanceHint = accept.querySelector(".acceptance-actions small");
  if (acceptanceHint) acceptanceHint.textContent = task.status === "review" ? "Human acceptance checks the current task, children and prerequisites." : "Move completed work to Review before accepting it.";
  setTaskTab(state.taskTab);
}
function renderTaskPlan(task, plan) {
  const form = el("form", { id: "task-plan-form", "data-task-id": task.id, class: "task-plan-form" });
  const parentChoice = el("select", { class: "field", name: "parent_id" }, el("option", { value: "" }, "No parent — top-level task"), ...state.board.tasks.filter((t) => t.project === task.project && t.id !== task.id).map((t) => el("option", { value: t.id }, `${key(t)} · ${taskTitle(t)}`)));
  parentChoice.value = plan.parent_id || "";
  form.append(el("div", { class: "form-grid" }, inputField("Owner", "owner", plan.owner), el("label", { class: "form-field" }, el("span", {}, "Parent task"), parentChoice)),
    inputField("Deliverable", "deliverable", plan.deliverable, "textarea"), inputField("Acceptance checklist / evidence criteria", "acceptance", plan.acceptance, "textarea"), inputField("Allowed scope", "allowed_scope", plan.allowed_scope, "textarea"), inputField("Resource / attempt budget", "budget", plan.budget),
    el("div", { class: "form-grid dates-grid" }, inputField("Planned start", "planned_start", plan.planned_start, "date"), inputField("Planned end", "planned_end", plan.planned_end, "date"), inputField("Due date", "due_date", plan.due_date, "date"), inputField("Estimate (minutes)", "estimate", plan.estimate_seconds == null ? "" : plan.estimate_seconds / 60, "number")),
    inputField("Required prerequisites", "depends_on", (plan.depends_on || []).map((id) => { const t = taskById(id); return t ? key(t) : String(id); }).join(", "), "text", "Task keys or numeric IDs, separated by commas. Each prerequisite must be satisfied."),
    inputField("Selected context links", "context_links", (plan.context_links || []).map((l) => `${l.kind} | ${l.label} | ${l.path}`).join("\n"), "textarea", "One per line: kind | label | path. References do not execute or read files automatically."),
    el("div", { class: "form-save-row" }, el("span", { class: "form-save-hint" }, "Planning fields save together."), el("button", { class: "btn primary", type: "submit" }, "Save task plan")));
  if (childrenOf(task.id).length) {
    const estimateInput = form.elements.namedItem("estimate");
    if (estimateInput) { estimateInput.disabled = true; estimateInput.value = ""; estimateInput.closest("label")?.append(el("small", {}, "Summary effort is derived from leaf tasks.")); }
  }
  form.addEventListener("input", () => { form.dataset.dirty = "true"; }); form.addEventListener("change", () => { form.dataset.dirty = "true"; });
  form.addEventListener("submit", async (event) => {
    event.preventDefault(); const button = form.querySelector("button[type=submit]"); button.disabled = true;
    try {
      const tokens = formValue(form, "depends_on").split(",").map((v) => v.trim()).filter(Boolean);
      const depends = tokens.map((token) => { const match = token.match(/(?:^|#)(\d+)$/); if (!match) throw new Error(`Invalid prerequisite: ${token}`); return Number(match[1]); });
      const estimate = formValue(form, "estimate"); if (estimate && (!Number.isFinite(Number(estimate)) || Number(estimate) < 0)) throw new Error("Estimate must be non-negative.");
      const links = formValue(form, "context_links").split("\n").filter((line) => line.trim()).map((line) => { const [kind, label, ...path] = line.split("|").map((v) => v.trim()); if (!kind || !label || !path.join("|")) throw new Error("Context links need kind | label | path."); return { kind, label, path: path.join("|") }; });
      const next = { ...planFor(task.id), parent_id: formValue(form, "parent_id") ? Number(formValue(form, "parent_id")) : null, depends_on: depends, estimate_seconds: estimate === "" ? null : Math.round(Number(estimate) * 60), context_links: links };
      for (const field of ["owner", "deliverable", "acceptance", "allowed_scope", "budget"]) next[field] = formValue(form, field);
      for (const field of ["planned_start", "planned_end", "due_date"]) next[field] = formValue(form, field) || null;
      await api("PUT", `/tasks/${task.id}/plan`, next); form.dataset.dirty = "false"; await loadBoard(); await refreshTask(); toast("Task plan saved.");
    } catch (err) { toast(err.message); button.disabled = false; }
  });
  $("#task-plan-editor").replaceChildren(form);
}
function renderSubtasks(task, context) {
  const children = context.children || [], dependencies = context.dependencies || [];
  const count = children.filter((child) => child.accepted).length;
  const childWindow = context.context_window?.children;
  const partialChildren = !!childWindow?.truncated;
  const progress = partialChildren ? `${count} accepted among ${children.length} loaded / ${childWindow.total} children` : `${count} of ${children.length} accepted`;
  const form = el("form", { class: "add-subtask-form" }, el("input", { class: "field", name: "title", placeholder: "A concrete subtask deliverable", "aria-label": "New subtask title", required: true }), el("input", { class: "field", name: "description", placeholder: "Description (optional)", "aria-label": "New subtask description" }), el("button", { class: "btn quiet", type: "submit" }, "+ Add subtask"));
  form.addEventListener("submit", async (event) => { event.preventDefault(); const button = form.querySelector("button"); button.disabled = true; try { await api("POST", `/tasks/${task.id}/subtasks`, { title: formValue(form, "title"), description: formValue(form, "description") }); await loadBoard(); await refreshTask(); toast("Subtask created. Required-child acceptance is preserved."); } catch (err) { toast(err.message); button.disabled = false; } });
  const oldForm = $("#task-subtasks").querySelector(".add-subtask-form");
  if (oldForm && oldForm.contains(document.activeElement)) return;
  $("#task-subtasks").replaceChildren(sectionHead("Subtasks", el("span", { class: "denominator" }, progress)),
    ...(partialChildren ? [el("p", { class: "workspace-subtitle" }, "This context contains only part of the child list. Loaded-child acceptance is not the full parent rollup.")] : []),
    ...children.map(({ task: child, accepted }) => el("div", { class: "subtask-row" }, icon(accepted ? "check" : "board"), taskButton(child), el("span", { class: "status-pill" }, child.status))),
    ...(!children.length ? [el("p", { class: "workspace-subtitle" }, "No subtasks recorded. Add real child tasks to divide the deliverable.")] : []), form,
    sectionHead("Dependencies"), ...dependencies.map(({ task: prerequisite, accepted }) => el("div", { class: "subtask-row" }, icon(accepted ? "check" : "clock"), taskButton(prerequisite), el("span", { class: "status-pill" }, accepted ? "Satisfied" : "Required"))), ...(!dependencies.length ? [el("p", { class: "workspace-subtitle" }, "None recorded. Edit prerequisites in Overview.")] : []));
}
function renderContextDetail(task, context) {
  const profile = context.profile || profileFor(task.project), plan = context.plan || planFor(task.id);
  const lineage = [...(context.ancestors || []).map((a) => key(a.task)), key(task)].join(" → ");
  $("#task-context-detail").replaceChildren(sectionHead("Selected task context", el("button", { class: "btn primary", onclick: () => copyContext(context) }, "Copy agent brief")), el("p", { class: "context-lineage" }, `${task.project} → ${lineage}`),
    ...[["Source", [profile.source_path, profile.source_revision].filter(Boolean).join(" · ") || "Not recorded"], ["Project instructions", (profile.instructions || []).join("\n") || "None selected"], ["Relevant skills", (profile.skills || []).join("\n") || "None selected"], ["Dated memory references", (profile.memories || []).join("\n") || "None selected"]].map(([label, value]) => el("section", { class: "context-block" }, el("h3", {}, label), el("p", {}, value))),
    el("section", { class: "context-block" }, el("h3", {}, "Task-specific references"), ...(plan.context_links || []).map((link) => el("p", {}, el("strong", {}, link.label + " · "), el("code", {}, link.path))), ...(!(plan.context_links || []).length ? [el("p", {}, "No task-specific references selected.")] : [])),
    el("p", { class: "workspace-subtitle" }, "This packet contains selected task/project references. It does not load files or grant execution authority."));
}
async function copyContext(context) {
  const text = JSON.stringify(context, null, 2);
  try { await navigator.clipboard.writeText(text); }
  catch { const area = el("textarea", { style: "position:fixed;opacity:0" }); area.value = text; document.body.append(area); area.select(); document.execCommand("copy"); area.remove(); }
  toast("Selected agent context copied.");
}
function renderTaskActivity(task, context) {
  const events = context.events || [], entries = mergeTimeEntries(context.time_entries || [], (state.harness.active_timers || []).filter((entry) => entry.task_id === task.id));
  $("#task-activity").replaceChildren(sectionHead("Recorded task events"), ...events.slice().reverse().map((event) => el("div", { class: "activity-row" }, icon(event.kind === "accepted" ? "check" : "clock"), el("div", {}, el("strong", {}, event.kind.replace(/_/g, " ")), event.to_status ? el("p", {}, `${event.from_status || "—"} → ${event.to_status}`) : null, el("small", {}, new Date(event.at).toLocaleString())))), ...(!events.length ? [el("p", { class: "workspace-subtitle" }, "No events recorded for this task yet. Old updates are not fabricated as history.")] : []), sectionHead("Time entries", el("button", { class: "btn quiet", onclick: () => showTimeDialog(task) }, "Add entry")), ...entries.map(timeEntryRow), ...(!entries.length ? [el("p", { class: "workspace-subtitle" }, "No time entries recorded.")] : []));
}
function renderTaskAside(task, context) {
  const profile = context.profile || profileFor(task.project), plan = context.plan || planFor(task.id), entries = context.time_entries || [], timer = runningTimer(), mine = timer?.task_id === task.id;
  const card = (title, ...content) => el("section", { class: "context-card" }, el("h3", {}, title), ...content);
  const source = [profile.source_path, profile.source_revision].filter(Boolean).join(" · ");
  const lessons = (plan.context_links || []).filter((link) => /lesson|learning|receipt/i.test(link.kind));
  $("#task-context-aside").replaceChildren(
    card("Agent context", el("small", {}, "Context lineage"), el("p", { class: "context-lineage" }, [task.project, ...(context.ancestors || []).map((a) => key(a.task)), key(task)].join(" / ")), el("small", {}, "Source"), el("p", { class: "source-reference" }, source || "Source not recorded"),
      el("small", {}, "Relevant skills"), el("div", { class: "context-chips" }, ...(profile.skills || []).map((skill) => el("span", {}, skill)), ...(!(profile.skills || []).length ? [el("span", {}, "None selected")] : [])), el("small", {}, "Project memory"), ...(profile.memories || []).map((memory) => el("p", { class: "memory-reference" }, memory)), ...(!(profile.memories || []).length ? [el("p", { class: "workspace-subtitle" }, "No dated memory selected.")] : []), el("button", { class: "btn primary full-width", onclick: () => copyContext(context) }, icon("book"), "Prepare agent brief"), el("small", {}, "Copies the selected context; no agent is started.")),
    card("Schedule & time", el("dl", { class: "context-facts" }, ...[["Start", plan.planned_start || "Not scheduled"], ["End", plan.planned_end || "Not scheduled"], ["Due", plan.due_date || "Not scheduled"], ["Estimate", plan.estimate_seconds == null ? "Not set" : shortDuration(plan.estimate_seconds)], ["Logged human work", recordedSecondsForTasks([task.id]) ? shortDuration(recordedSecondsForTasks([task.id])) : "No entries"]].flatMap(([label, value]) => [el("dt", {}, label), el("dd", {}, value)])), el("div", { class: "context-action-row" }, el("button", { class: "btn quiet", onclick: () => showSchedule(task) }, icon("calendar"), "Schedule task"), el("button", { class: "btn quiet", onclick: () => showTimeDialog(task) }, icon("clock"), "Add time entry")),
      el("button", { class: "btn timer-button full-width", disabled: !!timer && !mine, onclick: () => mine ? stopTimer(timer) : startTimer(task) }, icon(mine ? "stop" : "play"), mine ? el("span", { "data-timer-id": timer.id }, shortDuration(elapsedSeconds(timer)) + " · Stop timer") : timer ? "Another task has the human timer" : "Start timer")),
    card("Learning loop", el("p", { class: "learning-steps" }, "Retrieve → Apply → Verify → Capture → Review reuse"), ...lessons.map((link) => el("p", { class: "memory-reference" }, `${link.label}: ${link.path}`)), ...(!lessons.length ? [el("p", { class: "context-note" }, "No lesson reference recorded for this task.")] : []), el("p", { class: "workspace-subtitle" }, "Knowledge remains in its source skill or checkpoint. A saved reference does not establish learning benefit."), el("div", { class: "execution-note" }, el("small", {}, "Task status"), el("p", {}, statusIcon(task.status), task.status))));
}
setInterval(() => {
  if (document.hidden) return;
  const entries = new Map(timeEntries().filter((entry) => !entry.ended_at).map((entry) => [String(entry.id), entry]));
  document.querySelectorAll("[data-timer-id]").forEach((node) => { const entry = entries.get(node.dataset.timerId); if (entry) node.textContent = shortDuration(elapsedSeconds(entry)) + (node.closest(".timer-button") ? " · Stop timer" : " running"); });
}, 1000);

// ---------- theme and responsive navigation ----------
$("#theme-select").value = window.KanzoTheme.getPreference();
$("#theme-select").addEventListener("change", (event) => window.KanzoTheme.setPreference(event.target.value));
window.addEventListener("kanzo:theme-change", (event) => { $("#theme-select").value = event.detail.preference; });
function closeSidebar() { document.body.classList.remove("sidebar-open"); $("#sidebar-scrim").hidden = true; $("#sidebar-toggle").setAttribute("aria-expanded", "false"); }
$("#sidebar-toggle").addEventListener("click", () => { const open = !document.body.classList.contains("sidebar-open"); document.body.classList.toggle("sidebar-open", open); $("#sidebar-scrim").hidden = !open; $("#sidebar-toggle").setAttribute("aria-expanded", String(open)); });
$("#sidebar-scrim").addEventListener("click", closeSidebar);
document.addEventListener("keydown", (event) => { if (event.key === "Escape") closeSidebar(); });
window.KanzoTheme.apply();

checkUpdate();
setInterval(checkUpdate, 24 * 60 * 60 * 1000);
loadSyncRemote();

// Relative times ("5m ago") drift; refresh them now and then.
setInterval(() => {
  document.querySelectorAll("time[datetime]").forEach((t) => { t.textContent = ago(t.getAttribute("datetime")); });
}, 60000);

{
  const { slug, task } = readHash();
  state.project = slug || "@dashboard";
  if (state.project === "@review" || state.project === "@archive") state.scope = state.project.slice(1);
  loadBoard().then(() => { if (task) openTask(task); });
}
