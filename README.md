# horton-life-ops-public

Public, static pages served with GitHub Pages: https://chortt.github.io/horton-life-ops-public/

| Path | What |
|---|---|
| [`grocery/`](https://chortt.github.io/horton-life-ops-public/grocery/) | Daily grocery deals for the Northport/Tuscaloosa, AL area (Publix, ALDI, Walmart): a searchable, filterable, phone-first page. `grocery/index.html` is always the latest day; `grocery/YYYY-MM-DD.html` keeps earlier days. |
| [`vocal/`](https://chortt.github.io/horton-life-ops-public/vocal/) | Vocal pitch editor. Open a Piano Vocal MusicXML file, change vocal pitches, listen, and export. Static files only: nothing is uploaded and song data is not stored. |

GitHub Pages serves this repository from the root of `main`, so each folder is its own path. Grocery pages are each one self-contained HTML file. The vocal editor is a folder of static files under `vocal/`. These pages use no cookies and don't track visitors. The editor does not upload the file you open. Prices come from the stores' own public ads and coupons. Check the store before you buy.

## ⚠️ Public repository: no personal or secret data, ever

Read [POLICY.md](POLICY.md) before changing anything. In short, never commit any of these:
- names, emails, phone numbers, or addresses
- receipts or purchase history
- budget or spending data
- health information
- keys, tokens, or credentials
- content from private repositories

Every push is scanned by `gitleaks` and `scripts/pii_scan.py` (see `.github/workflows/scan.yml`). GitHub secret scanning and push protection are on.
