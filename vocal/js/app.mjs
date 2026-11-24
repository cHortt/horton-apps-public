import { createEngine, startTransport } from "./audio.mjs";
import {
  addParts,
  chordMates,
  removePart,
  restoreScore,
  setMelodyNotes,
  setStackCover,
  setUnisonNotes,
  snapshotScore,
  vocalPart,
} from "./edit.mjs";
import { mixState } from "./mix.mjs";
import { exportMscz, openMscz } from "./mscz.mjs";
import { MXL_ERROR, NO_STAFF_ERROR, audioQlFromWritten, editedName, exportScore, findNote, iterNotes, onsetKey, parseScore, rejectOpenedFile, setPitch, writtenQlFromAudio } from "./musicxml.mjs";
import { preparePlayback } from "./playback.mjs";
import { PART_COLORS, renderScore, xForQl } from "./render.mjs";
import { chromaticMove, diatonicMove, samePitch, spellPretty } from "./theory.mjs";
import { isZip, readZip } from "./zip.mjs";

const PART_NAMES = { S: "Soprano", A: "Alto", T: "Tenor", B: "Bass", P: "Piano" };
const SINGLE_NAMES = { S: "Melody", A: "High", T: "Low", B: "Bass", P: "Piano" };
const SINGLE_SHORT = { S: "Mel", A: "High", T: "Low", B: "Bass" };

const els = {
  example: document.querySelector("#example"),
  export: document.querySelector("#export"),
  file: document.querySelector("#file"),
  label: document.querySelector("#filelabel"),
  empty: document.querySelector("#empty"),
  scroll: document.querySelector("#scroll"),
  gutter: document.querySelector("#gutter"),
  error: document.querySelector("#error"),
  chooser: document.querySelector("#chooser"),
  chooserList: document.querySelector("#chooser-list"),
  readout: document.querySelector("#readout"),
  play: document.querySelector("#play"),
  mix: document.querySelector("#mix"),
  piano: document.querySelector("#piano-file"),
  changes: document.querySelector("#changes"),
  undo: document.querySelector("#undo"),
  redo: document.querySelector("#redo"),
  up: document.querySelector("#up"),
  down: document.querySelector("#down"),
  sharp: document.querySelector("#sharp"),
  flat: document.querySelector("#flat"),
  tempo: document.querySelector("#tempo"),
  bpm: document.querySelector("#bpm"),
  hint: document.querySelector("#hint"),
  ambiguous: document.querySelector("#ambiguous"),
  scopeChord: document.querySelector("#scope-chord"),
  scopeBar: document.querySelector("#scope-bar"),
  addHigh: document.querySelector("#add-high"),
  addLow: document.querySelector("#add-low"),
  removePart: document.querySelector("#remove-part"),
  makeMelody: document.querySelector("#make-melody"),
  unison: document.querySelector("#unison"),
};

const state = {
  score: null,
  filename: "",
  activePart: "S",
  selectedId: null,
  showChanges: false,
  playMeasure: 0,
  bpm: 68,
  mixId: "all",
  gains: mixState("all").gains,
  mutes: mixState("all").mutes,
  pianoPart: null,
  pianoName: "",
  arming: false,
  undo: [],
  redo: [],
  scope: "chord",
  barAnchor: null,
  barStart: 0,
  barEnd: 0,
  layout: null,
  transport: null,
  engine: null,
};

let tap = null;

function showError(message) {
  els.error.hidden = !message;
  els.error.textContent = message || "";
}

function acceptScore(score, filename) {
  const hasUpper = score.parts.some((p) => p.role === "SA");
  const hasLower = score.parts.some((p) => p.role === "TB");
  if (!hasUpper && !hasLower) {
    hideChooser();
    showError(NO_STAFF_ERROR);
    return;
  }
  hideChooser();
  showError("");
  state.score = score;
  state.filename = filename;
  state.selectedId = null;
  state.playMeasure = 0;
  state.bpm = Math.round(score.quarterBpm) || 68;
  state.undo = [];
  state.redo = [];
  state.scope = "chord";
  state.barAnchor = null;
  state.barStart = 0;
  state.barEnd = 0;
  state.pianoPart = null;
  state.pianoName = "";
  state.mixId = "all";
  if (els.mix) els.mix.value = "all";
  applyMix(false);
  els.tempo.value = String(Math.max(40, Math.min(160, state.bpm)));
  els.bpm.textContent = els.tempo.value;
  state.bpm = Number(els.tempo.value);
  els.label.textContent = fileLabelText();
  els.empty.hidden = true;
  els.export.disabled = false;
  render();
}

