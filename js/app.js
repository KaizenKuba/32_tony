import { db } from './db.js';
import { Engine, encodeWav } from './audio.js';
import { analyzeBeat, envelope, autoLatency } from './analyze.js';
import { cloud, loggedIn, signIn, signUp, signOut, syncAll, pushLater, fetchBlob } from './sync.js';

// ---------- model ----------
const KINDS = [
  ['intro', 'Intro'], ['verse', 'Zwrotka'], ['prechorus', 'Przedrefren'], ['chorus', 'Refren'],
  ['bridge', 'Bridge'], ['outro', 'Outro'], ['other', 'Inne'],
];
const KIND_LABEL = Object.fromEntries(KINDS);
const NUMBERED = new Set(['verse', 'chorus', 'prechorus', 'bridge', 'other']);

const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2) + Date.now());
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const ICON = {
  eye: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12z"/><circle cx="12" cy="12" r="3"/></svg>',
  eyeOff: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 10s3.5 5 10 5 10-5 10-5"/><path d="M5 13.5 3 16M9.5 15 8.5 18M14.5 15l1 3M19 13.5l2 2.5"/></svg>',
  trash: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14"/></svg>',
};
const newLine = () => ({ id: uid(), versions: [{ id: uid(), text: '', visible: true }] });
const secTitle = s => NUMBERED.has(s.kind) ? `${KIND_LABEL[s.kind]} ${s.number}` : KIND_LABEL[s.kind];
const barDur = p => 60 / p.bpm * p.beatsPerBar;
const barCount = p => (p.beatDuration > 0 && p.bpm > 0) ? Math.max(1, Math.ceil((p.beatDuration - p.firstDownbeat) / barDur(p))) : 0;
const timeOfBar = (p, b) => p.firstDownbeat + (b - 1) * barDur(p);
const barAt = (p, t) => Math.max(1, Math.floor((t - p.firstDownbeat) / barDur(p)) + 1);
const sectionAt = (p, b) => p.sections.find(s => b >= s.startBar && b <= s.endBar);

function syncLines(s) {
  const n = s.endBar - s.startBar + 1;
  while (s.lines.length < n) s.lines.push(newLine());
  if (s.lines.length > n) s.lines.length = n;
}

function newProject(name) {
  return {
    id: uid(), name: name || 'Nowa piosenka', created: Date.now(),
    beatKey: null, beatName: '', beatDuration: 0, bpm: 90, beatsPerBar: 4, firstDownbeat: 0,
    sections: [], tracks: [],
    playMode: 'long', longStartBar: 1, loopStartBar: 1, loopEndBar: 4,
  };
}

// ---------- stan ----------
const engine = new Engine();
const state = {
  projects: [],
  currentId: localStorage.getItem('currentId'),
  tab: 'projects',
  sel: null, // {a, b}
  follow: true,
  analyzing: false,
  latencyMs: Number(localStorage.getItem('latencyMs') || 0),
  micId: localStorage.getItem('micId') || '',
  micLabel: '',
  inputs: [],
  recTrackId: null,
};
const buffers = new Map(); // key -> AudioBuffer
const cur = () => state.projects.find(p => p.id === state.currentId);

let saveTimer;
function save(p = cur()) {
  if (!p) return;
  clearTimeout(saveTimer);
  p.updated = Date.now();
  saveTimer = setTimeout(() => db.putProject(p), 250);
  pushLater(p);
}
window.addEventListener('pagehide', () => { const p = cur(); if (p) db.putProject(p); });

async function getBuffer(key) {
  if (!key) return null;
  if (buffers.has(key)) return buffers.get(key);
  const blob = (await db.getBlob(key)) || (await fetchBlob(key));
  if (!blob) return null;
  const b = await engine.decode(blob);
  buffers.set(key, b);
  return b;
}

// ---------- DOM ----------
const $ = s => document.querySelector(s);
const view = $('#view'), transport = $('#transport'), titleEl = $('#title'), topAction = $('#topaction');

function setTab(t) {
  if (t !== 'projects' && !cur()) t = 'projects';
  state.tab = t;
  document.querySelectorAll('#tabs button').forEach(b => {
    b.classList.toggle('on', b.dataset.tab === t);
    b.disabled = b.dataset.tab !== 'projects' && !cur();
  });
  view.scrollTop = 0;
  render();
}

function render() {
  const keep = view.scrollTop;
  const p = cur();
  topAction.innerHTML = '';
  if (state.tab === 'projects') renderProjects();
  else if (state.tab === 'beat') renderBeat(p);
  else if (state.tab === 'notes') renderNotes(p);
  else renderLyrics(p);
  transport.hidden = state.tab === 'projects' || !p || !p.beatKey;
  if (!transport.hidden) renderTransport(p);
  view.scrollTop = keep;
  initTimeline();
  updatePlayhead(true);
}

// ---------- Projekty ----------
function cloudHTML() {
  if (!cloud.enabled) return '';
  if (loggedIn()) return `<div class="card cloud"><div class="row"><span>☁︎</span><span class="spacer small">
      <b>${esc(cloud.session.user?.email || '')}</b><br><span class="muted" id="cloudstatus">${esc(cloud.status)}</span></span>
      <button class="btn small" data-act="sync-now" ${cloud.busy ? 'disabled' : ''}>Zapisz / odśwież</button>
      <button class="btn small" data-act="logout">Wyloguj</button></div></div>`;
  return `<div class="card cloud"><h2>Synchronizacja</h2>
    <div class="small muted">Zaloguj się na telefonie i komputerze tym samym kontem, a projekty, bity i nagrania będą wszędzie te same.</div>
    <input type="email" id="cl-email" placeholder="e-mail" autocomplete="username" style="width:100%;margin-top:10px">
    <input type="password" id="cl-pass" placeholder="hasło (min. 6 znaków)" autocomplete="current-password" style="width:100%;margin-top:8px">
    <div class="row" style="margin-top:10px"><button class="btn primary" data-act="login">Zaloguj</button>
      <button class="btn" data-act="signup">Załóż konto</button></div>
    ${cloud.status ? `<div class="small muted" style="margin-top:6px">${esc(cloud.status)}</div>` : ''}</div>`;
}

function renderProjects() {
  titleEl.textContent = 'Projekty';
  topAction.innerHTML = `<button class="btn small primary" data-act="new-project">+ Nowa</button>`;
  if (!state.projects.length) {
    view.innerHTML = cloudHTML() + `<div class="empty"><div class="big">🎤</div>Brak piosenek.<br>Dodaj nowy projekt.<br><br>
      <button class="btn primary" data-act="new-project">+ Nowa piosenka</button></div>`;
    return;
  }
  view.innerHTML = cloudHTML() + `<ul class="plist">${state.projects.map(p => {
    const lines = p.sections.reduce((s, x) => s + x.lines.length, 0);
    const meta = p.beatKey ? `${Math.round(p.bpm)} BPM · ${barCount(p)} taktów · ${lines} wersów` : 'Bez bitu';
    return `<li class="${p.id === state.currentId ? 'cur' : ''}" data-act="open" data-id="${p.id}">
      <div class="spacer"><div class="pname">${esc(p.name)}</div><div class="small muted">${meta}</div></div>
      <button class="iconbtn" data-act="rename" data-id="${p.id}" aria-label="Zmień nazwę">✎</button>
      <button class="iconbtn" data-act="del-project" data-id="${p.id}" aria-label="Usuń">${ICON.trash}</button></li>`;
  }).join('')}</ul>`;
}

