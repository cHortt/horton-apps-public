import { createEngine, startTransport } from "./audio.mjs";
import { editedName, exportScore, findNote, parseScore, playbackEvents, setPitch } from "./musicxml.mjs";
import { PART_COLORS, renderScore, xForQl } from "./render.mjs";
import { chromaticMove, defaultMix, diatonicMove, samePitch, spellPretty } from "./theory.mjs";

const PART_NAMES = { S: "Soprano", A: "Alto", T: "Tenor", B: "Bass", P: "Piano" };
const CHANNELS = ["S", "A", "T", "B", "P"];

const els = {
  open: document.querySelector("#open"),
  example: document.querySelector("#example"),
  export: document.querySelector("#export"),
  file: document.querySelector("#file"),
  label: document.querySelector("#filelabel"),
  empty: document.querySelector("#empty"),
  scroll: document.querySelector("#scroll"),
  gutter: document.querySelector("#gutter"),
  error: document.querySelector("#error"),
  readout: document.querySelector("#readout"),
  play: document.querySelector("#play"),
  mixerBtn: document.querySelector("#mixer-btn"),
  mixer: document.querySelector("#mixer"),
  changes: document.querySelector("#changes"),
  undo: document.querySelector("#undo"),
  redo: document.querySelector("#redo"),
  up: document.querySelector("#up"),
  down: document.querySelector("#down"),
  sharp: document.querySelector("#sharp"),
  flat: document.querySelector("#flat"),
  tempo: document.querySelector("#tempo"),
  bpm: document.querySelector("#bpm"),
};

const state = {
  score: null,
  filename: "",
  activePart: "S",
  selectedId: null,
  showChanges: false,
  playMeasure: 0,
  bpm: 68,
  gains: defaultMix("S"),
  mutes: { S: false, A: false, T: false, B: false, P: false },
  undo: [],
  redo: [],
  layout: null,
  transport: null,
  engine: null,
};

let tap = null;

function showError(message) {
  els.error.hidden = !message;
  els.error.textContent = message || "";
}

function loadXml(xml, filename) {
  stopPlayback();
  let score;
  try {
    score = parseScore(xml);
  } catch (error) {
    showError(error.message || "Could not read that MusicXML file.");
    return;
  }
  if (!score.parts.some((p) => p.role === "SA") || !score.parts.some((p) => p.role === "TB")) {
    showError("This file needs a Soprano/Alto staff and a Tenor/Bass staff.");
    return;
  }
  showError("");
  state.score = score;
  state.filename = filename;
  state.selectedId = null;
  state.playMeasure = 0;
  state.bpm = Math.round(score.quarterBpm) || 68;
  state.undo = [];
  state.redo = [];
  els.tempo.value = String(Math.max(40, Math.min(160, state.bpm)));
  els.bpm.textContent = els.tempo.value;
  state.bpm = Number(els.tempo.value);
  applyDefaultMix(false);
  els.label.textContent = filename;
  els.empty.hidden = true;
  els.export.disabled = false;
  render();
}

function render() {
  const left = els.scroll.scrollLeft;
  const top = els.scroll.scrollTop;
  state.layout = renderScore(state.score, {
    activePart: state.activePart,
    selectedId: state.selectedId,
    showChanges: state.showChanges,
    playMeasure: state.playMeasure,
  });
  els.gutter.innerHTML = state.layout.gutter;
  els.scroll.innerHTML = state.layout.music;
  els.scroll.scrollLeft = left;
  els.scroll.scrollTop = top;
  refreshControls();
}

function refreshControls() {
  const selected = state.selectedId ? findNote(state.score, state.selectedId) : null;
  for (const button of document.querySelectorAll("[data-part]")) {
    const on = button.dataset.part === state.activePart;
    button.setAttribute("aria-pressed", on ? "true" : "false");
    button.style.background = on ? PART_COLORS[button.dataset.part] : "#fff";
    button.style.color = on ? "#fff" : PART_COLORS[button.dataset.part];
    button.style.borderColor = PART_COLORS[button.dataset.part];
  }
  const canEdit = !!selected?.note.pitch && !state.transport;
  for (const id of ["up", "down", "sharp", "flat"]) els[id].disabled = !canEdit;
  els.undo.disabled = !state.undo.length || !!state.transport;
  els.redo.disabled = !state.redo.length || !!state.transport;
  els.changes.setAttribute("aria-pressed", state.showChanges ? "true" : "false");
  els.play.disabled = !state.score;
  els.play.textContent = state.transport ? "Stop" : "Play";
  els.mixerBtn.setAttribute("aria-expanded", els.mixer.hidden ? "false" : "true");
  if (!selected?.note.pitch) {
    const bar = state.score ? state.score.parts[0].measures[state.playMeasure]?.number : "";
    els.readout.textContent = state.score ? `${PART_NAMES[state.activePart]} · play from bar ${bar}` : "Open a Piano Vocal file";
    return;
  }
  const now = spellPretty(selected.note.pitch);
  const was = spellPretty(selected.note.originalPitch);
  const changed = state.showChanges && !samePitch(selected.note.pitch, selected.note.originalPitch);
  const bar = selected.measure.number;
  els.readout.textContent = changed
    ? `${PART_NAMES[state.activePart]} bar ${bar} · ${was} → ${now}`
    : `${PART_NAMES[state.activePart]} bar ${bar} · ${now}`;
}

