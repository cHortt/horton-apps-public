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
import { channelLabel, channelsForScore, createMix, dbToSlider, formatLevel, sliderToDb, SLIDER_MAX } from "./mix.mjs";
import { exportMscz, openMscz } from "./mscz.mjs";
import { MXL_ERROR, NO_STAFF_ERROR, PART_NAMES, audioQlFromWritten, editedName, exportScore, findNote, iterNotes, onsetKey, parseScore, rejectOpenedFile, setPitch, writtenQlFromAudio } from "./musicxml.mjs";
import { preparePlayback } from "./playback.mjs";
import { hitTest, locateQl, renderScore } from "./render.mjs";
import { chromaticMove, diatonicMove, samePitch, spellPretty } from "./theory.mjs";
import { isZip, readZip } from "./zip.mjs";

const STAFF_PAD = 8;
const HELP = "Mix holds tempo and the part volumes. File holds Open, Example and Export.";

const els = {
  example: document.querySelector("#example"),
  export: document.querySelector("#export"),
  file: document.querySelector("#file"),
  label: document.querySelector("#filelabel"),
  empty: document.querySelector("#empty"),
  staff: document.querySelector("#staff"),
  home: document.querySelector("#home"),
  titleBlock: document.querySelector("#title-block"),
  songTitle: document.querySelector("#song-title"),
  error: document.querySelector("#error"),
  chooser: document.querySelector("#chooser"),
  chooserList: document.querySelector("#chooser-list"),
  readout: document.querySelector("#readout"),
  play: document.querySelector("#play"),
  mixSliders: document.querySelector("#mix-sliders"),
  mixReset: document.querySelector("#mix-reset"),
  playIcon: document.querySelector("#play-icon"),
  playFrom: document.querySelector("#play-from"),
  playFromIcon: document.querySelector("#play-from-icon"),
  playFromLabel: document.querySelector("#play-from-label"),
  barPrev: document.querySelector("#bar-prev"),
  barNext: document.querySelector("#bar-next"),
  thumbEdit: document.querySelector("#thumb-edit"),
  thumbNav: document.querySelector("#thumb-nav"),
  scope: document.querySelector("#scope"),
  more: document.querySelector("#more"),
  drawer: document.querySelector("#drawer"),
  backdrop: document.querySelector("#drawer-backdrop"),
  drawerHeading: document.querySelector("#drawer-heading"),
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
  activePart: "A",
  selectedId: null,
  showChanges: false,
  playMeasure: 0,
  bpm: 68,
  arming: false,
  undo: [],
  redo: [],
  scope: "chord",
  moreSection: "part",
  barAnchor: null,
  barStart: 0,
  barEnd: 0,
  layout: null,
  transport: null,
  engine: null,
};

let tap = null;
const mix = createMix(localStorage);

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
  mix.openFile();
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
  els.staff.replaceChildren();
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

function wrapWidth() {
  const inner = els.staff.clientWidth - STAFF_PAD * 2;
  if (inner >= 80) return inner;
  return Math.max(80, window.innerWidth - STAFF_PAD * 2);
}

function render() {
  const top = els.staff.scrollTop;
  state.layout = renderScore(state.score, {
    activePart: state.activePart,
    selectedId: state.selectedId,
    showChanges: state.showChanges,
    playMeasure: state.playMeasure,
    scope: state.scope,
    selectionStart: state.barStart,
    selectionEnd: state.barEnd,
    wrapWidth: wrapWidth(),
  });
  els.staff.innerHTML = state.layout.systems.map((system) => system.svg).join("");
  els.staff.scrollTop = top;
  refreshControls();
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
  if (!state.filename) return "No file loaded";
  return state.filename;
}

function currentMix() {
  return mix.playback();
}

function renderMixSliders() {
  const names = PART_NAMES;
  const channels = channelsForScore(state.score);
  const levels = mix.levels();
  const host = els.mixSliders;
  const key = channels.join("");
  if (host.dataset.channels !== key) {
    host.dataset.channels = key;
    host.replaceChildren();
    for (const channel of channels) {
      const row = document.createElement("label");
      row.className = "mixrow";
      const name = document.createElement("span");
      name.className = "mixname";
      const input = document.createElement("input");
      input.type = "range";
      input.min = "0";
      input.max = String(SLIDER_MAX);
      input.step = "1";
      input.dataset.channel = channel;
      const readout = document.createElement("span");
      readout.className = "mixdb";
      row.append(name, input, readout);
      host.append(row);
    }
  }
  for (const input of host.querySelectorAll("input[data-channel]")) {
    const channel = input.dataset.channel;
    const label = channelLabel(names, channel);
    const text = formatLevel(levels[channel]);
    input.parentElement.querySelector(".mixname").textContent = label;
    input.setAttribute("aria-label", label);
    input.setAttribute("aria-valuetext", text);
    if (document.activeElement !== input) input.value = String(dbToSlider(levels[channel]));
    input.parentElement.querySelector(".mixdb").textContent = text;
  }
}