// ---------- Bit ----------
function renderBeat(p) {
  titleEl.textContent = p.name;
  if (!p.beatKey) {
    view.innerHTML = `<div class="empty"><div class="big">〰</div>
      Dodaj bit, a aplikacja sama sprawdzi BPM i podzieli go na takty.<br><br>
      <label class="btn primary">+ Dodaj bit<input type="file" data-act="beat-file" hidden></label>
      ${state.analyzing ? '<p>Analizuję bit…</p>' : ''}</div>`;
    return;
  }
  topAction.innerHTML = `<label class="btn small">Zmień bit<input type="file" data-act="beat-file" hidden></label>`;
  const n = barCount(p);
  const a = state.sel ? Math.min(state.sel.a, state.sel.b ?? state.sel.a) : null;
  const b = state.sel ? Math.max(state.sel.a, state.sel.b ?? state.sel.a) : null;

  view.innerHTML = `
  <div class="card">
    <h2>Bit</h2>
    <div class="small muted">${esc(p.beatName)} · ${fmtTime(p.beatDuration)}</div>
    <div class="row"><span>BPM</span><span class="spacer"></span>
      <button class="btn icon" data-act="bpm" data-d="-0.5">−</button>
      <input type="number" step="0.1" inputmode="decimal" value="${p.bpm}" data-act="bpm-input" style="width:80px;text-align:center">
      <button class="btn icon" data-act="bpm" data-d="0.5">+</button></div>
    <div class="row"><span>Tempo</span><span class="spacer"></span>
      <button class="btn small tap" data-act="tap">${tap.times.length > 1 ? 'Tap · ' + tap.bpm.toFixed(1) : 'Tap tempo'}</button>
      <button class="btn small" data-act="bpm-mul" data-m="0.5">÷2</button>
      <button class="btn small" data-act="bpm-mul" data-m="2">×2</button></div>
    <div class="row"><span>Początek taktu 1</span><span class="spacer"></span>
      <button class="btn icon" data-act="down" data-d="-0.01">‹</button>
      <span style="width:64px;text-align:center" class="small">${p.firstDownbeat.toFixed(2)} s</span>
      <button class="btn icon" data-act="down" data-d="0.01">›</button></div>
    <div class="row"><button class="btn small" data-act="down-beat">Przesuń „jedynkę” o 1 bit</button>
      <span class="spacer"></span>
      <button class="btn small" data-act="reanalyze" ${state.analyzing ? 'disabled' : ''}>${state.analyzing ? 'Analizuję…' : 'Wykryj ponownie'}</button></div>
    <div class="row small muted">${n} taktów · metrum ${p.beatsPerBar}/4${p.beatEdited ? ' · bit przycięty' : ''}</div>
    ${p.undo ? `<div class="row"><button class="btn small" data-act="undo-cut">↶ Cofnij ostatnie wycięcie (takty ${p.undo.a}–${p.undo.b})</button></div>` : ''}
  </div>

  <div class="card">
    <h2>Takty</h2>
    <div class="tl-tools row">
      <div class="seg"><button class="${tl.mode === 'scroll' ? 'on' : ''}" data-act="tl-mode" data-m="scroll">Odtwarzaj</button>
        <button class="${tl.mode === 'section' ? 'on' : ''}" data-act="tl-mode" data-m="section">Przesuń sekcję</button>
        <button class="${tl.mode === 'grid' ? 'on' : ''}" data-act="tl-mode" data-m="grid" ${tl.locked ? 'disabled' : ''}>Przesuń takty</button></div>
      <button class="btn icon small ${tl.locked ? '' : 'unlocked'}" data-act="tl-lock" aria-label="Kłódka">${tl.locked ? '🔒' : '🔓'}</button>
      <span class="tltime" id="tltime"></span>
      <span class="spacer"></span>
      <button class="btn icon small" data-act="tl-zoom" data-z="0.5">−</button>
      <button class="btn icon small" data-act="tl-zoom" data-z="2">+</button>
    </div>
    <canvas id="tl" class="tl ${tl.mode}"></canvas>
    <div class="row small" style="margin-top:6px">
      <span class="muted">${{ grid: 'Przeciągnij, aż linie taktów trafią w uderzenia. Potem zamknij kłódkę.',
        section: 'Złap sekcję i przeciągnij ją w inne miejsce (skacze co takt).',
        scroll: 'Stuknij, by ustawić playhead (skacze co bit), i Start. Przeciągnij, by przewijać. Ctrl + kółko: zoom.' }[tl.mode]}</span>
      <span class="spacer"></span>
      <span class="muted">BPM</span><button class="btn small" data-act="bpm" data-d="-0.1">−0,1</button>
      <button class="btn small" data-act="bpm" data-d="0.1">+0,1</button>
    </div>
    <div style="height:10px"></div>
    <div class="bars">${Array.from({ length: n }, (_, i) => {
      const bar = i + 1, s = sectionAt(p, bar);
      const sel = a != null && bar >= a && bar <= b;
      return `<div class="bar ${s ? 'k-' + s.kind : ''} ${sel ? 'sel' : ''}" data-act="bar" data-bar="${bar}">${bar}</div>`;
    }).join('')}</div>
    ${a != null ? `
      <div class="row" style="margin-top:10px"><b>Zaznaczone: ${a}–${b}</b> <span class="muted small">(${b - a + 1} taktów)</span>
        <span class="spacer"></span><button class="iconbtn" data-act="sel-clear">✕</button></div>
      <div class="kinds">${KINDS.map(([k, l]) => `<button class="chip k-${k}" data-act="mark" data-kind="${k}">${l}</button>`).join('')}
        <button class="chip" style="background:var(--panel2);color:var(--text)" data-act="unmark">Wyczyść</button></div>
      <div class="row" style="margin-top:10px"><button class="btn danger" data-act="cut-bars" ${state.cutting ? 'disabled' : ''}>✂ ${state.cutting ? 'Wycinam…' : `Wytnij takty ${a}–${b} z bitu`}</button></div>`
      : `<p class="small muted" style="margin:10px 0 0">Stuknij pierwszy i ostatni takt sekcji, potem wybierz typ. Każdy takt to jeden wers w zakładce Tekst.</p>`}
  </div>

  <div class="card seclist">
    <h2>Sekcje</h2>
    ${p.sections.length ? p.sections.map(s => `
      <div class="row"><span class="dot k-${s.kind}"></span><b>${secTitle(s)}</b><span class="spacer"></span>
      <span class="small muted">takty ${s.startBar}–${s.endBar} · ${s.lines.length} wersów</span>
      <button class="iconbtn" data-act="del-section" data-id="${s.id}">${ICON.trash}</button></div>`).join('')
      : '<div class="muted small">Brak oznaczonych sekcji.</div>'}
  </div>

  <div class="card">
    <h2>Nagrywanie</h2>
    ${p.tracks.map(t => trackHTML(p, t)).join('')}
    <div class="row" style="margin-top:10px"><button class="btn small" data-act="add-track">+ Nowa ścieżka</button></div>
    <div class="row wrap" style="margin-top:12px">
      <span class="small">Mikrofon</span>
      <select data-act="mic" style="flex:1;min-width:0">
        <option value="">Domyślny (iPhone)</option>
        ${state.inputs.map(d => `<option value="${esc(d.deviceId)}" ${d.deviceId === state.micId ? 'selected' : ''}>${esc(d.label || 'Mikrofon')}</option>`).join('')}
      </select>
      <button class="btn small" data-act="mic-refresh">Odśwież</button>
    </div>
    ${state.micLabel ? `<div class="small muted" style="margin-top:6px">Ostatnio nagrywano: ${esc(state.micLabel)}</div>` : ''}
    <div class="notice" style="margin-top:10px">Muzyka leci na słuchawki, jeśli są podłączone. W przeglądarce iPhone może przełączyć nagrywanie na mikrofon słuchawek (AirPods, słuchawki z mikrofonem) – wybierz wtedy „iPhone Mikrofon” powyżej. Najpewniej działa ze słuchawkami przewodowymi bez mikrofonu.</div>
  </div>

  <div class="card">
    <h2>Latencja</h2>
    <div class="row"><span>Korekta nagrań</span><span class="spacer"></span><b>${Math.round(state.latencyMs)} ms</b></div>
    <div class="row"><button class="btn" data-act="latency">Test latencji</button></div>
  </div>`;
}