function hideChooser() {
  els.chooser.hidden = true;
  els.chooserList.replaceChildren();
}

function showStaffChoice(choices, bytes, filename) {
  showError("");
  stopPlayback();
  state.score = null;
  state.layout = null;
  state.selectedId = null;
  state.undo = [];
  state.redo = [];
  state.filename = filename;
  els.label.textContent = filename;
  if (els.empty) els.empty.hidden = true;
  els.export.disabled = true;
  els.gutter.replaceChildren();
  els.scroll.replaceChildren();
  els.chooser.hidden = false;
  els.chooserList.replaceChildren();
  for (const choice of choices) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = choice.label;
    button.addEventListener("click", () => loadMscz(bytes, filename, choice.index));
    els.chooserList.appendChild(button);
  }
  refreshControls();
  els.readout.textContent = "Choose the staff to edit";
}

function loadXml(xml, filename) {
  stopPlayback();
  hideChooser();
  const rejected = rejectOpenedFile(filename, xml);
  if (rejected) {
    showError(rejected);
    return;
  }
  let score;
  try {
    score = parseScore(xml);
  } catch (error) {
    showError(error.message || "Could not read that MusicXML file.");
    return;
  }
  acceptScore(score, filename);
}

function loadMscz(bytes, filename, vocalStaffIndex) {
  stopPlayback();
  let opened;
  try {
    const options = Number.isInteger(vocalStaffIndex) ? { vocalStaffIndex } : undefined;
    opened = openMscz(bytes, options);
  } catch (error) {
    hideChooser();
    showError(error.message || "Could not read that MuseScore file.");
    return;
  }
  if (opened.needsStaffChoice) {
    showStaffChoice(opened.choices, bytes, filename);
    return;
  }
  acceptScore(opened, filename);
}

function render() {
  const left = els.scroll.scrollLeft;
  const top = els.scroll.scrollTop;
  state.layout = renderScore(state.score, {
    activePart: state.activePart,
    selectedId: state.selectedId,
    showChanges: state.showChanges,
    playMeasure: state.playMeasure,
    scope: state.scope,
    selectionStart: state.barStart,
    selectionEnd: state.barEnd,
  });
  els.gutter.innerHTML = state.layout.gutter;
  els.scroll.innerHTML = state.layout.music;
  els.scroll.scrollLeft = left;
  els.scroll.scrollTop = top;
  refreshControls();
}

function nameMap() {
  const single = state.score && !state.score.parts.some((part) => part.role === "TB");
  return single ? SINGLE_NAMES : PART_NAMES;
}

function selectionChords() {
  const part = vocalPart(state.score);
  if (!part) return [];
  if (state.scope === "bars") {
    const start = Math.min(state.barStart, state.barEnd);
    const end = Math.max(state.barStart, state.barEnd);
    const chords = [];
    for (let index = start; index <= end; index++) {
      const measure = part.measures[index];
      if (!measure) continue;
      const seen = new Set();
      for (const note of measure.notes) {
        if (!note.pitch || note.grace) continue;
        const key = `${note.voice}|${onsetKey(note)}`;
        if (seen.has(key)) continue;
        seen.add(key);
        chords.push(chordMates(measure, note));
      }
    }
    return chords;
  }
  const found = state.selectedId ? findNote(state.score, state.selectedId) : null;
  if (!found?.note.pitch) return [];
  return [chordMates(found.measure, found.note)];
}

function fileLabelText() {
  if (!state.filename && state.pianoName) return state.pianoName;
  if (!state.filename) return "No file loaded";
  if (state.pianoName) return `${state.filename} + ${state.pianoName}`;
  return state.filename;
}

function currentMix() {
  return { gains: state.gains, mutes: state.mutes };
}

function applyMix(pushEngine = true) {
  const mix = mixState(state.mixId);
  state.gains = mix.gains;
  state.mutes = mix.mutes;
  if (pushEngine && state.engine) state.engine.setMix(mix);
}