function pushMix(playback) {
  if (!state.engine) return;
  state.engine.setMix(playback);
  if (playback.mutes.P || !(playback.gains.P > 0)) return;
  state.engine.loadMix(playback).then(() => state.engine?.setMix(mix.playback())).catch((error) => {
    showError(error?.message || "Could not load the instrument sounds.");
  });
}

function onMixInput(event) {
  const input = event.target;
  const channel = input?.dataset?.channel;
  if (!channel) return;
  const db = sliderToDb(input.value);
  const playback = mix.set(channel, db);
  const text = formatLevel(db);
  input.setAttribute("aria-valuetext", text);
  const readout = input.parentElement?.querySelector(".mixdb");
  if (readout) readout.textContent = text;
  pushMix(playback);
}

function resetMix() {
  pushMix(mix.reset());
  renderMixSliders();
}

function refreshControls() {
  const selected = state.selectedId ? findNote(state.score, state.selectedId) : null;
  const names = PART_NAMES;
  const single = !state.score || !state.score.parts.some((part) => part.role === "TB");
  const hideBass = !state.score || (single && !iterNotes(state.score).some((note) => note.parts.includes("B")));
  for (const button of document.querySelectorAll("[data-part]")) {
    const on = button.dataset.part === state.activePart;
    button.hidden = button.dataset.part === "B" && hideBass;
    const label = names[button.dataset.part];
    const dot = button.querySelector(".dot");
    if (dot) {
      let text = dot.nextSibling;
      if (!text || text.nodeType !== 3) {
        text = document.createTextNode("");
        dot.after(text);
      }
      text.nodeValue = label;
    }
    button.setAttribute("aria-label", label);
    button.setAttribute("aria-pressed", on ? "true" : "false");
  }
  const size = vocalPart(state.score)?.convention === "size";
  const chords = selectionChords();
  const busy = !!state.transport;
  els.scopeChord.setAttribute("aria-pressed", state.scope === "chord" ? "true" : "false");
  els.scopeBar.setAttribute("aria-pressed", state.scope === "bars" ? "true" : "false");
  els.addHigh.disabled = !size || !chords.length || busy;
  els.addLow.disabled = !size || !chords.length || busy;
  els.removePart.disabled = !size || !chords.length || state.activePart === "A" || busy;
  els.removePart.textContent = state.activePart === "A" || state.activePart === "P" ? "Remove" : `Remove ${names[state.activePart]}`;
  els.makeMelody.disabled = !size || !chords.length || busy || state.activePart === "A" || state.activePart === "B" && hideBass;
  els.unison.disabled = !size || !chords.length || busy;
  const ambiguous = chords.filter((chord) => chord.some((note) => note.ambiguous));
  els.ambiguous.hidden = ambiguous.length === 0;
  if (ambiguous.length) {
    const lower = ambiguous.flatMap((chord) => chord).find((note) => note.stackLower);
    const cover = (lower?.partCover || ["S"]).join("");
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
  els.hint.hidden = false;
  els.hint.textContent = !size && hasAmbiguous
    ? "A ? marks a two-note chord. Choose whether the lower note is Soprano, Tenor, or both."
    : HELP;
  const canEdit = !!selected?.note.pitch && !state.transport;
  for (const id of ["up", "down", "sharp", "flat"]) els[id].disabled = !canEdit;
  els.undo.disabled = !state.undo.length || !!state.transport;
  els.redo.disabled = !state.redo.length || !!state.transport;
  els.changes.setAttribute("aria-pressed", state.showChanges ? "true" : "false");
  const playing = !!state.transport;
  const mark = state.arming ? "…" : playing ? "■" : "▶";
  const playName = state.arming ? "Loading" : playing ? "Stop" : "Play";
  els.playIcon.textContent = mark;
  els.playFromIcon.textContent = mark;
  els.play.disabled = !state.score || state.arming;
  els.playFrom.disabled = !state.score || state.arming;
  els.play.setAttribute("aria-label", playName);
  els.playFrom.setAttribute("aria-label", playName);
  els.barPrev.disabled = !state.score || playing || state.arming;
  els.barNext.disabled = !state.score || playing || state.arming;
  const staff = state.score?.parts.find((part) => part.role === "SA") || state.score?.parts[0];
  const barNo = staff?.measures[state.playMeasure]?.number || "1";
  els.playFromLabel.textContent = state.arming ? "Loading" : playing ? "Stop" : `Play from ${barNo}`;
  els.songTitle.textContent = state.score?.title || "Vocal pitch editor";
  renderMixSliders();
  const showNote = !!selected?.note.pitch;
  els.home.hidden = showNote;
  els.titleBlock.hidden = showNote;
  els.readout.hidden = !showNote;
  els.scope.hidden = !showNote;
  els.thumbEdit.hidden = !showNote;
  els.thumbNav.hidden = showNote;
  if (!showNote) {
    els.drawerHeading.textContent = names[state.activePart];
    els.readout.textContent = "";
    return;
  }
  const now = spellPretty(selected.note.pitch);
  const was = spellPretty(selected.note.originalPitch);
  const changed = state.showChanges && !samePitch(selected.note.pitch, selected.note.originalPitch);
  const bar = selected.measure.number;
  const unison = selected.note.unison ? " · unison" : "";
  const unsure = selected.note.ambiguous && !selected.note.partCover ? " · two-note chord" : "";
  const who = names[state.activePart];
  els.drawerHeading.textContent = `${who} · bar ${bar}`;
  els.readout.textContent = changed
    ? `${who} · bar ${bar} · ${was} → ${now}${unison}`
    : `${who} · bar ${bar} · ${now}${unison}${unsure}`;
}

function selectPart(part) {
  if (state.activePart === part) return;
  mix.selectPart();
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

function svgPoint(svg, event) {
  const rect = svg.getBoundingClientRect();
  const view = svg.viewBox.baseVal;
  if (!rect.width || !rect.height) return { x: 0, y: 0 };
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

function clearSelection() {
  if (!state.selectedId && state.scope === "chord" && state.barAnchor == null) return;
  state.selectedId = null;
  state.scope = "chord";
  state.barAnchor = null;
  if (state.score) render();
  else refreshControls();
}

function onTap(event) {
  if (!state.layout?.systems) return;
  const svg = event.target.closest(".system");
  if (!svg) {
    clearSelection();
    return;
  }
  const point = svgPoint(svg, event);
  const hit = hitTest(state.layout, Number(svg.dataset.index), point.x, point.y, state.activePart);
  if (!hit) {
    clearSelection();
    return;
  }
  if (hit.type === "bar") {
    selectBar(hit.measure.index);
    return;
  }
  if (hit.type === "note") {
    state.scope = "chord";
    state.barAnchor = null;
    state.selectedId = hit.note.id;
    state.playMeasure = hit.note.measureIndex;
    render();
    reveal(hit.note);
    return;
  }
  state.selectedId = null;
  state.scope = "chord";
  state.barAnchor = null;
  state.playMeasure = hit.measure.index;
  render();
  revealSystem(hit.measure.systemIndex);
}

function reveal(note) {
  if (!note || note.systemIndex == null) return;
  const svg = document.querySelector(`.system[data-index="${note.systemIndex}"]`);
  if (!svg) return;
  const box = els.staff;
  const svgRect = svg.getBoundingClientRect();
  const boxRect = box.getBoundingClientRect();
  const scale = svg.viewBox.baseVal.height ? svgRect.height / svg.viewBox.baseVal.height : 1;
  const y = box.scrollTop + (svgRect.top - boxRect.top) + note.hitY * scale;
  if (y < box.scrollTop + 24 || y > box.scrollTop + box.clientHeight - 24) {
    box.scrollTop = Math.max(0, y - box.clientHeight * 0.35);
  }
}

function revealSystem(index) {
  const svg = document.querySelector(`.system[data-index="${index}"]`);
  if (!svg) return;
  const box = els.staff;
  const svgRect = svg.getBoundingClientRect();
  const boxRect = box.getBoundingClientRect();
  const top = box.scrollTop + (svgRect.top - boxRect.top);
  if (top < box.scrollTop + 4 || top + svgRect.height > box.scrollTop + box.clientHeight - 4) {
    box.scrollTop = Math.max(0, top - 8);
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
  if (placed) reveal(placed);
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
  state.arming = true;
  refreshControls();
  const unlocked = state.engine.resume();
  unlocked
    .then(() => state.engine.loadMix(mix.playback()))
    .then(() => {
      state.arming = false;
      if (!state.score) {
        refreshControls();
        return;
      }
      const prepared = preparePlayback(state.score, null);
      const written = state.layout?.measures[state.playMeasure]?.startQl ?? 0;
      state.engine.setMix(mix.playback());
      state.transport = startTransport({
        engine: state.engine,
        getEvents: () => preparePlayback(state.score, null).events,
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
  const heads = document.querySelectorAll(".playhead");
  for (const head of heads) head.setAttribute("visibility", "hidden");
  if (ql == null || !state.layout?.systems) return;
  const loc = locateQl(state.layout, Math.min(ql, state.layout.endQl));
  const head = document.querySelector(`.system[data-index="${loc.systemIndex}"] .playhead`);
  if (!head) return;
  head.setAttribute("x1", String(loc.localX));
  head.setAttribute("x2", String(loc.localX));
  head.setAttribute("y1", String(loc.y1));
  head.setAttribute("y2", String(loc.y2));
  head.setAttribute("visibility", "visible");
  const svg = head.closest(".system");
  const box = els.staff;
  const svgRect = svg.getBoundingClientRect();
  const boxRect = box.getBoundingClientRect();
  const scale = svg.viewBox.baseVal.height ? svgRect.height / svg.viewBox.baseVal.height : 1;
  const y = box.scrollTop + (svgRect.top - boxRect.top) + ((loc.y1 + loc.y2) / 2) * scale;
  if (y < box.scrollTop + 16 || y > box.scrollTop + box.clientHeight - 16) {
    box.scrollTop = Math.max(0, y - box.clientHeight * 0.45);
  }
}

function stepPlayMeasure(dir) {
  if (!state.score || state.transport) return;
  const count = vocalPart(state.score)?.measures.length ?? 0;
  state.playMeasure = Math.max(0, Math.min(count - 1, state.playMeasure + dir));
  render();
  const system = state.layout.systems?.find((item) => state.playMeasure >= item.first && state.playMeasure <= item.last);
  if (system) revealSystem(system.index);
}

function showSection(name) {
  state.moreSection = name;
  for (const id of ["part", "mix", "file"]) {
    document.querySelector(`#panel-${id}`).hidden = id !== name;
    document.querySelector(`#tab-${id}`).setAttribute("aria-pressed", id === name ? "true" : "false");
  }
}

function setMore(open) {
  els.drawer.hidden = !open;
  els.backdrop.hidden = !open;
  els.more.setAttribute("aria-expanded", open ? "true" : "false");
  if (open) showSection(state.moreSection || "part");
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
els.playFrom.addEventListener("click", togglePlay);
els.barPrev.addEventListener("click", () => stepPlayMeasure(-1));
els.barNext.addEventListener("click", () => stepPlayMeasure(1));
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
els.addHigh.addEventListener("click", () => withStructure(() => addParts(state.score, selectionChords(), ["S"])));
els.addLow.addEventListener("click", () => withStructure(() => addParts(state.score, selectionChords(), ["T"])));
els.removePart.addEventListener("click", () => withStructure(() => removePart(state.score, selectionChords(), state.activePart)));
els.makeMelody.addEventListener("click", () => withStructure(() => setMelodyNotes(state.score, selectionChords(), state.activePart)));
els.unison.addEventListener("click", () => withStructure(() => setUnisonNotes(state.score, selectionChords(), state.activePart)));
for (const button of document.querySelectorAll("[data-cover]")) {
  button.addEventListener("click", () => {
    const cover = button.dataset.cover === "ST" ? ["S", "T"] : [button.dataset.cover];
    withStructure(() => setStackCover(selectionChords(), cover));
  });
}
els.changes.addEventListener("click", () => {
  state.showChanges = !state.showChanges;
  if (state.score) render();
  else refreshControls();
});
els.more.addEventListener("click", () => setMore(els.drawer.hidden));
els.backdrop.addEventListener("click", () => setMore(false));
for (const id of ["part", "mix", "file"]) {
  document.querySelector(`#tab-${id}`).addEventListener("click", () => showSection(id));
}
els.mixSliders.addEventListener("input", onMixInput);
els.mixReset.addEventListener("click", resetMix);
els.tempo.addEventListener("input", () => {
  state.bpm = Number(els.tempo.value);
  els.bpm.textContent = els.tempo.value;
});
for (const button of document.querySelectorAll("[data-part]")) {
  button.addEventListener("click", () => selectPart(button.dataset.part));
}

els.staff.addEventListener("pointerdown", (event) => {
  if (event.pointerType === "mouse" && event.button !== 0) return;
  tap = { x: event.clientX, y: event.clientY };
});
els.staff.addEventListener("pointerup", (event) => {
  if (!tap) return;
  const dx = event.clientX - tap.x;
  const dy = event.clientY - tap.y;
  tap = null;
  if (dx * dx + dy * dy > 64) return;
  onTap(event);
});
els.staff.addEventListener("pointercancel", () => {
  tap = null;
});
window.addEventListener("resize", () => {
  if (!state.score || !state.layout) return;
  if (Math.abs(wrapWidth() - state.layout.wrapWidth) > 1) render();
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    setMore(false);
    return;
  }
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

refreshControls();