function trackHTML(p, t) {
  const rec = engine.recording && state.recTrackId === t.id;
  return `<div class="track" data-track="${t.id}">
    <div class="row">
      <input type="text" value="${esc(t.name)}" data-act="track-name" data-id="${t.id}">
      <button class="iconbtn ${t.muted ? '' : 'on'}" data-act="mute" data-id="${t.id}">${t.muted ? '🔇' : '🔊'}</button>
      <button class="recbtn ${rec ? 'on' : ''}" data-act="record" data-id="${t.id}">${rec ? '■' : '●'}</button>
      <button class="iconbtn" data-act="del-track" data-id="${t.id}">${ICON.trash}</button>
    </div>
    <div class="row"><span class="small muted">Głośność</span><input type="range" min="0" max="1.5" step="0.05" value="${t.volume}" data-act="vol" data-id="${t.id}"></div>
    ${t.takes.map(k => `<div class="take">● Nagranie od taktu ${barAt(p, k.startTime)}<span class="spacer"></span>
      <button class="iconbtn" data-act="del-take" data-id="${t.id}" data-take="${k.id}">${ICON.trash}</button></div>`).join('')}
  </div>`;
}

// ---------- Notatnik ----------
function renderNotes(p) {
  titleEl.textContent = p.name;
  view.innerHTML = `<textarea class="notes" data-act="notes" placeholder="Notatki, pomysły, linijki na później…">${esc(p.notes || '')}</textarea>`;
}

// ---------- Tekst ----------
function renderLyrics(p) {
  titleEl.textContent = p.name;
  topAction.innerHTML = `<button class="btn small ${state.follow ? 'primary' : ''}" data-act="follow">Śledź ${state.follow ? '✓' : ''}</button>`;
  if (!p.sections.length) {
    view.innerHTML = `<div class="empty"><div class="big">≡</div>Brak sekcji.<br>W zakładce Bit zaznacz takty i oznacz je jako intro, zwrotkę, refren…</div>`;
    return;
  }
  view.innerHTML = p.sections.map(s => `
    <section class="lsec ${s.collapsed ? 'collapsed' : ''}">
      <div class="lsec-h" data-act="collapse" data-id="${s.id}"><span class="chev">${s.collapsed ? '▸' : '▾'}</span><span class="dot k-${s.kind}"></span>${secTitle(s)}<span class="spacer"></span>
        <span class="small muted">${s.collapsed ? `takty ${s.startBar}–${s.endBar} · ` : ''}${s.lines.length} wersów</span></div>
      ${s.collapsed ? '' : s.lines.map((l, i) => lineHTML(s, l, i)).join('')}
    </section>`).join('');
  view.querySelectorAll('textarea').forEach(autoSize);
}

function lineHTML(s, l, i) {
  const bar = s.startBar + i;
  return `<div class="line" data-line-bar="${bar}" data-sec="${s.id}" data-line="${l.id}">
    <div class="lnum"><span class="abs">${bar}</span><span class="rel">${i + 1}</span></div>
    <div class="versions">
      ${l.versions.map(v => v.visible ? `
        <div class="ver"><textarea rows="1" placeholder="Wers ${i + 1}…" data-act="text" data-v="${v.id}">${esc(v.text)}</textarea>
          <button class="iconbtn" data-act="eye" data-v="${v.id}" aria-label="Ukryj">${ICON.eye}</button>
          <button class="iconbtn" data-act="del-ver" data-v="${v.id}" aria-label="Usuń">${ICON.trash}</button></div>` : `
        <div class="ver hidden"><div class="ghost">${esc(v.text) || 'ukryta wersja'}</div>
          <button class="iconbtn" data-act="eye" data-v="${v.id}" aria-label="Pokaż">${ICON.eyeOff}</button>
          <button class="iconbtn" data-act="del-ver" data-v="${v.id}" aria-label="Usuń">${ICON.trash}</button></div>`).join('')}
      <button class="addver" data-act="add-ver">＋ wersja</button>
    </div>
  </div>`;
}

function autoSize(t) { t.style.height = 'auto'; t.style.height = t.scrollHeight + 'px'; }

// ---------- Transport ----------
function barOptions(p, selected) {
  const n = Math.max(1, barCount(p));
  let html = '';
  for (let b = 1; b <= n; b++) {
    const s = sectionAt(p, b);
    const label = s ? `${b} · ${secTitle(s)} ${b - s.startBar + 1}` : `${b}`;
    html += `<option value="${b}" ${b === selected ? 'selected' : ''}>${label}</option>`;
  }
  return html;
}

function renderTransport(p) {
  const loop = p.playMode === 'loop';
  transport.innerHTML = `
    <div class="row tbars">
      <div class="seg"><button class="${loop ? '' : 'on'}" data-act="mode" data-m="long">Long</button>
        <button class="${loop ? 'on' : ''}" data-act="mode" data-m="loop">Pętla</button></div>
      ${loop
        ? `<select data-act="loop-a">${barOptions(p, p.loopStartBar)}</select><span class="muted">–</span><select data-act="loop-b">${barOptions(p, p.loopEndBar)}</select>`
        : `<span class="small muted">od</span><select data-act="long-a">${barOptions(p, p.cursor != null ? barAt(p, p.cursor) : p.longStartBar)}</select>`}
      <span class="spacer"></span><span id="tbar"></span>
    </div>
    <div class="tbtns">
      <button class="btn primary start ${engine.playing ? 'playing' : ''}" data-act="start">▶ Start</button>
      <button class="btn" data-act="stop">■ Stop</button>
    </div>`;
}

// ---------- playhead ----------
let lastBar = null;
function updatePlayhead(force = false) {
  if (engine.playing || force) drawTimeline(true);
  const p = cur();
  const tb = document.getElementById('tbar');
  if (!p || !p.beatKey) return;
  const bar = engine.playing ? barAt(p, engine.position) : null;
  if (tb) tb.textContent = engine.playing ? `T${bar}` : '';
  if (bar === lastBar && !force) return;
  lastBar = bar;
  view.querySelectorAll('.now').forEach(e => e.classList.remove('now'));
  if (bar == null) return;
  const cell = view.querySelector(`.bar[data-bar="${bar}"]`);
  if (cell) cell.classList.add('now');
  const line = view.querySelector(`.line[data-line-bar="${bar}"]`);
  if (line) {
    line.classList.add('now');
    if (state.follow && state.tab === 'lyrics' && !force && !line.contains(document.activeElement)) {
      line.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }
  }
}
(function loop() { if (engine.playing) updatePlayhead(); requestAnimationFrame(loop); })();
engine.onStateChange = () => {
  const s = transport.querySelector('.start');
  if (s) s.classList.toggle('playing', engine.playing);
  if (!engine.playing) updatePlayhead(true);
};

// ---------- akcje audio ----------
async function takesFor(p, extraSkipTrack) {
  const out = [];
  for (const t of p.tracks) {
    if (t.muted) continue;
    for (const k of t.takes) {
      const buffer = await getBuffer(k.key);
      if (buffer) out.push({ buffer, position: k.startTime - state.latencyMs / 1000, volume: t.volume });
    }
  }
  return out;
}

const fmtClock = t => { t = Math.max(0, t || 0); const m = Math.floor(t / 60), s = t - m * 60; return `${m}:${s.toFixed(1).padStart(4, '0')}`; };
const startPos = p => (p.cursor != null && p.cursor < p.beatDuration) ? p.cursor : timeOfBar(p, p.longStartBar);
const snapBeat = (p, t) => { const bt = 60 / p.bpm; return Math.max(0, p.firstDownbeat + Math.round((t - p.firstDownbeat) / bt) * bt); };

async function startPlayback() {
  const p = cur();
  await engine.unlock();
  const beat = await getBuffer(p.beatKey);
  const takes = await takesFor(p);
  if (p.playMode === 'loop') {
    const a = Math.min(p.loopStartBar, p.loopEndBar), b = Math.max(p.loopStartBar, p.loopEndBar);
    engine.play({ beat, pos: timeOfBar(p, a), loop: [timeOfBar(p, a), timeOfBar(p, b + 1)], takes });
  } else {
    engine.play({ beat, pos: startPos(p), takes });
  }
}