function refreshControls() {
  const selected = state.selectedId ? findNote(state.score, state.selectedId) : null;
  const names = nameMap();
  const single = names === SINGLE_NAMES;
  const hideBass = single && state.score && !iterNotes(state.score).some((note) => note.parts.includes("B"));
  for (const button of document.querySelectorAll("[data-part]")) {
    const on = button.dataset.part === state.activePart;
    button.hidden = button.dataset.part === "B" && hideBass;
    button.textContent = single ? SINGLE_SHORT[button.dataset.part] : button.dataset.part;
    button.setAttribute("aria-label", names[button.dataset.part]);
    button.setAttribute("aria-pressed", on ? "true" : "false");
    button.style.background = on ? PART_COLORS[button.dataset.part] : "#fff";
    button.style.color = on ? "#fff" : PART_COLORS[button.dataset.part];
    button.style.borderColor = PART_COLORS[button.dataset.part];
  }
  const size = vocalPart(state.score)?.convention === "size";
  const chords = selectionChords();
  const busy = !!state.transport;
  els.scopeChord.setAttribute("aria-pressed", state.scope === "chord" ? "true" : "false");
  els.scopeBar.setAttribute("aria-pressed", state.scope === "bars" ? "true" : "false");
  els.addHigh.disabled = !size || !chords.length || busy;
  els.addLow.disabled = !size || !chords.length || busy;
  els.removePart.disabled = !size || !chords.length || state.activePart === "S" || busy;
  els.removePart.textContent = state.activePart === "S" || state.activePart === "P" ? "Remove" : `Remove ${names[state.activePart]}`;
  els.makeMelody.disabled = !size || !chords.length || busy || state.activePart === "S" || state.activePart === "B" && hideBass;
  els.unison.disabled = !size || !chords.length || busy;
  const ambiguous = chords.filter((chord) => chord.some((note) => note.ambiguous));
  els.ambiguous.hidden = ambiguous.length === 0;
  if (ambiguous.length) {
    const lower = ambiguous.flatMap((chord) => chord).find((note) => note.stackLower);
    const cover = (lower?.partCover || ["A"]).join("");
    for (const button of document.querySelectorAll("[data-cover]")) {
      button.setAttribute("aria-pressed", button.dataset.cover === cover ? "true" : "false");
    }
    const prompt = document.querySelector("#ambiguous-prompt");
    prompt.textContent =
      ambiguous.length > 1
        ? `${ambiguous.length} two-note chords. The lower note covers:`
        : "Two notes in this chord. The lower note covers:";
  }
  const hasAmbiguous = state.score && iterNotes(state.score).some((note) => note.ambiguous);
  if (!state.score) els.hint.hidden = true;
  else if (size) {
    els.hint.hidden = false;
    els.hint.textContent =
      "Tap a note. Chord edits that chord. Bar edits one measure, and another bar number extends it. The big note is Melody. Small notes are High and Low.";
  } else if (hasAmbiguous) {
    els.hint.hidden = false;
    els.hint.textContent = "A ? marks a two-note chord. Choose whether the lower note is High, Low, or both.";
  } else els.hint.hidden = true;
  const canEdit = !!selected?.note.pitch && !state.transport;
  for (const id of ["up", "down", "sharp", "flat"]) els[id].disabled = !canEdit;
  els.undo.disabled = !state.undo.length || !!state.transport;
  els.redo.disabled = !state.redo.length || !!state.transport;
  els.changes.setAttribute("aria-pressed", state.showChanges ? "true" : "false");
  els.play.disabled = !state.score || state.arming;
  els.play.textContent = state.transport ? "Stop" : state.arming ? "Loading" : "Play";
  if (!selected?.note.pitch) {
    const bar = state.score ? state.score.parts[0].measures[state.playMeasure]?.number : "";
    const where = state.scope === "bars" && state.barStart !== state.barEnd ? `bars ${Math.min(state.barStart, state.barEnd) + 1}–${Math.max(state.barStart, state.barEnd) + 1}` : `play from bar ${bar}`;
    els.readout.textContent = state.score ? `${names[state.activePart]} · ${where}` : "Open a Piano Vocal file";
    return;
  }
  const now = spellPretty(selected.note.pitch);
  const was = spellPretty(selected.note.originalPitch);
  const changed = state.showChanges && !samePitch(selected.note.pitch, selected.note.originalPitch);
  const bar = selected.measure.number;
  const unison = selected.note.unison ? " · unison" : "";
  const unsure = selected.note.ambiguous && !selected.note.partCover ? " · two-note chord" : "";
  const who = names[state.activePart];
  els.readout.textContent = changed
    ? `${who} bar ${bar} · ${was} → ${now}${unison}`
    : `${who} bar ${bar} · ${now}${unison}${unsure}`;
}

