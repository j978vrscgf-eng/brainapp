const CATS = [
  { key: "all",             label: "Wszystko",                accent: "#9aa0a6", on: "#101014" },
  { key: "wloski",          label: "Włoski",                  accent: "#d9603a", on: "#ffffff" },
  { key: "gotowanie",       label: "Gotowanie",               accent: "#e0a63a", on: "#101014" },
  { key: "architektura",    label: "Architektura",            accent: "#3f6e8f", on: "#ffffff" },
  { key: "angielski",       label: "Ciekawy angielski",       accent: "#7a5bc7", on: "#ffffff" },
  { key: "psychologia",     label: "Psychologia",             accent: "#a83279", on: "#ffffff" },
  { key: "dark_psychology", label: "Dark Psychology",         accent: "#a51f1f", on: "#ffffff" },
  { key: "chemia",          label: "Chemia",                  accent: "#1fae8e", on: "#101014" },
  { key: "mowa_ciala",      label: "Mowa ciała",              accent: "#a3833f", on: "#ffffff" },
  { key: "rozwoj",          label: "Najlepsza wersja siebie", accent: "#2f9bd8", on: "#ffffff" }
];

const CAT_ORDER = CATS.map(c => c.key);
const CAT_LABEL = Object.fromEntries(CATS.map(c => [c.key, c.label]));

const INITIAL_CARDS = 10;
const BATCH_CARDS = 20;
const STORE_KEY = "brainapp-state";

let allCards = [];
let queues = {};
let currentCat = "all";
let vocabDir = "pl-it";
let seenCounts = {};   // id karty -> ile razy realnie pokazana na ekranie
const settleTimers = {}; // kategoria -> timer "przewijanie ucichlo"

const pager = document.getElementById("pager");

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function esc(s) {
  return String(s).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}

/* ------------------------------------------------ pamiec miedzy sesjami */
function cardId(item) {
  return item.cat + "|" + String(item.term || item.front || item.text || "").slice(0, 60);
}

function loadState() {
  try { return JSON.parse(localStorage.getItem(STORE_KEY)) || {}; } catch (e) { return {}; }
}

function saveNow() {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify({ v: 1, seen: seenCounts, cat: currentCat, vocabDir }));
  } catch (e) {}
}

let saveTimer;
function saveState() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveNow, 600);
}

window.addEventListener("pagehide", saveNow);
document.addEventListener("visibilitychange", () => { if (document.hidden) saveNow(); });

/* -------------------------------------------------------------- kolejki */
// Karty najrzadziej ogladane ida na poczatek kolejki, obejrzana wraca na koniec.
function seenOf(item) {
  return seenCounts[cardId(item)] || 0;
}

function orderBySeen(list) {
  return shuffle(list).sort((a, b) => seenOf(a) - seenOf(b));
}

function buildQueues() {
  queues = { all: orderBySeen(allCards) };
  for (const cat of CAT_ORDER) {
    if (cat === "all") continue;
    queues[cat] = orderBySeen(allCards.filter(c => c.cat === cat));
  }
}

function nextCard(cat) {
  const q = queues[cat];
  const item = q.shift();
  q.push(item);
  return item;
}

// Znak nieskonczonosci = karta leci kolejny raz. Gdy pojawia sie wszedzie,
// znaczy ze cala tresc zostala przerobiona i czas dorzucic nowa.
function repMark(item) {
  return seenOf(item) > 0 ? '<div class="rep">∞</div>' : "";
}

/* ---------------------------------------------------------------- karty */
function vocabParts(item) {
  return item.dir === "pl-it"
    ? { pl: item.front, it: item.back }
    : { pl: item.back, it: item.front };
}