async function toggleRecord(trackId) {
  const p = cur();
  if (engine.recording) { engine.stop(); return; }
  await engine.unlock();
  const beat = await getBuffer(p.beatKey);
  const takes = await takesFor(p);
  let pos, stopAt = null;
  if (p.playMode === 'loop') {
    const a = Math.min(p.loopStartBar, p.loopEndBar), b = Math.max(p.loopStartBar, p.loopEndBar);
    pos = timeOfBar(p, a); stopAt = Math.min(timeOfBar(p, b + 1), p.beatDuration);
  } else pos = startPos(p);
  state.recTrackId = trackId;
  try {
    await engine.record({
      beat, pos, stopAt, takes, deviceId: state.micId,
      onDone: async ({ buffer, blob, startPos }) => {
        const key = 'take-' + uid();
        await db.putBlob(key, blob);
        buffers.set(key, buffer);
        const t = p.tracks.find(x => x.id === trackId);
        if (t) t.takes.push({ id: uid(), key, startTime: startPos });
        state.recTrackId = null;
        save(p);
        if (state.tab === 'beat') render();
      },
    });
    state.micLabel = engine.stream?.getAudioTracks()[0]?.label || '';
    refreshInputs();
  } catch (e) {
    state.recTrackId = null;
    alert('Brak dostępu do mikrofonu: ' + e.message);
  }
  render();
}

async function refreshInputs() {
  state.inputs = await engine.listInputs();
  if (state.tab === 'beat') {
    const sel = view.querySelector('select[data-act="mic"]');
    if (sel) render();
  }
}

async function importBeat(file) {
  const p = cur();
  engine.stop();
  state.analyzing = true; render();
  try {
    const key = 'beat-' + uid();
    await db.putBlob(key, file);
    const buffer = await engine.decode(file);
    if (p.beatKey) { db.deleteBlob(p.beatKey); buffers.delete(p.beatKey); }
    dropUndo(p); p.beatEdited = false;
    buffers.set(key, buffer);
    p.beatKey = key; p.beatName = file.name; p.beatDuration = buffer.duration;
    await analyze(p, buffer);
  } catch (e) {
    alert('Nie udało się wczytać pliku: ' + e.message);
  }
  state.analyzing = false;
  save(p); render();
}

async function analyze(p, buffer) {
  await new Promise(r => setTimeout(r, 30));
  const r = analyzeBeat(buffer);
  p.bpm = r.bpm; p.firstDownbeat = r.firstBeat;
  clampSections(p);
  if (p.loopEndBar > barCount(p)) p.loopEndBar = Math.min(4, barCount(p));
}

function clampSections(p) {
  const n = barCount(p);
  p.sections = p.sections.filter(s => s.startBar <= n);
  p.sections.forEach(s => { s.endBar = Math.min(s.endBar, n); syncLines(s); });
}

// ---------- sekcje ----------
function markSection(p, kind) {
  const lo = Math.min(state.sel.a, state.sel.b ?? state.sel.a);
  const hi = Math.max(state.sel.a, state.sel.b ?? state.sel.a);
  const out = [];
  for (const s of p.sections) {
    if (s.endBar < lo || s.startBar > hi) { out.push(s); continue; }
    if (s.startBar < lo) {
      const left = { ...s, id: uid(), endBar: lo - 1, lines: s.lines.slice(0, lo - s.startBar) };
      syncLines(left); out.push(left);
    }
    if (s.endBar > hi) {
      const right = { ...s, id: uid(), startBar: hi + 1, lines: s.lines.slice(hi + 1 - s.startBar) };
      syncLines(right); out.push(right);
    }
  }
  if (kind) {
    const ns = { id: uid(), kind, number: 1, startBar: lo, endBar: hi, lines: [] };
    syncLines(ns); out.push(ns);
  }
  out.sort((x, y) => x.startBar - y.startBar);
  const cnt = {};
  out.forEach(s => { cnt[s.kind] = (cnt[s.kind] || 0) + 1; s.number = cnt[s.kind]; });
  p.sections = out;
  state.sel = null;
}

// ---------- test latencji ----------
const modal = $('#modal');
const lt = { take: null, beatEnv: [], takeEnv: [], offset: 0 };

function latencyWindow(p) {
  const s = timeOfBar(p, 1);
  return [s, Math.min(timeOfBar(p, 5), p.beatDuration)];
}

function openLatency() {
  lt.offset = state.latencyMs;
  renderLatency();
  modal.hidden = false;
}

function renderLatency() {
  modal.innerHTML = `<div class="sheet">
    <div class="row"><h3>Test latencji</h3><span class="spacer"></span>
      <button class="btn small" data-act="lt-close">Zamknij</button></div>
    <ol class="steps small">
      <li>Załóż słuchawki.</li>
      <li>Stuknij „Nagraj test” – zagrają 4 takty od początku bitu.</li>
      <li>Rób beatbox na werbel razem z bitem.</li>
      <li>Przesuń nagranie (czerwone), aż werble pokryją się z bitem (niebieski), i zapisz.</li>
    </ol>
    <div class="row"><button class="btn primary" data-act="lt-rec" ${engine.recording ? 'disabled' : ''}>${engine.recording ? 'Nagrywam…' : '● Nagraj test'}</button></div>
    ${lt.take ? `
      <canvas class="wave" id="ltc" style="margin-top:12px"></canvas>
      <div class="row" style="margin-top:10px"><span>Przesunięcie</span><span class="spacer"></span><span class="big-ms" id="ltms">${Math.round(lt.offset)} ms</span></div>
      <input type="range" min="-100" max="500" step="1" value="${lt.offset}" data-act="lt-slider">
      <div class="row">${[-10, -1, 1, 10].map(d => `<button class="btn" style="flex:1" data-act="lt-nudge" data-d="${d}">${d > 0 ? '+' + d : d}</button>`).join('')}</div>
      <div class="row"><button class="btn" data-act="lt-auto">✨ Dopasuj automatycznie</button></div>
      <div class="row"><button class="btn" style="flex:1" data-act="lt-play">▶ Odsłuchaj</button>
        <button class="btn" style="flex:1" data-act="stop">■ Stop</button></div>
      <div class="row"><button class="btn primary" style="flex:1" data-act="lt-save">Zapisz latencję</button></div>` : ''}
    <p class="small muted">Aktualna latencja: ${Math.round(state.latencyMs)} ms. Zrób test osobno dla słuchawek przewodowych i Bluetooth.</p>
  </div>`;
  drawLatency();
}

function drawLatency() {
  const c = document.getElementById('ltc');
  if (!c) return;
  const dpr = window.devicePixelRatio || 1;
  c.width = c.clientWidth * dpr; c.height = c.clientHeight * dpr;
  const g = c.getContext('2d');
  const W = c.width, H = c.height, h = H / 2;
  const shift = Math.round(lt.offset);
  const n = Math.max(1, lt.beatEnv.length);
  const draw = (env, off, y0, col) => {
    const peak = Math.max(...env, 1e-4);
    g.strokeStyle = col; g.lineWidth = 1; g.beginPath();
    for (let x = 0; x < W; x++) {
      const i = Math.floor(x / W * n);
      const step = Math.max(1, Math.floor(n / W));
      let m = 0;
      for (let k = i; k < i + step; k++) { const j = k + off; if (j >= 0 && j < env.length && env[j] > m) m = env[j]; }
      const v = m / peak * h * 0.45;
      g.moveTo(x, y0 + h / 2 - v); g.lineTo(x, y0 + h / 2 + v);
    }
    g.stroke();
  };
  g.clearRect(0, 0, W, H);
  draw(lt.beatEnv, 0, 0, '#3d8bff');
  draw(lt.takeEnv, shift, h, '#ff5a36');
  // linie taktów/beatów
  const p = cur(); const beatMs = 60000 / p.bpm;
  g.strokeStyle = 'rgba(128,128,128,.35)';
  for (let t = 0; t < n; t += beatMs) { const x = t / n * W; g.beginPath(); g.moveTo(x, 0); g.lineTo(x, H); g.stroke(); }
}