function selectPart(part) {
  if (state.activePart === part) return;
  state.activePart = part;
  const selected = state.selectedId ? findNote(state.score, state.selectedId) : null;
  if (selected) {
    const mates = chordMates(selected.measure, selected.note);
    const next = mates.find((note) => note.parts.includes(part));
    state.selectedId = next ? next.id : selected.note.parts.includes(part) ? selected.note.id : null;
  }
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

function selectBar(index) {
  if (state.scope !== "bars" || state.barAnchor == null) {
    state.scope = "bars";
    state.barAnchor = index;
    state.barStart = index;
    state.barEnd = index;
  } else {
    state.barStart = Math.min(state.barAnchor, index);
    state.barEnd = Math.max(state.barAnchor, index);
  }
  state.playMeasure = index;
  render();
}

function onTap(event) {
  if (!state.layout) return;
  const point = musicPoint(event);
  if (point.y < 30) {
    const measure = state.layout.measures.find((item) => point.x >= item.x && point.x < item.x + item.w);
    if (measure) {
      selectBar(measure.index);
      return;
    }
  }
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
    state.scope = "chord";
    state.barAnchor = null;
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
  if (entry.kind === "struct") {
    restoreScore(state.score, key === "from" ? entry.before : entry.after);
    if (state.selectedId && !findNote(state.score, state.selectedId)) state.selectedId = null;
    render();
    return;
  }
  setPitch(state.score, entry.id, entry[key]);
  state.selectedId = entry.id;
  render();
}

function withStructure(fn) {
  if (!state.score || state.transport) return;
  const before = snapshotScore(state.score);
  fn();
  state.undo.push({ kind: "struct", before, after: snapshotScore(state.score) });
  state.redo = [];
  if (state.selectedId && !findNote(state.score, state.selectedId)) state.selectedId = null;
  render();
}

function togglePlay() {
  if (state.transport) {
    stopPlayback();
    return;
  }
  if (!state.score || state.arming) return;
  if (!state.engine) state.engine = createEngine();
  const mix = mixState(state.mixId);
  state.gains = mix.gains;
  state.mutes = mix.mutes;
  state.arming = true;
  refreshControls();
  const unlocked = state.engine.resume();
  unlocked
    .then(() => state.engine.loadMix(mix))
    .then(() => {
      state.arming = false;
      if (!state.score) {
        refreshControls();
        return;
      }
      const prepared = preparePlayback(state.score, state.pianoPart);
      const written = state.layout?.measures[state.playMeasure]?.startQl ?? 0;
      state.engine.setMix(mix);
      state.transport = startTransport({
        engine: state.engine,
        getEvents: () => preparePlayback(state.score, state.pianoPart).events,
        fromQl: audioQlFromWritten(prepared.visits, written),
        endQl: prepared.endQl,
        quarterBpm: state.bpm,
        getMix: currentMix,
        onFrame: (ql) => moveCursor(writtenQlFromAudio(prepared.visits, ql)),
        onEnd: () => {
          state.transport = null;
          moveCursor(null);
          refreshControls();
        },
      });
      refreshControls();
    })
    .catch((error) => {
      state.arming = false;
      showError(error?.message || "Could not load the instrument sounds.");
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
  const mscz = state.score?.format === "mscz";
  const payload = mscz ? exportMscz(state.score) : exportScore(state.score);
  const blob = new Blob([payload], {
    type: mscz ? "application/octet-stream" : "application/vnd.recordare.musicxml+xml",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = editedName(state.filename);
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

els.file.addEventListener("change", () => {
  const file = els.file.files?.[0];
  els.file.value = "";
  if (!file) return;
  const named = rejectOpenedFile(file.name);
  if (named) {
    hideChooser();
    showError(named);
    return;
  }
  const reader = new FileReader();
  reader.onload = () => {
    const bytes = new Uint8Array(reader.result || new ArrayBuffer(0));
    if (/\.mscz$/i.test(file.name) || (isZip(bytes) && !/\.mxl$/i.test(file.name) && zipHasMscx(bytes))) {
      loadMscz(bytes, file.name);
      return;
    }
    if (isZip(bytes)) {
      hideChooser();
      showError(MXL_ERROR);
      return;
    }
    loadXml(new TextDecoder("utf-8").decode(bytes), file.name);
  };
  reader.onerror = () => {
    hideChooser();
    showError("Could not read that file.");
  };
  reader.readAsArrayBuffer(file);
});

function loadPianoBytes(bytes, filename) {
  let score;
  try {
    if (/\.mscz$/i.test(filename) || (isZip(bytes) && zipHasMscx(bytes))) {
      score = openMscz(bytes);
    } else {
      const xml = new TextDecoder("utf-8").decode(bytes);
      const rejected = rejectOpenedFile(filename, xml);
      if (rejected) {
        showError(rejected);
        return;
      }
      score = parseScore(xml);
    }
  } catch (error) {
    showError(error.message || "Could not read that piano file.");
    return;
  }
  if (!score || score.needsStaffChoice) {
    showError("That file has no piano part.");
    return;
  }
  const piano = score.parts.find((part) => part.role === "piano");
  if (!piano) {
    showError("That file has no piano part.");
    return;
  }
  state.pianoPart = piano;
  state.pianoName = filename;
  showError("");
  els.label.textContent = fileLabelText();
}

function zipHasMscx(bytes) {
  try {
    return readZip(bytes).some((entry) => /\.mscx$/i.test(entry.name));
  } catch {
    return false;
  }
}
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
els.scopeChord.addEventListener("click", () => {
  state.scope = "chord";
  state.barAnchor = null;
  if (state.score) render();
  else refreshControls();
});
els.scopeBar.addEventListener("click", () => {
  const found = state.selectedId ? findNote(state.score, state.selectedId) : null;
  const index = found?.measure.index ?? state.playMeasure;
  state.scope = "bars";
  state.barAnchor = index;
  state.barStart = index;
  state.barEnd = index;
  if (state.score) render();
  else refreshControls();
});
els.addHigh.addEventListener("click", () => withStructure(() => addParts(state.score, selectionChords(), ["A"])));
els.addLow.addEventListener("click", () => withStructure(() => addParts(state.score, selectionChords(), ["T"])));
els.removePart.addEventListener("click", () => withStructure(() => removePart(state.score, selectionChords(), state.activePart)));
els.makeMelody.addEventListener("click", () => withStructure(() => setMelodyNotes(state.score, selectionChords(), state.activePart)));
els.unison.addEventListener("click", () => withStructure(() => setUnisonNotes(state.score, selectionChords(), state.activePart)));
for (const button of document.querySelectorAll("[data-cover]")) {
  button.addEventListener("click", () => {
    const cover = button.dataset.cover === "AT" ? ["A", "T"] : [button.dataset.cover];
    withStructure(() => setStackCover(selectionChords(), cover));
  });
}
els.changes.addEventListener("click", () => {
  state.showChanges = !state.showChanges;
  if (state.score) render();
  else refreshControls();
});
els.mix.addEventListener("change", () => {
  state.mixId = els.mix.value;
  applyMix(true);
  if (!state.engine) return;
  const mix = mixState(state.mixId);
  state.engine.loadMix(mix).then(() => state.engine?.setMix(mixState(state.mixId))).catch((error) => {
    showError(error?.message || "Could not load the instrument sounds.");
  });
});
els.piano.addEventListener("change", () => {
  const file = els.piano.files?.[0];
  els.piano.value = "";
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => loadPianoBytes(new Uint8Array(reader.result || new ArrayBuffer(0)), file.name);
  reader.onerror = () => showError("Could not read that piano file.");
  reader.readAsArrayBuffer(file);
});
els.tempo.addEventListener("input", () => {
  state.bpm = Number(els.tempo.value);
  els.bpm.textContent = els.tempo.value;
});
for (const button of document.querySelectorAll("[data-part]")) {
  button.addEventListener("click", () => selectPart(button.dataset.part));
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
  if (!state.score || event.target.matches("input, textarea, select")) return;
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

applyMix(false);
refreshControls();
