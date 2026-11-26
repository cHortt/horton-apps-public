---
trigger: model_decision
description: Apply when designing or modifying WING Rig Visualizer UI components, canvas styling, inspector workflows, or print/PDF layouts.
---

# WING Rig Visualizer UI & Print Rules

1. **Volunteer-First Read-Only Default:** Always open in **Read-Only Mode** so audio volunteers can safely browse, search, inspect patch lists, and Click-to-Trace without accidentally dragging nodes or overwriting labels. Require an explicit **Edit Mode** toggle for layout drags, label/cable edits, adding manual gear/trunks, or deleting items.
2. **Studio-Schematic Light Aesthetic:** Use a crisp, high-contrast light technical schematic palette (paper/canvas off-white `#f8fafc`, crisp white hardware cards, subtle hairline borders, monospaced channel indices, clear protocol color coding for AES50, Analog XLR, Local/TRS, Dante/Card, USB/Network). Never draw 48 individual wires between consoles; group multi-channel runs into a single labeled trunk edge with channel-count pills.
3. **Click-to-Trace Clarity:** Clicking any hardware port, channel row, trunk channel, or mix bus must highlight every upstream and downstream hop across the diagram, dim unrelated nodes/trunks, and display a concise step-by-step Trace Banner. Pressing `Esc` (or clicking Clear) must immediately reset trace state.
4. **Dedicated Print / PDF Layout:** Never rely on browser-printing the React Flow canvas viewport. Render a dedicated `PrintView` (`@media print` + on-screen Print Preview) containing:
   - **Page 1 (Landscape):** Crisp vector SVG System Block Diagram auto-fitted to a single landscape page with legend and metadata header.
   - **Pages 2+ (Portrait):** Binder-ready, ink-friendly patch tables (Stage Inputs, Digital Trunks Forward & Return, Local Console I/O, Monitor & PA Outputs) with repeating `<thead>` headers and clean page breaks.
5. **Client-Side Isolation:** Persist state only under `localStorage` keys prefixed with `wing-rig:`. Make zero external network calls with user `.snap` or `.rig.json` data.