async function latencyRecord() {
  const p = cur();
  await engine.unlock();
  const beat = await getBuffer(p.beatKey);
  const [s, e] = latencyWindow(p);
  try {
    await engine.record({
      beat, pos: s, stopAt: e, takes: [], deviceId: state.micId,
      onDone: ({ buffer, startPos }) => {
        lt.take = { buffer, startPos };
        lt.beatEnv = envelope(beat, s, e - s, 1000);
        const raw = envelope(buffer, 0, e - s + 1, 1000);
        const lead = Math.round((startPos - s) * 1000);
        lt.takeEnv = lead >= 0 ? new Array(lead).fill(0).concat(raw) : raw.slice(-lead);
        renderLatency();
      },
    });
  } catch (err) { alert('Brak dostępu do mikrofonu: ' + err.message); }
  renderLatency();
}

async function latencyPlay() {
  const p = cur();
  await engine.unlock();
  const beat = await getBuffer(p.beatKey);
  const [s, e] = latencyWindow(p);
  engine.play({ beat, pos: s, loop: [s, e], takes: [{ buffer: lt.take.buffer, position: lt.take.startPos - lt.offset / 1000, volume: 1 }] });
}

function setOffset(v) {
  lt.offset = Math.max(-100, Math.min(500, v));
  const ms = document.getElementById('ltms'); if (ms) ms.textContent = `${Math.round(lt.offset)} ms`;
  const sl = modal.querySelector('[data-act="lt-slider"]'); if (sl) sl.value = lt.offset;
  drawLatency();
}

// ---------- obsługa zdarzeń ----------
function findVersion(p, el) {
  const line = el.closest('.line');
  const s = p.sections.find(x => x.id === line.dataset.sec);
  const l = s.lines.find(x => x.id === line.dataset.line);
  const v = el.dataset.v ? l.versions.find(x => x.id === el.dataset.v) : null;
  return { s, l, v, lineEl: line };
}

function rerenderLine(lineEl, s, l) {
  const i = s.lines.indexOf(l);
  lineEl.outerHTML = lineHTML(s, l, i);
  const fresh = view.querySelector(`.line[data-line="${l.id}"]`);
  fresh.querySelectorAll('textarea').forEach(autoSize);
  return fresh;
}

document.addEventListener('click', async e => {
  const el = e.target.closest('[data-act]');
  if (!el) {
    const tab = e.target.closest('#tabs button');
    if (tab && !tab.disabled) setTab(tab.dataset.tab);
    return;
  }
  const act = el.dataset.act;
  const p = cur();
  switch (act) {
    case 'new-project': {
      const name = prompt('Nazwa piosenki', '');
      if (name === null) return;
      const np = newProject(name.trim());
      np.updated = Date.now(); state.projects.unshift(np); await db.putProject(np); pushLater(np);
      openProject(np.id, 'beat');
      return;
    }
    case 'open': if (e.target.closest('.iconbtn')) return; openProject(el.dataset.id, 'beat'); return;
    case 'rename': {
      const pr = state.projects.find(x => x.id === el.dataset.id);
      const name = prompt('Nowa nazwa', pr.name);
      if (name) { pr.name = name.trim(); save(pr); render(); }
      return;
    }
    case 'del-project': {
      const pr = state.projects.find(x => x.id === el.dataset.id);
      if (!confirm(`Usunąć „${pr.name}” razem z nagraniami?`)) return;
      if (pr.id === state.currentId) { engine.stop(); state.currentId = null; localStorage.removeItem('currentId'); }
      if (pr.beatKey) db.deleteBlob(pr.beatKey);
      if (pr.undo) db.deleteBlob(pr.undo.beatKey);
      pr.tracks.forEach(t => t.takes.forEach(k => db.deleteBlob(k.key)));
      await db.deleteProject(pr.id);
      pr.updated = Date.now(); pushLater(pr, true);
      state.projects = state.projects.filter(x => x !== pr);
      setTab('projects');
      return;
    }
    case 'bpm': p.bpm = Math.max(40, Math.min(240, Math.round((p.bpm + Number(el.dataset.d)) * 100) / 100)); clampSections(p); save(); render(); return;
    case 'bpm-mul': p.bpm = Math.round(p.bpm * Number(el.dataset.m) * 10) / 10; clampSections(p); save(); render(); return;
    case 'down': nudgeDown(p, Number(el.dataset.d)); return;
    case 'down-beat': nudgeDown(p, barDur(p) / p.beatsPerBar); return;
    case 'reanalyze': {
      state.analyzing = true; render();
      await analyze(p, await getBuffer(p.beatKey));
      state.analyzing = false; save(); render(); return;
    }
    case 'bar': {
      const b = Number(el.dataset.bar);
      if (!state.sel || state.sel.b != null) state.sel = { a: b, b: null };
      else state.sel.b = b;
      render(); return;
    }
    case 'tap': return; // obsługa w pointerdown (dokładniejszy czas)
    case 'tl-mode': tl.mode = el.dataset.m; render(); return;
    case 'tl-lock': tl.locked = !tl.locked; localStorage.setItem('tlLocked', tl.locked ? '1' : '0'); if (tl.locked && tl.mode === 'grid') tl.mode = 'scroll'; render(); return;
    case 'tl-zoom': {
      const c = tlCanvas(); const w = c ? c.clientWidth : 300;
      const center = tl.start + w / tl.pps / 2;
      tl.pps = Math.max(8, Math.min(600, tl.pps * Number(el.dataset.z)));
      tl.start = Math.max(0, center - w / tl.pps / 2);
      drawTimeline(); return;
    }
    case 'sel-clear': state.sel = null; render(); return;
    case 'cut-bars': cutBars(p); return;
    case 'login': case 'signup': {
      const email = $('#cl-email').value.trim(), pass = $('#cl-pass').value;
      if (!email || pass.length < 6) { alert('Podaj e-mail i hasło (min. 6 znaków).'); return; }
      el.disabled = true;
      try {
        if (act === 'login') await signIn(email, pass);
        else if (!(await signUp(email, pass))) alert('Konto założone. Kliknij link w mailu, który przyszedł, a potem zaloguj się tutaj.');
      } catch (e) { alert('Nie udało się: ' + e.message); }
      await reloadProjects(); render(); return;
    }
    case 'logout': if (confirm('Wylogować? Projekty zostaną na tym urządzeniu.')) { signOut(); render(); } return;
    case 'sync-now': { const q = cur(); if (q) await db.putProject(q); await syncAll(); await reloadProjects(); render(); return; }
    case 'undo-cut': undoCut(p); return;
    case 'collapse': {
      const s = p.sections.find(x => x.id === el.dataset.id);
      s.collapsed = !s.collapsed; save(); render(); return;
    }
    case 'mark': markSection(p, el.dataset.kind); save(); render(); return;
    case 'unmark': markSection(p, null); save(); render(); return;
    case 'del-section': p.sections = p.sections.filter(s => s.id !== el.dataset.id); state.sel = null; markRenumber(p); save(); render(); return;
    case 'add-track': p.tracks.push({ id: uid(), name: `Ścieżka ${p.tracks.length + 1}`, muted: false, volume: 1, takes: [] }); save(); render(); return;
    case 'mute': { const t = p.tracks.find(x => x.id === el.dataset.id); t.muted = !t.muted; save(); render(); return; }
    case 'record': toggleRecord(el.dataset.id); return;
    case 'del-track': {
      const t = p.tracks.find(x => x.id === el.dataset.id);
      if (t.takes.length && !confirm(`Usunąć „${t.name}” z nagraniami?`)) return;
      t.takes.forEach(k => db.deleteBlob(k.key));
      p.tracks = p.tracks.filter(x => x !== t); save(); render(); return;
    }
    case 'del-take': {
      const t = p.tracks.find(x => x.id === el.dataset.id);
      const k = t.takes.find(x => x.id === el.dataset.take);
      db.deleteBlob(k.key); buffers.delete(k.key);
      t.takes = t.takes.filter(x => x !== k); save(); render(); return;
    }
    case 'mic-refresh': {
      // jednorazowe zapytanie o mikrofon, żeby poznać nazwy urządzeń
      try { const s = await navigator.mediaDevices.getUserMedia({ audio: true }); s.getTracks().forEach(t => t.stop()); } catch (_) {}
      await refreshInputs(); render(); return;
    }
    case 'latency': openLatency(); return;
    case 'follow': state.follow = !state.follow; render(); return;
    case 'eye': {
      const { s, l, v, lineEl } = findVersion(p, el);
      v.visible = !v.visible; save(); rerenderLine(lineEl, s, l); return;
    }
    case 'del-ver': {
      const { s, l, v, lineEl } = findVersion(p, el);
      if (v.text && !confirm('Usunąć tę wersję wersu?')) return;
      l.versions = l.versions.filter(x => x !== v);
      if (!l.versions.length) l.versions.push({ id: uid(), text: '', visible: true });
      save(); rerenderLine(lineEl, s, l); return;
    }
    case 'add-ver': {
      const { s, l, lineEl } = findVersion(p, el);
      const nv = { id: uid(), text: '', visible: true };
      l.versions.push(nv); save();
      const fresh = rerenderLine(lineEl, s, l);
      const ta = fresh.querySelector(`textarea[data-v="${nv.id}"]`); if (ta) ta.focus();
      return;
    }
    case 'mode': p.playMode = el.dataset.m; save(); renderTransport(p); return;
    case 'start': startPlayback(); return;
    case 'stop': engine.stop(); if (state.tab === 'beat') render(); return;
    // test latencji
    case 'lt-close': engine.stop(); modal.hidden = true; render(); return;
    case 'lt-rec': latencyRecord(); return;
    case 'lt-nudge': setOffset(lt.offset + Number(el.dataset.d)); return;
    case 'lt-auto': setOffset(autoLatency(lt.beatEnv, lt.takeEnv)); return;
    case 'lt-play': latencyPlay(); return;
    case 'lt-save': state.latencyMs = lt.offset; localStorage.setItem('latencyMs', String(lt.offset)); engine.stop(); modal.hidden = true; render(); return;
  }
});