function cardHTML(item) {
  const label = CAT_LABEL[item.cat] || item.cat;
  const rep = repMark(item);
  if (item.type === "vocab") {
    const { pl, it } = vocabParts(item);
    const plFirst = vocabDir === "pl-it";
    return `
      <div class="card theme-${item.cat}" data-id="${esc(cardId(item))}" data-pl="${esc(pl)}" data-it="${esc(it)}">
        <div class="pill">${label} · <span class="dir">${plFirst ? "PL → IT" : "IT → PL"}</span></div>
        <div class="term">${plFirst ? pl : it}</div>
        <div class="sep"></div>
        <div class="translation">${plFirst ? it : pl}</div>
        ${rep}
        <div class="hint">dwuklik = zmiana kierunku</div>
      </div>`;
  }
  if (item.type === "def") {
    return `
      <div class="card theme-${item.cat}" data-id="${esc(cardId(item))}">
        <div class="pill">${label} · definicja</div>
        <div class="term">${item.term}</div>
        <div class="sep"></div>
        <div class="body">${item.text}</div>
        ${rep}
        <div class="hint">przesuń w górę ↑</div>
      </div>`;
  }
  return `
    <div class="card theme-${item.cat}" data-id="${esc(cardId(item))}">
      <div class="pill">${label} · ciekawostka</div>
      <div class="body" style="font-size:22px;font-weight:600;">${item.text}</div>
      ${rep}
      <div class="hint">przesuń w górę ↑</div>
    </div>`;
}

// Karta liczy sie jako przeczytana, gdy przewijanie zatrzyma sie na niej
// w aktualnie ogladanej dziedzinie.
function markSettled(cat) {
  if (cat !== currentCat) return;
  const pane = paneOf(cat);
  if (!pane || !pane.clientHeight) return;
  const el = pane.children[Math.round(pane.scrollTop / pane.clientHeight)];
  if (!el || el.dataset.counted) return;
  el.dataset.counted = "1";
  const id = el.dataset.id;
  if (id) {
    seenCounts[id] = (seenCounts[id] || 0) + 1;
    saveState();
  }
}

function scheduleMark(cat) {
  clearTimeout(settleTimers[cat]);
  settleTimers[cat] = setTimeout(() => markSettled(cat), 250);
}

function paneOf(cat) {
  return pager.querySelector(`.pane[data-cat="${cat}"]`);
}

function appendBatch(cat, n = BATCH_CARDS) {
  const pane = paneOf(cat);
  if (!pane) return;
  const count = Math.min(n, queues[cat].length);
  const html = [];
  for (let i = 0; i < count; i++) html.push(cardHTML(nextCard(cat)));
  pane.insertAdjacentHTML("beforeend", html.join(""));
}

/* -------------------------------------------------------------- budowa */
function buildTabs() {
  const tabs = document.getElementById("tabs");
  tabs.innerHTML = CATS.map(c =>
    `<button class="tab${c.key === "all" ? " active" : ""}" data-cat="${c.key}"
       style="--c:${c.accent};--on:${c.on}"><span class="dot"></span>${c.label}</button>`
  ).join("");
  tabs.querySelectorAll(".tab").forEach(t => {
    t.addEventListener("click", () => goToCat(t.dataset.cat));
  });
}

function buildPanes() {
  pager.innerHTML = CAT_ORDER.map(c => `<div class="pane" data-cat="${c}"></div>`).join("");
  for (const cat of CAT_ORDER) {
    const pane = paneOf(cat);
    appendBatch(cat, INITIAL_CARDS);
    pane.addEventListener("scroll", () => {
      scheduleMark(cat);
      if (pane.scrollTop + pane.clientHeight >= pane.scrollHeight - window.innerHeight * 2) {
        appendBatch(cat);
      }
    }, { passive: true });
  }
  paneOf("wloski").addEventListener("dblclick", toggleVocabDir);
}

function setActive(cat) {
  currentCat = cat;
  document.querySelectorAll(".tab").forEach(t => {
    const on = t.dataset.cat === cat;
    t.classList.toggle("active", on);
    if (on) t.scrollIntoView({ behavior: "smooth", inline: "center", block: "nearest" });
  });
  saveState();
}

function goToCat(cat) {
  const idx = CAT_ORDER.indexOf(cat);
  pager.scrollTo({ left: idx * pager.clientWidth, behavior: "smooth" });
  setActive(cat);
}

pager.addEventListener("scroll", () => {
  const idx = Math.round(pager.scrollLeft / pager.clientWidth);
  const cat = CAT_ORDER[Math.max(0, Math.min(CAT_ORDER.length - 1, idx))];
  if (cat && cat !== currentCat) setActive(cat);
  scheduleMark(currentCat);
}, { passive: true });

