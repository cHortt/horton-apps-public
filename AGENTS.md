# Repository Guide for Coding Agents

This repository (`cHortt/horton-apps-public`) hosts independent, client-side static web applets deployed to GitHub Pages (`https://chortt.github.io/horton-apps-public/`).

## Core Repository Rules

1. **Public content policy (`POLICY.md`):** Never commit personal data, secrets, tokens, emails, phone numbers, addresses, receipts, or private notes. Every push and PR runs `gitleaks`, `scripts/pii_scan.py`, and `scripts/path_allow.py`.
2. **Path allowlist (`scripts/path_allow.py`):** Every tracked file must match `ROOT_FILES` or an explicit applet entry in `APPLETS`. Update `scripts/path_allow.py` whenever intentionally introducing a new allowed path pattern, and verify with `python3 scripts/path_allow.py`.
3. **Applet isolation:** Each top-level applet (`grocery/`, `vocal/`, `smokies-trip/`, `learning/`, `wing-rig/`) must remain isolated:
   - Never share `localStorage`, `sessionStorage`, `IndexedDB`, or service-worker caches across applets.
   - Prefix all `wing-rig` browser storage keys strictly with `wing-rig:`.
   - Do not modify `<!-- grocery:start ... -->` / `<!-- grocery:end ... -->` sections in root `index.html`.
4. **Root `.gitignore`:** Line 1 ignores `*.json` globally. Any tracked JSON file inside an applet (such as `wing-rig/package.json`, `wing-rig/package-lock.json`, `wing-rig/tsconfig*.json`) must have an explicit `!` negation rule in `.gitignore`.

## Working on `wing-rig/`

- **Stack:** React + TypeScript + Vite (`base: './'`) + Tailwind CSS (`@tailwindcss/vite`) + `@xyflow/react` + `lucide-react` + `vitest`.
- **Two-layer architecture:** Keep UI components 100% decoupled from raw Behringer WING `.snap` JSON. All views read/write the canonical `RigDocument` model in `wing-rig/src/schema/rig.ts`.
- **Commands (from `wing-rig/`):**
  - `npm ci` — install dependencies
  - `npm run typecheck` — TypeScript strict check
  - `npm test` — Vitest unit & fixture tests
  - `npm run build` — production Vite build into `wing-rig/dist/`
- **Repo-wide verification (from repo root):**
  - `python3 scripts/path_allow.py`
  - `python3 scripts/pii_scan.py`
- **Detailed docs:** See `wing-rig/docs/SPEC.md`, `wing-rig/docs/ARCHITECTURE.md`, and `.agents/rules/`.