document.addEventListener('pointerdown', e => {
  if (e.target.closest('[data-act="tap"]') && cur()) { e.preventDefault(); tapTempo(cur()); }
});

document.addEventListener('input', e => {
  const el = e.target, act = el.dataset.act, p = cur();
  if (!act || !p) return;
  if (act === 'text') { const { v } = findVersion(p, el); v.text = el.value; autoSize(el); save(); }
  else if (act === 'notes') { p.notes = el.value; save(); }
  else if (act === 'track-name') { p.tracks.find(x => x.id === el.dataset.id).name = el.value; save(); }
  else if (act === 'vol') { p.tracks.find(x => x.id === el.dataset.id).volume = Number(el.value); save(); }
  else if (act === 'lt-slider') setOffset(Number(el.value));
});

document.addEventListener('change', e => {
  const el = e.target, act = el.dataset.act, p = cur();
  if (!act) return;
  if (act === 'beat-file' && el.files[0]) importBeat(el.files[0]);
  else if (act === 'bpm-input') { const v = Number(el.value); if (v >= 40 && v <= 240) { p.bpm = v; clampSections(p); save(); } render(); }
  else if (act === 'long-a') { p.longStartBar = Number(el.value); p.cursor = timeOfBar(p, p.longStartBar); save(); drawTimeline(); }
  else if (act === 'loop-a') { p.loopStartBar = Number(el.value); save(); }
  else if (act === 'loop-b') { p.loopEndBar = Number(el.value); save(); }
  else if (act === 'mic') { state.micId = el.value; localStorage.setItem('micId', el.value); }
});

function nudgeDown(p, d) {
  const bd = barDur(p);
  let v = p.firstDownbeat + d;
  if (v >= bd) v -= bd;
  if (v < 0) v += bd;
  p.firstDownbeat = Math.round(v * 1000) / 1000;
  clampSections(p); save(); render();
}

// ---------- edycja bitu: wycinanie taktów ----------
function dropUndo(p) {
  if (p.undo) { db.deleteBlob(p.undo.beatKey); buffers.delete(p.undo.beatKey); p.undo = null; }
}

async function cutBars(p) {
  const a = Math.min(state.sel.a, state.sel.b ?? state.sel.a);
  const b = Math.max(state.sel.a, state.sel.b ?? state.sel.a);
  const k = b - a + 1;
  if (!confirm(`Wyciąć takty ${a}–${b} (${k}) z bitu?\nSekcje i nagrania za nimi przesuną się do przodu. Możesz to cofnąć.`)) return;
  engine.stop();
  state.cutting = true; render();
  try {
    const src = await getBuffer(p.beatKey);
    const sr = src.sampleRate;
    const t0 = Math.max(0, timeOfBar(p, a)), t1 = Math.min(src.duration, timeOfBar(p, b + 1));
    const s0 = Math.round(t0 * sr), s1 = Math.round(t1 * sr);
    const len = src.length - (s1 - s0);
    const out = new AudioBuffer({ numberOfChannels: src.numberOfChannels, length: Math.max(1, len), sampleRate: sr });
    const fade = Math.min(Math.round(sr * 0.006), s0, src.length - s1);
    for (let c = 0; c < src.numberOfChannels; c++) {
      const d = src.getChannelData(c), o = out.getChannelData(c);
      o.set(d.subarray(0, s0), 0);
      o.set(d.subarray(s1), s0);
      // krótkie przenikanie na styku, żeby nie trzaskało
      for (let i = 0; i < fade; i++) {
        const g = i / fade;
        o[s0 - fade + i] = d[s0 - fade + i] * (1 - g) + d[s1 - fade + i] * g;
      }
    }
    const key = 'beat-' + uid();
    await db.putBlob(key, encodeWav(out));
    dropUndo(p);
    p.undo = {
      a, b, beatKey: p.beatKey, beatDuration: p.beatDuration, beatEdited: !!p.beatEdited,
      sections: JSON.parse(JSON.stringify(p.sections)), tracks: JSON.parse(JSON.stringify(p.tracks)),
      longStartBar: p.longStartBar, loopStartBar: p.loopStartBar, loopEndBar: p.loopEndBar,
    };
    buffers.set(key, out);
    p.beatKey = key; p.beatDuration = out.duration; p.beatEdited = true;
    // sekcje: usuń wycięte wersy, przesuń resztę
    const secs = [];
    for (const s of p.sections) {
      const keep = [];
      s.lines.forEach((l, i) => { const bar = s.startBar + i; if (bar < a || bar > b) keep.push(l); });
      if (!keep.length) continue;
      const start = s.startBar < a ? s.startBar : Math.max(a, s.startBar - k);
      secs.push({ ...s, startBar: start, endBar: start + keep.length - 1, lines: keep });
    }
    p.sections = secs; markRenumber(p);
    // nagrania za cięciem przesuwają się razem z bitem
    const dt = t1 - t0;
    p.tracks.forEach(t => t.takes.forEach(tk => { if (tk.startTime >= t1 - 0.05) tk.startTime -= dt; }));
    const shift = x => x > b ? x - k : x >= a ? a : x;
    const n = barCount(p);
    p.longStartBar = Math.min(n, shift(p.longStartBar)); p.cursor = null;
    p.loopStartBar = Math.min(n, shift(p.loopStartBar));
    p.loopEndBar = Math.min(n, Math.max(p.loopStartBar, shift(p.loopEndBar)));
    clampSections(p);
    state.sel = null;
  } catch (e) { alert('Nie udało się wyciąć: ' + e.message); }
  state.cutting = false;
  save(p); render();
}

function undoCut(p) {
  const u = p.undo; if (!u) return;
  engine.stop();
  db.deleteBlob(p.beatKey); buffers.delete(p.beatKey);
  Object.assign(p, {
    beatKey: u.beatKey, beatDuration: u.beatDuration, beatEdited: u.beatEdited, sections: u.sections, tracks: u.tracks,
    longStartBar: u.longStartBar, loopStartBar: u.loopStartBar, loopEndBar: u.loopEndBar, undo: null,
  });
  save(p); render();
}

