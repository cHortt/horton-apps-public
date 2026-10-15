# horton-life-ops-public

Public, static pages served with GitHub Pages: https://chortt.github.io/horton-life-ops-public/

| Path | What |
|---|---|
| [`grocery/`](https://chortt.github.io/horton-life-ops-public/grocery/) | Daily grocery deals for the Northport/Tuscaloosa, AL area (Publix, ALDI, Walmart): a searchable, filterable, phone-first page. `grocery/index.html` is always the latest day; `grocery/YYYY-MM-DD.html` keeps earlier days. |
| [`vocal/`](https://chortt.github.io/horton-life-ops-public/vocal/) | Vocal pitch editor. Open a Piano Vocal MusicXML file, change vocal pitches, listen, and export. Static files only: nothing is uploaded and song data is not stored. |

GitHub Pages serves this repository from the root of `main`, so each folder is its own path. Grocery pages are each one self-contained HTML file. The vocal editor is a folder of static files under `vocal/`. These pages use no cookies and don't track visitors. The editor does not upload the file you open. Prices come from the stores' own public ads and coupons. Check the store before you buy.

## Applet conventions

Each tool is an applet: its own top-level folder, served at that path (`grocery/`, `vocal/`, and whatever comes next). Applets must not block or break each other.

- **No shared global state.** An applet does not read or write another applet's pages or storage. A service worker deletes only cache names that start with its own prefix, and it is registered with scope `./` so it controls that folder and nothing above it. These applets share the `chortt.github.io` origin, so a worker that cleared every cache would wipe the others.
- **Own tests.** An applet's tests run in `.github/workflows/<folder>.yml`, and that workflow triggers only on changes under `<folder>/**`. A failing applet test does not fail the repo-wide secret and PII scan, and it does not fail another applet's workflow.
- **Own allowlist entry.** Tracked paths have to match `scripts/path_allow.py`. Root files are named there. Each applet lists the file types its folder may contain. Adding an applet is a new entry in that file, plus the workflow above. `gitleaks` and `scripts/pii_scan.py` still scan every tracked file.

## ⚠️ Public repository: no personal or secret data, ever

Read [POLICY.md](POLICY.md) before changing anything. In short, never commit any of these:
- names, emails, phone numbers, or addresses
- receipts or purchase history
- budget or spending data
- health information
- keys, tokens, or credentials
- content from private repositories

Every push is scanned by `gitleaks` and `scripts/pii_scan.py` (see `.github/workflows/scan.yml`). GitHub secret scanning and push protection are on.