function applyDefaultMix(refreshSliders = true) {
  state.gains = defaultMix(state.activePart);
  state.mutes = { S: false, A: false, T: false, B: false, P: false };
  if (!refreshSliders) return;
  for (const channel of CHANNELS) {
    const slider = document.querySelector(`input[data-gain="${channel}"]`);
    const mute = document.querySelector(`button[data-mute="${channel}"]`);
    slider.value = String(Math.round(state.gains[channel] * 100));
    mute.setAttribute("aria-pressed", "false");
    mute.classList.remove("on");
  }
}

function selectPart(part) {
  if (state.activePart === part) return;
  state.activePart = part;
  const selected = state.selectedId ? findNote(state.score, state.selectedId) : null;
  if (selected && !selected.note.parts.includes(part)) state.selectedId = null;
  applyDefaultMix(true);
  if (state.score) render();
  else refreshControls();
}

function musicPoint(event) {
  const svg = document.querySelector("#music");
  const rect = svg.getBoundingClientRect();
  const view = svg.viewBox.baseVal;
  return {
    x: ((event.clientX - rect.left) / rect.width) * view.width,
    y: ((event.clientY - rect.top) / rect.height) * view.height,
  };
}

function onTap(event) {
  if (!state.layout) return;
  const point = musicPoint(event);
  let best = null;
  let bestD = 26 * 26;
  for (const note of state.layout.notes) {
    if (note.isRest || !note.parts.includes(state.activePart)) continue;
    const d = (note.x - point.x) ** 2 + (note.y - point.y) ** 2;
    if (d < bestD) {
      best = note;
      bestD = d;
    }
  }
  if (best) {
    state.selectedId = best.id;
    state.playMeasure = best.measureIndex;
    render();
    reveal(best.x, best.y);
    return;
  }
  const measure = state.layout.measures.find((m) => point.x >= m.x && point.x < m.x + m.w);
  if (measure) {
    state.playMeasure = measure.index;
    render();
  }
}

function reveal(x, y) {
  const box = els.scroll;
  if (x < box.scrollLeft + 48 || x > box.scrollLeft + box.clientWidth - 48) {
    box.scrollLeft = Math.max(0, x - box.clientWidth * 0.35);
  }
  if (y < box.scrollTop + 20 || y > box.scrollTop + box.clientHeight - 20) {
    box.scrollTop = Math.max(0, y - box.clientHeight * 0.35);
  }
}

function edit(kind) {
  const found = state.selectedId ? findNote(state.score, state.selectedId) : null;
  if (!found?.note.pitch) return;
  const current = { ...found.note.pitch };
  const next =
    kind === "up" || kind === "down"
      ? diatonicMove(current, found.measure.fifths, kind === "up" ? 1 : -1)
      : chromaticMove(current, kind === "sharp" ? 1 : -1);
  if (samePitch(current, next)) return;
  state.undo.push({ id: found.note.id, from: current, to: next });
  state.redo = [];
  setPitch(state.score, found.note.id, next);
  render();
  const placed = state.layout.notes.find((n) => n.id === found.note.id);
  if (placed) reveal(placed.x, placed.y);
}

function restore(entry, key) {
  setPitch(state.score, entry.id, entry[key]);
  state.selectedId = entry.id;
  render();
}

function togglePlay() {
  if (state.transport) {
    stopPlayback();
    return;
  }
  if (!state.score) return;
  if (!state.engine) state.engine = createEngine();
  state.engine.resume().then(() => {
    const from = state.layout.measures[state.playMeasure]?.startQl ?? 0;
    const events = playbackEvents(state.score);
    state.transport = startTransport({
      engine: state.engine,
      events,
      fromQl: from,
      endQl: state.layout.endQl,
      quarterBpm: state.bpm,
      getMix: () => ({ gains: state.gains, mutes: state.mutes }),
      onFrame: (ql) => moveCursor(ql),
      onEnd: () => {
        state.transport = null;
        moveCursor(null);
        refreshControls();
      },
    });
    refreshControls();
  });
}

function stopPlayback() {
  if (!state.transport) return;
  const transport = state.transport;
  state.transport = null;
  transport.stop();
  moveCursor(null);
  refreshControls();
}

