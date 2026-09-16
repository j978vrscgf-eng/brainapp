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

let allCards = [];
let queues = {};
let currentCat = "all";
let vocabDir = "pl-it";

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

// Kazda kategoria ma wlasna kolejke. Pokazana karta wraca na jej koniec,
// wiec cala zawartosc pokaze sie zanim cokolwiek sie powtorzy.
function buildQueues() {
  queues = { all: shuffle(allCards) };
  for (const cat of CAT_ORDER) {
    if (cat === "all") continue;
    queues[cat] = shuffle(allCards.filter(c => c.cat === cat));
  }
}

function nextCard(cat) {
  const q = queues[cat];
  const item = q.shift();
  q.push(item);
  return item;
}

function vocabParts(item) {
  return item.dir === "pl-it"
    ? { pl: item.front, it: item.back }
    : { pl: item.back, it: item.front };
}

function cardHTML(item) {
  const label = CAT_LABEL[item.cat] || item.cat;
  if (item.type === "vocab") {
    const { pl, it } = vocabParts(item);
    const plFirst = vocabDir === "pl-it";
    return `
      <div class="card theme-${item.cat}" data-pl="${esc(pl)}" data-it="${esc(it)}">
        <div class="pill">${label} · <span class="dir">${plFirst ? "PL → IT" : "IT → PL"}</span></div>
        <div class="term">${plFirst ? pl : it}</div>
        <div class="sep"></div>
        <div class="translation">${plFirst ? it : pl}</div>
        <div class="hint">dwuklik = zmiana kierunku</div>
      </div>`;
  }
  if (item.type === "def") {
    return `
      <div class="card theme-${item.cat}">
        <div class="pill">${label} · definicja</div>
        <div class="term">${item.term}</div>
        <div class="sep"></div>
        <div class="body">${item.text}</div>
        <div class="hint">przesuń w górę ↑ · w bok = inna dziedzina</div>
      </div>`;
  }
  return `
    <div class="card theme-${item.cat}">
      <div class="pill">${label} · ciekawostka</div>
      <div class="body" style="font-size:22px;font-weight:600;">${item.text}</div>
      <div class="hint">przesuń w górę ↑ · w bok = inna dziedzina</div>
    </div>`;
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
    appendBatch(cat, INITIAL_CARDS);
    const pane = paneOf(cat);
    pane.addEventListener("scroll", () => {
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
}, { passive: true });

// Dwuklik na zakladce Wloski odwraca kierunek tlumaczenia (PL->IT / IT->PL).
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
}

fetch("content.json")
  .then(r => r.json())
  .then(data => {
    allCards = [];
    for (const cat in data) {
      for (const item of data[cat]) allCards.push({ ...item, cat });
    }
    buildQueues();
    buildTabs();
    buildPanes();
  });

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("service-worker.js").catch(() => {});
  });
}

// --------------------------------------------------- motyw: 4 tryby w cyklu
const THEME_CYCLE = ["day", "night", "anthracite", "nightlight"];
const THEME_ICON = { day: "🌙", night: "⚫", anthracite: "🕯️", nightlight: "☀️" };
const THEME_TITLE = {
  day: "Tryb: dzień (kliknij → noc)",
  night: "Tryb: noc (kliknij → antracyt)",
  anthracite: "Tryb: antracyt (kliknij → nightlight)",
  nightlight: "Tryb: nightlight, bez bieli (kliknij → dzień)"
};

function applyTheme(mode) {
  document.documentElement.setAttribute("data-theme", mode);
  const btn = document.getElementById("theme-toggle");
  btn.textContent = THEME_ICON[mode];
  btn.title = THEME_TITLE[mode];
}

document.getElementById("theme-toggle").addEventListener("click", () => {
  const current = document.documentElement.getAttribute("data-theme");
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
