import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { MXL_ERROR, rejectOpenedFile } from "../js/musicxml.mjs";

const indexHtml = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const appSource = readFileSync(new URL("../js/app.mjs", import.meta.url), "utf8");
const css = readFileSync(new URL("../style.css", import.meta.url), "utf8");

test("compressed .mxl is rejected, including a zip renamed to .musicxml", () => {
  assert.equal(rejectOpenedFile("Song.mxl"), MXL_ERROR);
  assert.equal(rejectOpenedFile("Song.MXL", "<score-partwise>"), MXL_ERROR);
  assert.equal(rejectOpenedFile("Song.musicxml", "PK\u0003\u0004\u0014\u0000"), MXL_ERROR);
  assert.match(MXL_ERROR, /uncompressed MusicXML/);
});

test("an uncompressed partwise score is accepted, and other files are not", () => {
  assert.equal(rejectOpenedFile("Song.musicxml"), "");
  assert.equal(rejectOpenedFile("Song.xml", "<?xml version=\"1.0\"?>\n<score-partwise version=\"4.0\">"), "");
  assert.equal(rejectOpenedFile("notes.txt", "hello"), "This file is not a MusicXML score. Open an uncompressed .musicxml file.");
  assert.equal(rejectOpenedFile("empty.musicxml", ""), "This file is not a MusicXML score. Open an uncompressed .musicxml file.");
});

test("Open is a label for a file input with no accept filter and no hidden attribute", () => {
  assert.match(indexHtml, /<label for="file" id="open">Open<input id="file" type="file"><\/label>/);
  assert.doesNotMatch(indexHtml, /<input[^>]*id="file"[^>]*\baccept=/);
  assert.doesNotMatch(indexHtml, /<input[^>]*id="file"[^>]*\bhidden\b/);
  assert.doesNotMatch(appSource, /file\.click\(/);
  const fileRule = css.slice(css.indexOf("#file {"), css.indexOf("#file {") + 500);
  assert.match(fileRule, /opacity:\s*0/);
  assert.doesNotMatch(fileRule, /display:\s*none/);
});
