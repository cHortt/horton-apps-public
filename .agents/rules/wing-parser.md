---
trigger: glob
globs: "**/parser/**, **/schema/**"
---

# Behringer WING Parser & Rig Schema Rules

1. **Never guess WING `.snap` JSON keys.** Every path parsed from `.snap` files must be verified against real fixtures in `wing-rig/fixtures/snapshots/` (beginning with `SHC-Monitor.snap`, `type: "snapshot.11"`, WING Edit `3.3.2`).
2. **Verified `.snap` paths:**
   - Inputs: `ae_data.io.in.<GRP>.<N>` (`LCL`, `AUX`, `A`, `B`, `C`, `SC`, `USB`, `CRD`, `MOD`, `PLAY`, `AES`, `USR`, `OSC`) with `name`, `mode` (`"M" | "ST"`), `g` (gain dB), `vph` (+48V boolean), `pol`, `mute`, `col`, `icon`, `rmt`.
   - Outputs: `ae_data.io.out.<GRP>.<N>` (`LCL`, `AUX`, `A`, `B`, `C`, `SC`, `USB`, `CRD`, `MOD`, `REC`, `AES`) with `{ grp, in }` (`grp: "OFF"` means unpatched).
   - Direct cross-trunk pass-throughs (e.g., `out.C.1..23 <- A.1..23`, `out.C.25..48 <- LCL.*`, `out.A.16 <- C.48`) must be preserved as explicit pass-through signal links so Click-to-Trace follows end-to-end paths cleanly.
   - Stereo output slot indexing:
     - `BUS` `1..32` → Bus `Math.ceil(in / 2)` (`odd = L`, `even = R`)
     - `MAIN` `1..8` → Main `Math.ceil(in / 2)` (`odd = L`, `even = R`)
     - `MTX` `1..16` → Matrix `Math.ceil(in / 2)` (`odd = L`, `even = R`)
     - `MON` `1..4` → Monitor `Math.ceil(in / 2)` (`odd = L`, `even = R`), resolving source from `ae_data.cfg.mon.<1|2>.src` (e.g. `"BUS.7"`).
   - Channels & Auxes: `ae_data.ch.<1..40>` and `ae_data.aux.<1..8>` use `in.conn` (`{ grp, in, altgrp, altin }`), `clink` source-name inheritance (when `ch.name === ""` and `clink` is true, inherit `io.in[grp][in].name`; non-empty `ch.name` always overrides), `send.<1..16>` (`{ on, lvl, mode }`), and `main.<1..4>`.
   - Mix summaries: `ae_data.bus.<1..16>` (`name`, `busmono`, `mute`), `ae_data.main.<1..4>`, `ae_data.mtx.<1..8>`.
3. **Decoupled canonical model:** UI components must never import `.snap` JSON types directly. Always normalize parsed snapshots into `RigDocument` (`wing-rig/src/schema/rig.ts`).
4. **Deterministic, annotation-safe merge:** Re-importing a `.snap` file must update console routing/hardware facts while preserving user-authored `annotations` (friendly labels, cable runs, notes, custom positions) and manually added external gear/trunks. Removed items that carry user annotations must be preserved in `annotations.orphaned` rather than silently discarded.
5. **Fixture-backed testing:** Any change to `wingSnapParser.ts` or `merge.ts` must keep unit tests passing against `wing-rig/fixtures/snapshots/SHC-Monitor.snap`, including idempotency and orphan-preservation checks.