function markRenumber(p) {
  const cnt = {};
  p.sections.forEach(s => { cnt[s.kind] = (cnt[s.kind] || 0) + 1; s.number = cnt[s.kind]; });
}

function openProject(id, tab) {
  engine.stop();
  state.currentId = id; state.sel = null;
  localStorage.setItem('currentId', id);
  setTab(tab);
}

// ---------- tap tempo ----------
const tap = { times: [], bpm: 0 };
function tapTempo(p) {
  const now = performance.now();
  if (tap.times.length && now - tap.times[tap.times.length - 1] > 2000) tap.times = [];
  tap.times.push(now);
  if (tap.times.length > 12) tap.times.shift();
  if (tap.times.length > 1) {
    const n = tap.times.length - 1;
    tap.bpm = 60000 / ((tap.times[n] - tap.times[0]) / n);
    if (tap.times.length >= 4) { p.bpm = Math.round(tap.bpm * 10) / 10; clampSections(p); save(p); }
  }
  render();
}

// ---------- oś czasu (przebieg bitu + takty) ----------
const tl = { mode: 'scroll', pps: 100, start: 0, peaks: null, peaksKey: null, rate: 200, locked: localStorage.getItem('tlLocked') !== '0', secDrag: null };

async function ensurePeaks(p) {
  if (tl.peaksKey === p.beatKey && tl.peaks) return;
  const b = await getBuffer(p.beatKey);
  if (!b) return;
  const per = Math.max(1, Math.floor(b.sampleRate / tl.rate));
  const n = Math.ceil(b.length / per);
  const peaks = new Float32Array(n);
  const chans = [];
  for (let c = 0; c < b.numberOfChannels; c++) chans.push(b.getChannelData(c));
  for (let i = 0; i < n; i++) {
    let m = 0;
    const e = Math.min(b.length, (i + 1) * per);
    for (const d of chans) for (let k = i * per; k < e; k++) { const v = d[k] < 0 ? -d[k] : d[k]; if (v > m) m = v; }
    peaks[i] = m;
  }
  let max = 0; for (const v of peaks) if (v > max) max = v;
  if (max > 0) for (let i = 0; i < n; i++) peaks[i] /= max;
  tl.peaks = peaks; tl.peaksKey = p.beatKey;
}

function tlCanvas() { return state.tab === 'beat' ? document.getElementById('tl') : null; }

async function initTimeline() {
  const c = tlCanvas();
  if (!c) return;
  const p = cur();
  if (tl.peaksKey !== p.beatKey) { tl.peaks = null; drawTimeline(); await ensurePeaks(p); }
  bindTimeline(c);
  drawTimeline();
}

const cssCache = new Map();
function cssVar(n) {
  let v = cssCache.get(n);
  if (v === undefined) { v = getComputedStyle(document.documentElement).getPropertyValue(n).trim(); cssCache.set(n, v); }
  return v;
}
matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', () => { cssCache.clear(); tl.layerKey = null; drawTimeline(); });

function drawTimeline(follow = false) {
  const c = tlCanvas();
  if (!c) return;
  const p = cur();
  const dpr = window.devicePixelRatio || 1;
  const cw = c.clientWidth, ch = c.clientHeight;
  if (!cw) return;
  if (c.width !== Math.round(cw * dpr)) { c.width = Math.round(cw * dpr); c.height = Math.round(ch * dpr); }
  const g = c.getContext('2d');
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  const viewDur = cw / tl.pps;
  // śledzenie wskaźnika odtwarzania
  if (follow && engine.playing) {
    const pos = engine.position;
    if (pos < tl.start || pos > tl.start + viewDur * 0.85) tl.start = Math.max(0, pos - viewDur * 0.15);
  }
  tl.start = Math.max(0, Math.min(tl.start, Math.max(0, p.beatDuration - viewDur * 0.5)));
  const t0 = tl.start, t1 = t0 + viewDur;
  const X = t => (t - t0) * tl.pps;
  const band = 20, wTop = band, wH = ch - band - 16;

  // statyczna warstwa (przebieg, siatka, sekcje) rysowana tylko gdy coś się zmieni;
  // co klatkę kopiujemy ją i dokładamy sam wskaźnik – żeby nie obciążać telefonu w trakcie grania
  const key = [cw, ch, dpr, t0, tl.pps, tl.mode, p.bpm, p.firstDownbeat, p.beatKey, !!tl.peaks,
    JSON.stringify(state.sel), JSON.stringify(tl.secDrag), p.sections.map(s => s.kind + s.startBar + '-' + s.endBar + s.number).join()].join('|');
  if (!tl.layer) tl.layer = document.createElement('canvas');
  if (tl.layerKey !== key) {
    tl.layer.width = c.width; tl.layer.height = c.height;
    const lg = tl.layer.getContext('2d');
    lg.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawStatic(lg, p, cw, ch, t0, t1, X, band, wTop, wH);
    tl.layerKey = key;
  }
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.clearRect(0, 0, c.width, c.height);
  g.drawImage(tl.layer, 0, 0);
  g.setTransform(dpr, 0, 0, dpr, 0, 0);

  const tt = document.getElementById('tltime');
  if (tt) {
    const t = engine.playing ? engine.position : (p.cursor ?? startPos(p));
    const txt = `${fmtClock(t)} / ${fmtClock(p.beatDuration)}`;
    if (tt.textContent !== txt) tt.textContent = txt;
  }
  // playhead (miejsce startu)
  if (p.cursor != null) {
    const x = X(p.cursor);
    if (x >= -8 && x <= cw + 8) {
      g.fillStyle = cssVar('--accent'); g.fillRect(x - 1, 0, 2, ch);
      g.beginPath(); g.moveTo(x - 7, 0); g.lineTo(x + 7, 0); g.lineTo(x, 10); g.closePath(); g.fill();
    }
  }
  // wskaźnik odtwarzania
  if (engine.playing) {
    const x = X(engine.position);
    g.fillStyle = cssVar('--ok'); g.fillRect(x - 1, 0, 2, ch);
  }
}