function moveCursor(ql) {
  const cursor = document.querySelector("#cursor");
  if (!cursor || !state.layout) return;
  if (ql == null) {
    cursor.setAttribute("visibility", "hidden");
    return;
  }
  const x = xForQl(state.layout, Math.min(ql, state.layout.endQl));
  cursor.setAttribute("x1", String(x));
  cursor.setAttribute("x2", String(x));
  cursor.setAttribute("visibility", "visible");
  const box = els.scroll;
  if (x > box.scrollLeft + box.clientWidth - 24 || x < box.scrollLeft + 8) {
    box.scrollLeft = Math.max(0, x - 36);
  }
}

function download() {
  const xml = exportScore(state.score);
  const blob = new Blob([xml], { type: "application/vnd.recordare.musicxml+xml" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = editedName(state.filename);
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

els.open.addEventListener("click", () => els.file.click());
els.file.addEventListener("change", () => {
  const file = els.file.files?.[0];
  els.file.value = "";
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => loadXml(String(reader.result || ""), file.name);
  reader.onerror = () => showError("Could not read that file.");
  reader.readAsText(file);
});
els.example.addEventListener("click", async () => {
  try {
    const response = await fetch("fixtures/satb-sample.musicxml");
    if (!response.ok) throw new Error("Example file is missing.");
    loadXml(await response.text(), "satb-sample.musicxml");
  } catch (error) {
    showError(error.message || "Could not load the example.");
  }
});
els.export.addEventListener("click", download);
els.play.addEventListener("click", togglePlay);
els.up.addEventListener("click", () => edit("up"));
els.down.addEventListener("click", () => edit("down"));
els.sharp.addEventListener("click", () => edit("sharp"));
els.flat.addEventListener("click", () => edit("flat"));
els.undo.addEventListener("click", () => {
  const entry = state.undo.pop();
  if (!entry) return;
  state.redo.push(entry);
  restore(entry, "from");
});
els.redo.addEventListener("click", () => {
  const entry = state.redo.pop();
  if (!entry) return;
  state.undo.push(entry);
  restore(entry, "to");
});
els.changes.addEventListener("click", () => {
  state.showChanges = !state.showChanges;
  if (state.score) render();
  else refreshControls();
});
els.mixerBtn.addEventListener("click", () => {
  els.mixer.hidden = !els.mixer.hidden;
  refreshControls();
});
els.tempo.addEventListener("input", () => {
  state.bpm = Number(els.tempo.value);
  els.bpm.textContent = els.tempo.value;
});
for (const button of document.querySelectorAll("[data-part]")) {
  button.addEventListener("click", () => selectPart(button.dataset.part));
}
for (const slider of document.querySelectorAll("[data-gain]")) {
  slider.addEventListener("input", () => {
    state.gains[slider.dataset.gain] = Number(slider.value) / 100;
  });
}
for (const button of document.querySelectorAll("[data-mute]")) {
  button.addEventListener("click", () => {
    const channel = button.dataset.mute;
    state.mutes[channel] = !state.mutes[channel];
    button.setAttribute("aria-pressed", state.mutes[channel] ? "true" : "false");
    button.classList.toggle("on", state.mutes[channel]);
  });
}

els.scroll.addEventListener("pointerdown", (event) => {
  if (event.pointerType === "mouse" && event.button !== 0) return;
  tap = { x: event.clientX, y: event.clientY };
});
els.scroll.addEventListener("pointerup", (event) => {
  if (!tap) return;
  const dx = event.clientX - tap.x;
  const dy = event.clientY - tap.y;
  tap = null;
  if (dx * dx + dy * dy > 64) return;
  onTap(event);
});
els.scroll.addEventListener("pointercancel", () => {
  tap = null;
});

document.addEventListener("keydown", (event) => {
  if (!state.score || event.target.matches("input, textarea")) return;
  if (event.key === "ArrowUp") {
    event.preventDefault();
    edit("up");
  } else if (event.key === "ArrowDown") {
    event.preventDefault();
    edit("down");
  } else if (event.key === "#" || event.key === "+") edit("sharp");
  else if (event.key === "b" || event.key === "-") edit("flat");
  else if (event.key === " " && event.target === document.body) {
    event.preventDefault();
    togglePlay();
  } else if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "z") {
    event.preventDefault();
    if (event.shiftKey) els.redo.click();
    else els.undo.click();
  }
});

if ("serviceWorker" in navigator) {
  // "./" resolves to this folder (/vocal/ on Pages, including the project prefix).
  // The worker script also lives here, so the browser will not allow a wider scope.
  navigator.serviceWorker.register("sw.js", { scope: "./" }).catch(() => {});
}
if (document.fonts?.ready) {
  document.fonts.ready.then(() => {
    if (state.score) render();
  });
}

applyDefaultMix(true);
refreshControls();
