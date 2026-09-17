const GRAD = {
  all:             "linear-gradient(160deg,#16161c,#2a2a33)",
  wloski:          "linear-gradient(160deg,#7a2b1a,#d9603a)",
  gotowanie:       "linear-gradient(160deg,#7a5a05,#e0a63a)",
  architektura:    "linear-gradient(160deg,#1e2a3a,#3f6e8f)",
  angielski:       "linear-gradient(160deg,#241a4a,#5b3fa0)",
  psychologia:     "linear-gradient(160deg,#4a1942,#a83279)",
  dark_psychology: "linear-gradient(160deg,#1a0a0a,#6b1414)",
  chemia:          "linear-gradient(160deg,#0a4a3f,#1fae8e)",
  mowa_ciala:      "linear-gradient(160deg,#3a2e1f,#8a6d3f)",
  rozwoj:          "linear-gradient(160deg,#10324f,#2f9bd8)",
  ulubione:        "linear-gradient(160deg,#4a0d1c,#e0405e)",
  notatnik:        "linear-gradient(160deg,#14161a,#20242b)"
};

const BASE_CATS = [
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

// Notatnik jest prywatny: odblokowuje go potrojne szybkie dotkniecie karty
// (albo adres z koncowka #notatnik) i zostaje juz tylko na tym urzadzeniu.
const NOTES_FLAG = "brainapp-notes-on";
const GOTO_FLAG = "brainapp-goto";
if (location.hash === "#notatnik") {
  try { localStorage.setItem(NOTES_FLAG, "1"); } catch (e) {}
}
let notesOn = false;
try { notesOn = localStorage.getItem(NOTES_FLAG) === "1"; } catch (e) {}

const NOTES_CAT = { key: "notatnik", label: "Notatnik",  accent: "#7d8590", on: "#ffffff" };
const FAV_CAT   = { key: "ulubione", label: "Ulubione ♥", accent: "#e0405e", on: "#ffffff" };

// Ulubione zawsze na samym koncu paska zakladek.
const CATS = BASE_CATS.concat(notesOn ? [NOTES_CAT] : []).concat([FAV_CAT]);

const CAT_ORDER = CATS.map(c => c.key);
const CAT_LABEL = Object.fromEntries(CATS.map(c => [c.key, c.label]));

const INITIAL_CARDS = 10;
const BATCH_CARDS = 20;
const STORE_KEY = "brainapp-state";
const APP_VERSION = "20260917-232301";   // podmieniane przy budowaniu

let allCards = [];
let queues = {};
let currentCat = "all";
let vocabDir = "pl-it";
let seenCounts = {};   // id karty -> ile razy realnie pokazana na ekranie
let favs = {};         // id karty -> 1, jesli dodana do ulubionych
let favsDirty = false; // zakladka Ulubione wymaga przebudowy
const settleTimers = {}; // kategoria -> timer "przewijanie ucichlo"

// Stan notatnika musi byc zadeklarowany tutaj, a nie przy jego sekcji nizej:
// budowanie zakladek dzieje sie wczesniej i siegalo po te zmienne, zanim
// powstaly. Konczylo sie to wyjatkiem, ktory przerywal budowanie reszty.
const NOTES_STORE = "brainapp-notes";
const GROQ_KEY_STORE = "brainapp-groq-key";
const GROQ_URL = "https://api.groq.com/openai/v1/audio/transcriptions";
const GROQ_MODEL = "whisper-large-v3-turbo";
let notes = [];
let openNoteId = null;
let rec = null;
let recChunks = [];
let recStream = null;

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
    localStorage.setItem(STORE_KEY, JSON.stringify({ v: 1, seen: seenCounts, fav: favs, cat: currentCat, vocabDir }));
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

// Model talii: karty rozdaje sie z talii ulozonej wg tego, ile razy realnie
// zostaly przeczytane (najmniej czytane na wierzchu). Karta rozdana znika z
// talii az do jej wyczerpania - dopiero wtedy tasujemy nowa. Dzieki temu cala
// dziedzina pokaze sie raz, zanim cokolwiek wroci, a licznik przeczytan jest
// wspolny dla "Wszystko" i dziedzin, wiec nie dubluja sie nawzajem.
function poolOf(cat) {
  if (cat === "ulubione") return allCards.filter(c => favs[cardId(c)]);
  return cat === "all" ? allCards : allCards.filter(c => c.cat === cat);
}

function poolSize(cat) {
  return poolOf(cat).length;
}

function refillDeck(cat) {
  queues[cat] = orderBySeen(poolOf(cat));
}

function buildQueues() {
  queues = {};
  for (const cat of CAT_ORDER) {
    if (cat === "notatnik") continue;
    refillDeck(cat);
  }
}

function nextCard(cat, avoid) {
  let deck = queues[cat];
  if (!deck || !deck.length) { refillDeck(cat); deck = queues[cat]; }
  if (avoid && avoid.size) {
    const idx = deck.findIndex(it => !avoid.has(cardId(it)));
    if (idx > 0) return deck.splice(idx, 1)[0];
  }
  return deck.shift();
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

// Serduszko jest zawsze w karcie, tylko gasnie - dzieki temu dodanie do
// ulubionych jest samym przelaczeniem klasy, bez przebudowy karty.
function favMark(item) {
  return `<div class="fav${favs[cardId(item)] ? " on" : ""}">♥</div>`;
}

function cardHTML(item) {
  const label = CAT_LABEL[item.cat] || item.cat;
  const rep = repMark(item);
  const fav = favMark(item);
  if (item.type === "vocab") {
    const { pl, it } = vocabParts(item);
    const plFirst = vocabDir === "pl-it";
    // "veiled" = tlumaczenie rozmyte do pierwszego dotkniecia. Bez proby
    // przypomnienia sobie slowa nauka jest samym czytaniem.
    return `
      <div class="card veiled theme-${item.cat}" data-cat="${item.cat}" data-id="${esc(cardId(item))}" data-pl="${esc(pl)}" data-it="${esc(it)}">
        <div class="pill">${label} · <span class="dir">${plFirst ? "PL → IT" : "IT → PL"}</span></div>
        <div class="term">${plFirst ? pl : it}</div>
        <div class="sep"></div>
        <div class="translation">${plFirst ? it : pl}</div>
        ${fav}${rep}
        <div class="hint">dotknij = odsłoń · dwuklik = ♥</div>
      </div>`;
  }
  if (item.type === "def") {
    return `
      <div class="card theme-${item.cat}" data-cat="${item.cat}" data-id="${esc(cardId(item))}">
        <div class="pill">${label} · definicja</div>
        <div class="term">${item.term}</div>
        <div class="sep"></div>
        <div class="body">${item.text}</div>
        ${fav}${rep}
        <div class="hint">przesuń w górę ↑</div>
      </div>`;
  }
  return `
    <div class="card theme-${item.cat}" data-cat="${item.cat}" data-id="${esc(cardId(item))}">
      <div class="pill">${label} · ciekawostka</div>
      <div class="body" style="font-size:22px;font-weight:600;">${item.text}</div>
      ${fav}${rep}
      <div class="hint">przesuń w górę ↑</div>
    </div>`;
}

function favEmptyHTML() {
  return `
    <div class="card theme-ulubione" data-cat="ulubione">
      <div class="pill">Ulubione</div>
      <div class="term">Pusto</div>
      <div class="sep"></div>
      <div class="body">Dwuklik na dowolnej karcie dodaje ją tutaj.<br>Pojawi się wtedy serduszko w rogu.</div>
    </div>`;
}

// Karta liczy sie jako przeczytana, gdy przewijanie zatrzyma sie na niej
// w aktualnie ogladanej dziedzinie.
const bgEl = document.getElementById("bg");
let lastBgCat = "all";

// Pasek pod gestami iPhone'a maluje sie z tla dokumentu, nie z karty - dlatego
// ten sam kolor trzeba nalozyc takze na html/body, inaczej zostaje czarna belka.
// Gradient nalozony na html/body jest kafelkowany - konczy sie na wysokosci
// okna i zaczyna od nowa, co daje widoczny pasek u dolu. Dlatego tam idzie
// kolor jednolity, wziety z dolnego konca gradientu.
function gradEnd(grad) {
  const m = String(grad).match(/#[0-9a-fA-F]{6}/g);
  return m ? m[m.length - 1] : "#101014";
}

function darken(hex, k) {
  const n = parseInt(hex.slice(1), 16);
  return "rgb(" + Math.round(((n >> 16) & 255) * k) + ","
    + Math.round(((n >> 8) & 255) * k) + ","
    + Math.round((n & 255) * k) + ")";
}

function setBg(cat) {
  if (!GRAD[cat]) return;
  lastBgCat = cat;
  const mode = document.getElementById("app").getAttribute("data-theme");
  let paint = GRAD[cat];
  let solid = gradEnd(GRAD[cat]);
  if (mode === "anthracite") {
    paint = "#262624";
    solid = "#262624";
  } else if (mode === "nightlight") {
    paint = "#1c1712";
    solid = "#1c1712";
  } else if (mode === "night") {
    // przyciemnienie odpowiadajace filtrowi nakladanemu na karty
    paint = "linear-gradient(rgba(0,0,0,0.46),rgba(0,0,0,0.46))," + paint;
    solid = darken(solid, 0.54);
  }
  if (bgEl) bgEl.style.background = paint;
  document.body.style.background = solid;
  document.documentElement.style.background = solid;
}

function markSettled(cat) {
  if (cat !== currentCat) return;
  const pane = paneOf(cat);
  if (!pane || !pane.clientHeight) return;
  const el = pane.children[Math.round(pane.scrollTop / pane.clientHeight)];
  if (!el) return;
  if (el.dataset.cat) setBg(el.dataset.cat);
  if (el.dataset.counted) return;
  el.dataset.counted = "1";
  const id = el.dataset.id;
  if (id) {
    seenCounts[id] = (seenCounts[id] || 0) + 1;
    // Znak powtorki gasnie, gdy karta zostanie realnie przeczytana ponownie.
    // Przy kolejnym pojawieniu sie karty wroci - to potwierdzenie, nie pietno.
    const rep = el.querySelector(".rep");
    if (rep) {
      rep.style.opacity = "0";
      setTimeout(() => rep.remove(), 450);
    }
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
  if (!pane || cat === "notatnik") return;
  const count = Math.min(n, poolSize(cat));
  if (!count) {
    if (cat === "ulubione" && !pane.children.length) pane.innerHTML = favEmptyHTML();
    return;
  }
  const drawn = new Set();   // zadnych duplikatow w obrebie jednej partii
  const html = [];
  for (let i = 0; i < count; i++) {
    const item = nextCard(cat, drawn);
    if (!item) break;
    drawn.add(cardId(item));
    html.push(cardHTML(item));
  }
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
    // Awaria jednej zakladki nie moze przerwac budowania pozostalych.
    try {
      const pane = paneOf(cat);
      if (!pane) continue;
      if (cat === "notatnik") { notes = loadNotes(); renderNotes(); continue; }
      appendBatch(cat, INITIAL_CARDS);
      pane.addEventListener("scroll", () => {
        scheduleMark(cat);
        if (pane.scrollTop + pane.clientHeight >= pane.scrollHeight - window.innerHeight * 2) {
          appendBatch(cat);
        }
      }, { passive: true });
    } catch (e) {
      console.error("zakladka " + cat + ":", e);
    }
  }
}

function setActive(cat) {
  // Ulubione odswiezamy dopiero przy wejsciu, zeby zdjecie serduszka nie
  // wyrywalo karty sprzed oczu w trakcie czytania.
  if (cat === "ulubione" && favsDirty && currentCat !== "ulubione") rebuildFavs();
  currentCat = cat;
  setBg(cat);
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

/* ------------------------------------------------- ulubione i odslanianie */
function paintFav(id) {
  const on = !!favs[id];
  pager.querySelectorAll(".card").forEach(c => {
    if (c.dataset.id !== id) return;
    const h = c.querySelector(".fav");
    if (h) h.classList.toggle("on", on);
  });
}

// Zwraca nowy stan (true = dodana), albo null gdy karta nie ma identyfikatora.
function toggleFav(card) {
  const id = card.dataset.id;
  if (!id) return null;
  const on = !favs[id];
  if (on) favs[id] = 1; else delete favs[id];
  paintFav(id);
  const h = card.querySelector(".fav");
  if (h && on) { h.classList.remove("pop"); void h.offsetWidth; h.classList.add("pop"); }
  favsDirty = true;
  saveState();
  return on;
}

function rebuildFavs() {
  const pane = paneOf("ulubione");
  if (!pane) return;
  pane.innerHTML = "";
  refillDeck("ulubione");
  appendBatch("ulubione", INITIAL_CARDS);
  pane.scrollTop = 0;
  favsDirty = false;
}

function openNotes() {
  if (notesOn) { goToCat("notatnik"); return; }
  // Odblokowanie zmienia liste zakladek, wiec najprosciej przeladowac -
  // caly stan i tak siedzi w localStorage.
  saveNow();
  try {
    localStorage.setItem(NOTES_FLAG, "1");
    localStorage.setItem(GOTO_FLAG, "notatnik");
  } catch (e) {}
  location.replace(location.pathname);
}

// Wlasna obsluga wielokrotnego tapniecia: iOS czesto polyka natywne dblclick.
// Kazde dotkniecie dziala od razu, bez czekania na nastepne:
//   1 - odslania tlumaczenie
//   2 - dodaje lub zdejmuje serduszko
//   3 - cofa zmiane z drugiego tapniecia i otwiera notatnik
let tapCount = 0, tapCard = null, favApplied = null;
let lastTapAt = 0, lastTapX = 0, lastTapY = 0;

pager.addEventListener("pointerup", (e) => {
  const now = Date.now();
  const near = Math.abs(e.clientX - lastTapX) < 34 && Math.abs(e.clientY - lastTapY) < 34;
  const card = e.target && e.target.closest ? e.target.closest(".card") : null;

  if (card && card === tapCard && near && now - lastTapAt < 420) tapCount++;
  else { tapCount = 1; tapCard = card; favApplied = null; }

  lastTapAt = now;
  lastTapX = e.clientX;
  lastTapY = e.clientY;
  if (!card) return;

  if (tapCount === 1) { card.classList.remove("veiled"); return; }
  if (tapCount === 2) { favApplied = toggleFav(card); return; }
  if (tapCount === 3) {
    if (favApplied !== null) toggleFav(card);
    favApplied = null;
    openNotes();
  }
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
  if (saved.fav && typeof saved.fav === "object") favs = saved.fav;
  if (saved.vocabDir === "it-pl" || saved.vocabDir === "pl-it") vocabDir = saved.vocabDir;

  buildQueues();
  buildTabs();
  buildPanes();
  scheduleMark(currentCat);

  // Jednorazowe przekierowanie po odblokowaniu notatnika ma pierwszenstwo
  // przed zakladka zapamietana z poprzedniej sesji.
  let goto = null;
  try {
    goto = localStorage.getItem(GOTO_FLAG);
    if (goto) localStorage.removeItem(GOTO_FLAG);
  } catch (e) {}

  const target = (goto && CAT_ORDER.includes(goto)) ? goto : saved.cat;
  if (target && CAT_ORDER.includes(target) && target !== "all") {
    requestAnimationFrame(() => {
      pager.scrollLeft = CAT_ORDER.indexOf(target) * pager.clientWidth;
      setActive(target);
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
  setBg(lastBgCat);
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

/* =========================================================== NOTATNIK ===
   Prywatna zakladka. Notatki i klucz API leza wylacznie w localStorage
   tego urzadzenia - nic nie jest wysylane poza transkrypcja nagrania.        */

/* Stan i klucze tej sekcji sa zadeklarowane na gorze pliku - patrz komentarz
   przy zmiennych, budowanie zakladek potrzebuje ich wczesniej.              */

function loadNotes() {
  try { return JSON.parse(localStorage.getItem(NOTES_STORE)) || []; } catch (e) { return []; }
}
function persistNotes() {
  try { localStorage.setItem(NOTES_STORE, JSON.stringify(notes)); } catch (e) {}
}
function groqKey() {
  try { return localStorage.getItem(GROQ_KEY_STORE) || ""; } catch (e) { return ""; }
}

function fmtDate(ts) {
  const d = new Date(ts);
  return d.toLocaleDateString("pl-PL", { day: "2-digit", month: "2-digit" }) + " " +
         d.toLocaleTimeString("pl-PL", { hour: "2-digit", minute: "2-digit" });
}

function noteTitle(n) {
  const t = (n.title || "").trim();
  if (t) return t;
  const first = (n.text || "").trim().split("\n")[0];
  return first ? first.slice(0, 44) : "Bez tytułu";
}

function renderNotes() {
  const pane = paneOf("notatnik");
  if (!pane) return;
  pane.classList.add("pane-notes");
  const note = notes.find(n => n.id === openNoteId);
  pane.innerHTML = note ? editorHTML(note) : listHTML();
  wireNotes(pane);
}

function listHTML() {
  const items = notes
    .slice()
    .sort((a, b) => b.updated - a.updated)
    .map(n => `
      <button class="note-item" data-open="${n.id}">
        <span class="note-title">${esc(noteTitle(n))}</span>
        <span class="note-meta">${fmtDate(n.updated)}</span>
      </button>`).join("");

  return `
    <div class="notes-wrap">
      <div class="notes-head">
        <h2>Notatnik</h2>
        <button class="notes-btn" data-new="1">+ Nowa</button>
      </div>
      ${notes.length ? `<div class="notes-list">${items}</div>`
        : `<p class="notes-empty">Brak notatek.<br>Dotknij „+ Nowa", żeby zacząć — możesz pisać albo dyktować.</p>`}
      <button class="notes-link" data-key="1">Klucz API do dyktowania${groqKey() ? " ✓" : " (nie ustawiony)"}</button>
    </div>`;
}

function editorHTML(n) {
  return `
    <div class="notes-wrap">
      <div class="notes-head">
        <button class="notes-btn" data-back="1">← Wróć</button>
        <button class="notes-btn danger" data-del="${n.id}">Usuń</button>
      </div>
      <input class="note-title-input" data-title="${n.id}" placeholder="Tytuł notatki" value="${esc(n.title || "")}">
      <textarea class="note-text" data-text="${n.id}" placeholder="Pisz albo dyktuj...">${esc(n.text || "")}</textarea>
      <div class="notes-actions">
        <button class="rec-btn" data-rec="${n.id}">● Nagraj</button>
        <span class="rec-status"></span>
      </div>
      <p class="notes-tip">Bez klucza API możesz dyktować mikrofonem na klawiaturze iPhone'a — działa w tym samym polu.</p>
    </div>`;
}

function wireNotes(pane) {
  const q = sel => pane.querySelector(sel);

  const newBtn = q("[data-new]");
  if (newBtn) newBtn.onclick = () => {
    const n = { id: "n" + Date.now(), title: "", text: "", updated: Date.now() };
    notes.push(n);
    persistNotes();
    openNoteId = n.id;
    renderNotes();
  };

  pane.querySelectorAll("[data-open]").forEach(b => {
    b.onclick = () => { openNoteId = b.dataset.open; renderNotes(); };
  });

  const back = q("[data-back]");
  if (back) back.onclick = () => { openNoteId = null; renderNotes(); };

  const del = q("[data-del]");
  if (del) del.onclick = () => {
    notes = notes.filter(n => n.id !== del.dataset.del);
    persistNotes();
    openNoteId = null;
    renderNotes();
  };

  const keyBtn = q("[data-key]");
  if (keyBtn) keyBtn.onclick = () => {
    const current = groqKey();
    const val = prompt("Klucz API Groq (zostaje tylko na tym urządzeniu):", current);
    if (val === null) return;
    try { localStorage.setItem(GROQ_KEY_STORE, val.trim()); } catch (e) {}
    renderNotes();
  };

  const title = q("[data-title]");
  if (title) title.oninput = () => {
    const n = notes.find(x => x.id === title.dataset.title);
    if (n) { n.title = title.value; n.updated = Date.now(); persistNotes(); }
  };

  const text = q("[data-text]");
  if (text) text.oninput = () => {
    const n = notes.find(x => x.id === text.dataset.text);
    if (n) { n.text = text.value; n.updated = Date.now(); persistNotes(); }
  };

  const recBtn = q("[data-rec]");
  if (recBtn) recBtn.onclick = () => toggleRec(recBtn, q(".rec-status"), q("[data-text]"));
}

async function toggleRec(btn, status, textarea) {
  if (rec && rec.state === "recording") {
    rec.stop();
    btn.textContent = "● Nagraj";
    btn.classList.remove("recording");
    status.textContent = "Rozpoznaję mowę...";
    return;
  }
  if (!navigator.mediaDevices || !window.MediaRecorder) {
    status.textContent = "Ta przeglądarka nie pozwala nagrywać — użyj mikrofonu na klawiaturze.";
    return;
  }
  try {
    recStream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch (e) {
    status.textContent = "Brak zgody na mikrofon.";
    return;
  }
  recChunks = [];
  rec = new MediaRecorder(recStream);
  rec.ondataavailable = e => { if (e.data.size) recChunks.push(e.data); };
  rec.onstop = async () => {
    recStream.getTracks().forEach(t => t.stop());
    const blob = new Blob(recChunks, { type: rec.mimeType || "audio/mp4" });
    const txt = await transcribe(blob, status);
    if (txt) {
      const sep = textarea.value && !textarea.value.endsWith("\n") ? "\n" : "";
      textarea.value = textarea.value + sep + txt.trim();
      textarea.dispatchEvent(new Event("input"));
      status.textContent = "Gotowe.";
    }
  };
  rec.start();
  btn.textContent = "■ Zatrzymaj";
  btn.classList.add("recording");
  status.textContent = "Nagrywam...";
}

async function transcribe(blob, status) {
  const key = groqKey();
  if (!key) {
    status.textContent = "Brak klucza API — ustaw go na liście notatek, albo dyktuj mikrofonem klawiatury.";
    return null;
  }
  const ext = blob.type.includes("webm") ? "webm"
    : blob.type.includes("ogg") ? "ogg"
    : blob.type.includes("wav") ? "wav"
    : "m4a"; // mp4/aac (domyslne w Safari) i wszystko nierozpoznane
  const fd = new FormData();
  fd.append("file", blob, "nagranie." + ext);
  fd.append("model", GROQ_MODEL);
  fd.append("language", "pl");
  try {
    const r = await fetch(GROQ_URL, { method: "POST", headers: { Authorization: "Bearer " + key }, body: fd });
    if (!r.ok) {
      status.textContent = "Transkrypcja odrzucona (kod " + r.status + ").";
      return null;
    }
    const j = await r.json();
    return j.text || "";
  } catch (e) {
    status.textContent = "Nie udało się połączyć z usługą transkrypcji. Użyj mikrofonu na klawiaturze.";
    return null;
  }
}


/* =========================================================== USTAWIENIA ===
   W trybie aplikacji nie ma paska przegladarki, wiec odswiezanie, wersja
   i reszta ustawien musza byc w srodku.                                     */

function sheetHTML() {
  const keySet = groqKey() ? "ustawiony ✓" : "nie ustawiony";
  const notesLabel = notesOn ? "włączony" : "wyłączony";
  const readCount = Object.keys(seenCounts).length;
  return `
    <div class="sheet-card" role="dialog" aria-label="Ustawienia">
      <div class="sheet-head">
        <h2>Ustawienia</h2>
        <button class="sheet-x" data-close="1" aria-label="Zamknij">✕</button>
      </div>

      <button class="sheet-row" data-update="1">
        <span class="sheet-row-main">Sprawdź aktualizacje</span>
        <span class="sheet-row-sub">pobierz najnowszą wersję i przeładuj</span>
      </button>

      <button class="sheet-row" data-dir="1">
        <span class="sheet-row-main">Kierunek słówek</span>
        <span class="sheet-row-sub">${vocabDir === "pl-it" ? "polski → włoski" : "włoski → polski"}</span>
      </button>

      <button class="sheet-row" data-unfav="1">
        <span class="sheet-row-main">Wyczyść ulubione</span>
        <span class="sheet-row-sub">zapisanych kart: ${Object.keys(favs).length}</span>
      </button>

      <button class="sheet-row" data-notes="1">
        <span class="sheet-row-main">Notatnik</span>
        <span class="sheet-row-sub">${notesLabel} · otwiera go potrójne dotknięcie karty</span>
      </button>

      <button class="sheet-row" data-apikey="1">
        <span class="sheet-row-main">Klucz API do dyktowania</span>
        <span class="sheet-row-sub">${keySet}</span>
      </button>

      <button class="sheet-row" data-reset="1">
        <span class="sheet-row-main">Wyczyść postęp czytania</span>
        <span class="sheet-row-sub">przeczytanych kart: ${readCount}</span>
      </button>

      <p class="sheet-ver">Wersja ${APP_VERSION}</p>
    </div>`;
}

function openSheet() {
  let el = document.getElementById("sheet");
  if (!el) {
    el = document.createElement("div");
    el.id = "sheet";
    document.getElementById("app").appendChild(el);
  }
  el.innerHTML = sheetHTML();
  el.classList.add("open");

  el.onclick = (e) => { if (e.target === el) closeSheet(); };
  el.querySelector("[data-close]").onclick = closeSheet;

  el.querySelector("[data-update]").onclick = async () => {
    const row = el.querySelector("[data-update] .sheet-row-sub");
    row.textContent = "pobieram...";
    try {
      if ("serviceWorker" in navigator) {
        for (const r of await navigator.serviceWorker.getRegistrations()) await r.unregister();
      }
      if (window.caches) {
        for (const n of await caches.keys()) await caches.delete(n);
      }
    } catch (e) {}
    location.replace(location.pathname + "?v=" + Date.now());
  };

  el.querySelector("[data-dir]").onclick = () => {
    toggleVocabDir();
    openSheet();
  };

  el.querySelector("[data-unfav]").onclick = () => {
    if (!Object.keys(favs).length) return;
    if (!confirm("Usunąć wszystkie ulubione? Kart to nie kasuje.")) return;
    favs = {};
    saveNow();
    pager.querySelectorAll(".card .fav").forEach(h => h.classList.remove("on"));
    favsDirty = true;
    rebuildFavs();
    openSheet();
  };

  el.querySelector("[data-notes]").onclick = () => {
    try {
      if (notesOn) localStorage.removeItem(NOTES_FLAG);
      else localStorage.setItem(NOTES_FLAG, "1");
    } catch (e) {}
    location.replace(location.pathname);
  };

  el.querySelector("[data-apikey]").onclick = () => {
    const val = prompt("Klucz API Groq (zostaje tylko na tym urządzeniu):", groqKey());
    if (val === null) return;
    try { localStorage.setItem(GROQ_KEY_STORE, val.trim()); } catch (e) {}
    openSheet();
  };

  el.querySelector("[data-reset]").onclick = () => {
    if (!confirm("Wyczyścić historię przeczytanych kart? Znaki ∞ znikną.")) return;
    seenCounts = {};
    saveNow();
    buildQueues();
    buildPanes();
    openSheet();
  };
}

function closeSheet() {
  const el = document.getElementById("sheet");
  if (el) el.classList.remove("open");
}



/* =========================================================== CZYTANIE ===
   Wbudowany w system silnik mowy: dziala offline, bez klucza API, i ma
   naturalny glos polski na iPhonie. Groq TTS celowo pominiety - obsluguje
   dzis tylko angielski i arabski, a niemal cala tresc jest po polsku.       */

const READ_ICON = {
  idle: '<svg viewBox="0 0 20 20" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7.5h2.6L10 4.5v11L6.6 12.5H4z"/><path d="M13 7.3a4 4 0 0 1 0 5.4"/></svg>',
  active: '<svg viewBox="0 0 20 20" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7.5h2.6L10 4.5v11L6.6 12.5H4z"/><path d="M13 6.4a5.6 5.6 0 0 1 0 7.2M15.3 4.3a8.8 8.8 0 0 1 0 11.4"/></svg>'
};

function currentCardText(cat) {
  const pane = paneOf(cat);
  if (!pane || !pane.clientHeight) return null;
  const el = pane.children[Math.round(pane.scrollTop / pane.clientHeight)];
  if (!el) return null;
  const term = el.querySelector(".term");
  const body = el.querySelector(".body");
  // zaslonietego tlumaczenia nie czytamy - zdradziloby odpowiedz
  const translation = el.classList.contains("veiled") ? null : el.querySelector(".translation");
  const parts = [term, body, translation].filter(Boolean).map(n => n.textContent.trim());
  return parts.join(". ");
}

function setReadIcon(state) {
  const btn = document.getElementById("read-btn");
  if (!btn) return;
  btn.innerHTML = READ_ICON[state];
  btn.classList.toggle("reading", state === "active");
}

function stopReading() {
  if ("speechSynthesis" in window) speechSynthesis.cancel();
  setReadIcon("idle");
}

function toggleReadAloud() {
  if (!("speechSynthesis" in window)) return;
  if (speechSynthesis.speaking) { stopReading(); return; }

  const text = currentCardText(currentCat === "notatnik" ? "all" : currentCat);
  if (!text) return;

  const utter = new SpeechSynthesisUtterance(text);
  utter.lang = "pl-PL";
  utter.rate = 0.98;
  utter.onend = () => setReadIcon("idle");
  utter.onerror = () => setReadIcon("idle");
  speechSynthesis.speak(utter);
  setReadIcon("active");
}

document.getElementById("read-btn").addEventListener("click", toggleReadAloud);

// zmiana karty/dziedziny przerywa czytanie, zeby glos nie zostawal w tyle
pager.addEventListener("scroll", stopReading, { passive: true });
document.querySelectorAll(".tab").forEach(t => t.addEventListener("click", stopReading));

document.getElementById("settings-btn").addEventListener("click", openSheet);