function drawStatic(g, p, cw, ch, t0, t1, X, band, wTop, wH) {
  g.clearRect(0, 0, cw, ch);
  g.fillStyle = cssVar('--panel2'); g.fillRect(0, 0, cw, ch);

  // sekcje (pasek u góry)
  for (const s of p.sections) {
    const off = tl.secDrag && tl.secDrag.id === s.id ? tl.secDrag.d : 0;
    if (off) { g.globalAlpha = 0.25; g.fillStyle = cssVar('--' + s.kind); g.fillRect(X(timeOfBar(p, s.startBar)), 0, X(timeOfBar(p, s.endBar + 1)) - X(timeOfBar(p, s.startBar)), band); g.globalAlpha = 1; }
    const a = X(timeOfBar(p, s.startBar + off)), b = X(timeOfBar(p, s.endBar + 1 + off));
    if (b < 0 || a > cw) continue;
    g.fillStyle = cssVar('--' + s.kind);
    g.globalAlpha = 0.9; g.fillRect(a, 0, b - a, band);
    g.globalAlpha = 0.12; g.fillRect(a, band, b - a, ch - band);
    g.globalAlpha = 1;
    g.fillStyle = '#fff'; g.font = '600 11px -apple-system, system-ui, sans-serif';
    g.fillText(secTitle(s), Math.max(a, 0) + 4, 14, Math.max(0, b - Math.max(a, 0) - 8));
  }

  // zaznaczenie
  if (state.sel) {
    const lo = Math.min(state.sel.a, state.sel.b ?? state.sel.a), hi = Math.max(state.sel.a, state.sel.b ?? state.sel.a);
    g.fillStyle = cssVar('--text'); g.globalAlpha = 0.15;
    g.fillRect(X(timeOfBar(p, lo)), band, X(timeOfBar(p, hi + 1)) - X(timeOfBar(p, lo)), ch - band);
    g.globalAlpha = 1;
  }

  // przebieg
  if (tl.peaks) {
    g.fillStyle = cssVar('--muted');
    const mid = wTop + wH / 2;
    for (let x = 0; x < cw; x++) {
      const i0 = Math.floor((t0 + x / tl.pps) * tl.rate), i1 = Math.max(i0 + 1, Math.floor((t0 + (x + 1) / tl.pps) * tl.rate));
      let m = 0;
      for (let i = i0; i < i1 && i < tl.peaks.length; i++) if (tl.peaks[i] > m) m = tl.peaks[i];
      const h = m * wH / 2;
      if (h > 0.3) g.fillRect(x, mid - h, 1, h * 2);
    }
  } else {
    g.fillStyle = cssVar('--muted'); g.font = '13px system-ui'; g.fillText('Ładuję przebieg…', 10, ch / 2);
  }

  // siatka: beaty i takty
  const beat = 60 / p.bpm;
  const firstBeatIdx = Math.ceil((t0 - p.firstDownbeat) / beat);
  for (let k = firstBeatIdx; ; k++) {
    const t = p.firstDownbeat + k * beat;
    if (t > t1) break;
    if (t < 0) continue;
    const x = Math.round(X(t)) + 0.5;
    const isBar = ((k % p.beatsPerBar) + p.beatsPerBar) % p.beatsPerBar === 0;
    if (isBar) {
      const bar = Math.round(k / p.beatsPerBar) + 1;
      if (bar < 1) continue;
      g.strokeStyle = tl.mode === 'grid' ? cssVar('--accent') : cssVar('--text');
      g.globalAlpha = 0.85; g.lineWidth = bar === 1 ? 2.5 : 1.5;
      g.beginPath(); g.moveTo(x, band); g.lineTo(x, ch); g.stroke();
      g.globalAlpha = 1;
      g.fillStyle = cssVar('--text'); g.font = '600 11px -apple-system, system-ui, sans-serif';
      g.fillText(String(bar), x + 3, ch - 4);
    } else if (tl.pps * beat > 12) {
      g.strokeStyle = cssVar('--text'); g.globalAlpha = 0.18; g.lineWidth = 1;
      g.beginPath(); g.moveTo(x, band); g.lineTo(x, ch - 14); g.stroke();
      g.globalAlpha = 1;
    }
  }

}

function bindTimeline(c) {
  if (c._bound) return;
  c._bound = true;
  let down = null;
  const timeAtX = clientX => tl.start + (clientX - c.getBoundingClientRect().left) / tl.pps;
  c.addEventListener('pointerdown', e => {
    const p = cur();
    const t = timeAtX(e.clientX);
    const nearCursor = p.cursor != null && Math.abs((p.cursor - t) * tl.pps) < 14;
    const sec = tl.mode === 'section' ? sectionAt(p, barAt(p, t)) : null;
    down = { x: e.clientX, y: e.clientY, start: tl.start, db: p.firstDownbeat, moved: false, id: e.pointerId,
      dragCursor: tl.mode === 'scroll' && nearCursor, sec };
  });
  c.addEventListener('pointermove', e => {
    if (!down || e.pointerId !== down.id) return;
    const dx = e.clientX - down.x, dy = e.clientY - down.y;
    if (!down.moved) {
      if (Math.abs(dx) < 6) return;
      if (Math.abs(dy) > Math.abs(dx)) { down = null; return; } // pionowy gest = przewijanie strony
      down.moved = true;
      try { c.setPointerCapture(e.pointerId); } catch (_) {}
    }
    const p = cur();
    if (tl.mode === 'grid') {
      const bd = barDur(p);
      let v = down.db + dx / tl.pps;
      v = ((v % bd) + bd) % bd;
      p.firstDownbeat = Math.round(v * 1000) / 1000;
    } else if (down.dragCursor) {
      p.cursor = snapBeat(p, timeAtX(e.clientX));
    } else if (down.sec) {
      const s = down.sec, n = barCount(p);
      let d = Math.round(dx / tl.pps / barDur(p));
      d = Math.max(1 - s.startBar, Math.min(n - s.endBar, d));
      tl.secDrag = { id: s.id, d };
    } else {
      tl.start = Math.max(0, down.start - dx / tl.pps);
    }
    drawTimeline();
  });
  const up = e => {
    if (!down || e.pointerId !== down.id) return;
    const p = cur();
    const d = down; down = null;
    if (d.moved) {
      if (tl.mode === 'grid') { clampSections(p); save(p); render(); }
      else if (d.dragCursor) { save(p); renderTransport(p); if (engine.playing && p.playMode !== 'loop') startPlayback(); }
      else if (d.sec && tl.secDrag) { moveSection(p, d.sec, tl.secDrag.d); tl.secDrag = null; save(p); render(); }
      return;
    }
    if (tl.mode !== 'scroll') return;
    // stuknięcie: ustaw playhead (co bit); w trakcie grania – skocz tam
    const t = timeAtX(e.clientX);
    if (t > p.beatDuration) return;
    p.cursor = snapBeat(p, t);
    save(p); renderTransport(p); drawTimeline();
    if (engine.playing && p.playMode !== 'loop') startPlayback();
  };
  c.addEventListener('pointerup', up);
  c.addEventListener('pointercancel', () => { down = null; if (tl.secDrag) { tl.secDrag = null; drawTimeline(); } });
  // kółko: przewijanie; Ctrl/⌘ + kółko (albo szczypanie na touchpadzie): zoom wokół kursora
  c.addEventListener('wheel', e => {
    e.preventDefault();
    if (e.ctrlKey || e.metaKey) {
      const tAt = timeAtX(e.clientX), x = e.clientX - c.getBoundingClientRect().left;
      tl.pps = Math.max(8, Math.min(600, tl.pps * Math.exp(-e.deltaY * 0.01)));
      tl.start = Math.max(0, tAt - x / tl.pps);
    } else {
      const d = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
      tl.start = Math.max(0, tl.start + d / tl.pps);
    }
    drawTimeline();
  }, { passive: false });
}

function moveSection(p, sec, d) {
  if (!d) return;
  const lo = sec.startBar + d, hi = sec.endBar + d;
  const others = p.sections.filter(s => s.id !== sec.id);
  const hit = others.filter(s => s.endBar >= lo && s.startBar <= hi);
  if (hit.length && !confirm(`Sekcja nachodzi na: ${hit.map(secTitle).join(', ')}. Te takty (i ich tekst) zostaną zastąpione. Przesunąć?`)) return;
  p.sections = others;
  state.sel = { a: lo, b: hi };
  markSection(p, null); // wycina miejsce pod sekcję z innych sekcji
  p.sections.push({ ...sec, startBar: lo, endBar: hi });
  p.sections.sort((x, y) => x.startBar - y.startBar);
  markRenumber(p);
}

window.addEventListener('resize', () => drawTimeline());

const fmtTime = s => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

// ---------- start ----------
async function reloadProjects() {
  state.projects = (await db.allProjects()).sort((a, b) => b.created - a.created);
  if (!cur()) { state.currentId = null; if (state.tab !== 'projects') setTab('projects'); }
}

// zmiany z chmury: przeładuj, ale nie przeszkadzaj w pisaniu ani nagrywaniu
let cloudDirty = false;
cloud.onChange = async () => {
  const typing = document.activeElement && /TEXTAREA|INPUT/.test(document.activeElement.tagName);
  if (engine.recording || typing) { cloudDirty = true; return; }
  cloudDirty = false;
  await reloadProjects(); render();
};
cloud.onStatus = () => {
  const el = document.getElementById('cloudstatus');
  if (el) el.textContent = cloud.status; else if (state.tab === 'projects') render();
};
document.addEventListener('focusout', () => setTimeout(() => { if (cloudDirty) cloud.onChange(); }, 300));
document.addEventListener('visibilitychange', () => { if (!document.hidden) syncAll(); });
setInterval(() => { if (!document.hidden && !engine.recording) syncAll(); }, 20000);

(async function init() {
  state.projects = (await db.allProjects()).sort((a, b) => b.created - a.created);
  if (!cur()) state.currentId = null;
  setTab(cur() ? 'lyrics' : 'projects');
  refreshInputs();
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
  syncAll();
})();
