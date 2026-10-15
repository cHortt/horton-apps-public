# Public content policy

**This repository is public. Anyone on the internet can read every file and every past commit.**

## The rule

No personal, private, health, financial, or secret information may ever be committed here. That includes old commits, branches, issues, and pull requests. If something sensitive slips in, deleting it in a later commit is not enough, because it stays in the history. Rotate any exposed secret right away, and rewrite or recreate the repository.

## What counts as sensitive (never allowed)

- **Names** of family members or children, and anything that identifies who uses these pages
- **Contact details:** email addresses, phone numbers, usernames or handles tied to a person
- **Locations tied to a person:** home addresses, renovation or property addresses, school, church, activity, or schedule details
- **Purchases:** receipts, order details, order totals, what was bought, and price histories of purchases
- **Money:** spending, budget, or YNAB data; account balances; account, card, routing, or member numbers
- **Health:** health, medical, or pregnancy information of any kind
- **Secrets:** API keys, tokens, passwords, cookies, credentials, private keys
- **Private repositories:** content copied from any private repository, notes, or connected service

## What is allowed

- Public store deal data: weekly-ad items, prices and deal terms as published by the store, and store digital coupons
- Public coupon matchups from public deal sites, with links
- Generic watch-list items (product, size, brand rule, usual shelf price) with no link to who buys them
- Store names and public store addresses
- Static pages that make no requests and collect no data

## How this is enforced

1. **On the grocery publishing machine (before a commit or push):**
    - a pre-commit and pre-push hook runs `gitleaks` and `scripts/pii_scan.py`, together with a private list of literal terms that is kept outside this repository
    - the hook covers only what the grocery publisher commits: grocery paths (`grocery/**`, the root `index.html`, `.nojekyll`, and these shared docs and scripts when it changes them), and only its own commits being pushed to `main`
    - it blocks any staged file outside those paths
    - other applets (for example `vocal/`) run their own checks
2. **On GitHub, for every push and pull request (all applets):** the `scan` workflow runs `gitleaks` over the full history, plus `scripts/pii_scan.py`, which uses generic patterns only, and `scripts/path_allow.py`.
3. **GitHub secret scanning and push protection** are turned on for the repository.
4. **One publish path:** pages are published only by a script that copies allowlisted generated files, checks them, and then commits.

When a check fires, take the data out. Don't allowlist it. Only public business information, such as a store's public address, may go in `scripts/pii_allow.txt`.

## Applets

Each applet folder is responsible for its own compliance and checks. Every applet is still bound by the rule above: no personal or secret data, ever. The repo-wide `scan` workflow applies to all of them.