function toggleVocabDir() {
  vocabDir = vocabDir === "pl-it" ? "it-pl" : "pl-it";
  const plFirst = vocabDir === "pl-it";
  document.querySelectorAll(".card[data-pl]").forEach(card => {
    const pl = card.dataset.pl;
    const it = card.dataset.it;
    card.querySelector(".term").textContent = plFirst ? pl : it;
    card.querySelector(".translation").textContent = plFirst ? it : pl;
    const dir = card.querySelector(".dir");
    if (dir) dir.textContent = plFirst ? "PL → IT" : "IT → PL";
  });
  saveState();
}

/* ----------------------------------------------------------------- start */
function start(data) {
  allCards = [];
  for (const cat in data) {
    for (const item of data[cat]) allCards.push({ ...item, cat });
  }

  const saved = loadState();
  if (saved.seen && typeof saved.seen === "object") seenCounts = saved.seen;
  if (saved.vocabDir === "it-pl" || saved.vocabDir === "pl-it") vocabDir = saved.vocabDir;

  buildQueues();
  buildTabs();
  buildPanes();
  scheduleMark(currentCat);

  if (saved.cat && CAT_ORDER.includes(saved.cat) && saved.cat !== "all") {
    requestAnimationFrame(() => {
      pager.scrollLeft = CAT_ORDER.indexOf(saved.cat) * pager.clientWidth;
      setActive(saved.cat);
    });
  }
}

if (typeof CONTENT_DATA !== "undefined") {
  start(CONTENT_DATA);
} else {
  fetch("content.json").then(r => r.json()).then(start);
}

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("service-worker.js").catch(() => {});
  });
}

/* ------------------------------------------------- motyw: 4 tryby w cyklu */
const SVG = {
  moon: '<svg viewBox="0 0 20 20" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M16.2 12.4A6.8 6.8 0 0 1 7.6 3.8a6.9 6.9 0 1 0 8.6 8.6z"/></svg>',
  dot:  '<svg viewBox="0 0 20 20" width="17" height="17"><circle cx="10" cy="10" r="5.6" fill="currentColor"/></svg>',
  half: '<svg viewBox="0 0 20 20" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.4"><circle cx="10" cy="10" r="6"/><path d="M10 4a6 6 0 0 1 0 12z" fill="currentColor" stroke="none"/></svg>',
  sun:  '<svg viewBox="0 0 20 20" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"><circle cx="10" cy="10" r="3.4"/><path d="M10 2.4v1.7M10 15.9v1.7M2.4 10h1.7M15.9 10h1.7M4.7 4.7l1.2 1.2M14.1 14.1l1.2 1.2M15.3 4.7l-1.2 1.2M5.9 14.1l-1.2 1.2"/></svg>'
};

const THEME_CYCLE = ["day", "night", "anthracite", "nightlight"];
const THEME_ICON = { day: SVG.moon, night: SVG.dot, anthracite: SVG.half, nightlight: SVG.sun };
const THEME_TITLE = {
  day: "Tryb: dzień (kliknij → noc)",
  night: "Tryb: noc (kliknij → antracyt)",
  anthracite: "Tryb: antracyt (kliknij → nightlight)",
  nightlight: "Tryb: nightlight, bez bieli (kliknij → dzień)"
};

function applyTheme(mode) {
  document.getElementById("app").setAttribute("data-theme", mode);
  const btn = document.getElementById("theme-toggle");
  btn.innerHTML = THEME_ICON[mode];
  btn.title = THEME_TITLE[mode];
}

document.getElementById("theme-toggle").addEventListener("click", () => {
  const current = document.getElementById("app").getAttribute("data-theme");
  const next = THEME_CYCLE[(THEME_CYCLE.indexOf(current) + 1) % THEME_CYCLE.length];
  applyTheme(next);
  try { localStorage.setItem("brainapp-theme", next); } catch (e) {}
});

(function initTheme() {
  let saved;
  try { saved = localStorage.getItem("brainapp-theme"); } catch (e) { saved = null; }
  if (THEME_CYCLE.includes(saved)) { applyTheme(saved); return; }
  const prefersDark = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
  applyTheme(prefersDark ? "night" : "day");
})();
