# WING Rig Visualizer — Product & Functional Specification

## Overview

**WING Rig Visualizer** is a 100% client-side web application for documenting, exploring, tracing, and printing Behringer WING live-audio rigs (dual-console or single-console setups with stage boxes, wireless racks, IEM racks, media playback, and PA amplification).

It is served statically at `https://chortt.github.io/horton-apps-public/wing-rig/` with zero backend, zero telemetry, and strict `wing-rig:` `localStorage` isolation.

## Core Design Principles

### 1. Two-Layer Data Model
Live-sound documentation breaks down when console snapshots overwrite human knowledge (cable numbers, stage locations, wireless rack channels, or notes about external amps). WING Rig Visualizer cleanly separates:

- **Layer 1 — Console & Hardware Facts (`RigDocument.nodes`, `RigDocument.trunks`):** Structured hardware devices, I/O port groups, channel patches (label, gain, `+48V`, mono/stereo mode, console channel assignment, mix bus sends), mix bus summaries, and directional trunk runs (`channels` forward + `returnChannels` reverse). Populated from Behringer WING `.snap` files or manually authored external gear.
- **Layer 2 — Human Annotation Overlay (`RigDocument.annotations`):** Friendly display names, physical cable/snake tags, rack/stage notes, canvas `(x, y)` positions, and `orphaned` records. Re-importing an updated `.snap` updates Layer 1 while preserving Layer 2 and surfacing removed annotated items in `annotations.orphaned` instead of silently deleting them.

### 2. Volunteer-First UX
- **Read-Only by default:** Volunteers at FOH or stage racks can search any mic/instrument/bus, click any device or cable trunk, inspect 1–48 channel patch tables, and Click-to-Trace signal flow end-to-end without risking accidental layout drags or edits.
- **No 48-wire spaghetti:** Multi-channel snakes (AES50-A, AES50-C, analog snakes, IEM looms) render as single labeled bidirectional trunk paths with protocol colors and channel-count pills.
- **Instant Click-to-Trace:** Clicking any input, channel, trunk slot, or mix bus illuminates the complete signal path (e.g., `Stage Box In 1 (Kick)` → `AES50-A Ch 1` → `Stage WING Ch 1` → `AES50-C Out 1` → `FOH WING`) while dimming unrelated gear, with a top Trace Banner showing each hop (`Esc` clears).
- **Explicit Edit Mode:** Toggling Edit Mode unlocks node dragging, inline editing of friendly names/cable tags/notes, adding external hardware or custom trunks, and portable `.rig.json` import/export.

### 3. Binder-Ready Print & PDF Output
Sound booths still rely on laminated sheets and rack binders. A dedicated Print Preview & `@media print` view generates:
- **Page 1 (Landscape):** Fit-to-page crisp vector SVG System Block Diagram with protocol legend and rig metadata.
- **Pages 2+ (Portrait):** Clean, high-contrast black-and-white-friendly patch tables covering Stage Inputs, Digital Trunks (Forward & Return), Local I/O, and Monitor/PA Outputs.

## Delivery Milestones

| Milestone | Scope | Key Deliverables |
|---|---|---|
| **Milestone 1** | Core Rig Schema & Interactive System Block Diagram | Canonical `RigDocument` schema, graph trace helpers, realistic dual-WING sanctuary mock rig, studio-schematic React Flow canvas with trunk pills & Click-to-Trace |
| **Milestone 2** | Inspector, Search & Edit Mode | Read-Only Side Inspector with Forward/Return 1–48 tables, `+48V`/`ST`/gain badges, global Search-and-Trace, Edit Mode (drag-save, inline annotations, Add Gear/Trunk modal, `.rig.json` import/export) |
| **Milestone 3** | Dedicated Print / PDF View | Landscape Page 1 vector SVG block diagram + Portrait Pages 2+ binder-ready patch tables, on-screen Print Preview & `@media print` styling |
| **Milestone 4** | Browser-Side WING `.snap` Parser & Annotation-Safe Merge | Verified `snapshot.11` parser, deterministic Layer 1/Layer 2 merge with pre-apply diff preview & orphan tracking, fixture test suite against `SHC-Monitor.snap` |
