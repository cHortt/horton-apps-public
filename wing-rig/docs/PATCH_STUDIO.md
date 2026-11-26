# WING Patch Studio — Lossless Dual-`.snap` Editor & Path Verifier

## Design Overview

**WING Patch Studio** lets engineers configure sources, inter-console AES50 splits, return pass-throughs, and mix bus routing across one or both Behringer WING consoles, verify signal paths live on the Interactive Schematic, and export lossless patched `.snap` files—without risking DSP or control-surface corruption.

## Key Architectural Decisions

1. **Lossless Patch-Overlay Export (`src/parser/snapPatcher.ts`)**
   - Raw imported `.snap` files (~900 KB each) are stored per console in browser IndexedDB (`wing-rig:snapshots:v1`), keeping portable `.rig.json` exports lightweight.
   - Edits are recorded as canonical, UI-decoupled `SnapPatchOp` entries (`src/schema/patch.ts`) and persisted in `localStorage` under `wing-rig:staged-patches:v1`.
   - On export (and for live Schematic preview), `applyPatchOpsToRawSnap()` mutates only the explicitly targeted `ae_data.*` keys (`io.in`, `io.out`, `ch`, `aux`, `bus`, `main`, `mtx`, `cfg.mon`), preserving all untouched EQ, dynamics, FX racks, DCA groups, mute groups, and `ce_data` control-surface layers byte-for-byte.

2. **Verified `.snap` Mutation Surface**
   - `ae_data.io.in.<GRP>.<N>`: `name`, `mode` (`"M" | "ST"` with odd/even stereo slot pairing), `g`, `vph`, `pol`, `mute`, `col`, `tags`.
   - `ae_data.io.out.<GRP>.<N>`: `{ grp, in }` for direct pass-through splits, unpatching (`grp: "OFF"`), and stereo/mono bus output encoding (`BUS` 1–32, `MAIN` 1–8, `MTX` 1–16, `MON` 1–4).
   - `ae_data.ch.<1..40>` & `ae_data.aux.<1..8>`: `name`, `clink`, `col`, `tags`, `in.conn` (`grp`, `in`, `altgrp`, `altin`), `send.<1..16>.on`, `main.<1..4>.on`.
   - `ae_data.bus.<1..16>`, `ae_data.main.<1..4>`, `ae_data.mtx.<1..8>`: `name`, `busmono`, `mute`, `col`, `tags`.
   - `ae_data.cfg.mon.<1|2>.src`: Monitor source tap (e.g. `"BUS.7"`, `"MAIN.1"`).

3. **Auto-Detected Console Link & Headamp Authority (`src/parser/snapVerifier.ts`)**
   - Infers the inter-console split trunk (e.g. Stage Out `C` ↔ FOH In `C`) from the rig diagram, with inline port & Headamp Owner overrides saved to `wing-rig:console-link:v1`.
   - Preamp gain and `+48V` edits only patch the headamp-owning console; the downstream console stays locked to trim-only mode.

4. **Live Schematic Verification & Smart Guardrails**
   - Opens in **Read-Only Inspector** mode by default; staging edits requires explicitly unlocking **Patch Staging**.
   - Staged patches overlay immediately onto the live `RigDocument` so **Click-to-Trace** verifies every new source, split, or return visually before exporting.
   - The **Path Verifier** flags dead-end splits, stereo/mono mismatches, label drift, unrouted active mix buses, and staged `+48V` changes with 1-click **Stage Fix** actions and a pre-export confirmation checkbox (never hard-blocking).
   - Exports default to `<original>-YYYYMMDD.snap` (editable per console) and support **Commit Baseline** to promote patched files into the active IndexedDB baseline while preserving all Layer 2 annotations.
