#!/usr/bin/env python3
"""Fail if files contain personal or secret data. Public, generic patterns only.

Usage:
  python3 scripts/pii_scan.py [--denylist FILE] [PATH ...]

With no PATHs it scans every file tracked by git (plus staged files). Exit code 1
on any finding. --denylist adds literal terms kept OUTSIDE this public repo
(one per line, case-insensitive whole-word match; '#' comments; lines starting
with '!allow ' are regexes for known-safe phrases removed before matching).
Known-safe public phrases (e.g. a store's public address) live in
scripts/pii_allow.txt as regexes.
"""
import os, re, subprocess, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SELF = {'scripts/pii_scan.py', 'scripts/pii_allow.txt'}
# The policy docs must name the categories they forbid; only the bare keyword check is waived there.
DOC_WAIVE = {('POLICY.md', 'spending / budget data'), ('README.md', 'spending / budget data')}

GENERIC = [
    ('email address', r'[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}'),
    ('phone number', r'(?<![\d$.,/])(?:\+?1[-. ]?)?\(?\b[2-9]\d{2}\)?[-. ]\d{3}[-. ]\d{4}\b(?![\d%])'),
    ('street address', r'\b\d{2,6}\s+(?:[NSEW]\.?\s+)?(?:[A-Z][a-z]+\s+){1,3}(?:St|Street|Rd|Road|Ave|Avenue|Blvd|Boulevard|Dr|Drive|Ln|Lane|Way|Ct|Court|Cir|Circle|Hwy|Highway|Pkwy|Parkway|Pl|Place|Trl|Trail|Loop|Ter|Terrace)\b\.?'),
    ('PO box', r'(?i)\bP\.?\s?O\.?\s+Box\s+\d+'),
    ('SSN-like number', r'\b\d{3}-\d{2}-\d{4}\b'),
    ('account/card number', r'(?i)\b(?:account|acct|routing|card|member|policy)\s*(?:number|no\.?|#|ending(?: in)?)\s*[:#]?\s*\*?\d{4,}'),
    ('receipt / spending total', r'(?i)\b(?:receipt|ynab|order total|subtotal|grand total|you spent|we spent|amount paid|you paid|budgeted|transaction|card ending|total charged)\b[^\n<]{0,60}\$\s?\d'),
    ('spending / budget data', r'(?i)\b(?:ynab|budget (?:category|balance|remaining)|age of money|net worth|account balance|checking balance|savings balance)\b'),
    ('personal health info', r'(?i)\b(?:weeks pregnant|trimester|due date is|expecting (?:a|our|the family\'s) (?:baby|child)|ob[- ]?gyn appointment|medical record|diagnosed with|prescription for (?:my|our|her|him))\b'),
    ('private key', r'-----BEGIN (?:[A-Z]+ )?PRIVATE KEY-----'),
    ('AWS key', r'\b(?:AKIA|ASIA)[0-9A-Z]{16}\b'),
    ('GitHub token', r'\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{20,})'),
    ('Slack token', r'\bxox[abposr]-[A-Za-z0-9-]{10,}'),
    ('Google API key', r'\bAIza[0-9A-Za-z_-]{35}\b'),
    ('OpenAI-style key', r'\bsk-(?:proj-|live-|test-)?[A-Za-z0-9_-]{20,}'),
    ('Stripe key', r'\b(?:sk|rk|pk)_(?:live|test)_[A-Za-z0-9]{16,}'),
    ('JWT', r'\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}'),
    ('credential assignment', r'(?i)\b(?:api[_-]?key|secret|token|passw(?:or)?d|client[_-]?secret|auth)\b\s*[:=]\s*["\'][^"\'\s]{8,}["\']'),
    ('URL with credentials', r'\b[a-z][a-z0-9+.-]*://[^/\s:@]+:[^/\s@]+@'),
]
GENERIC = [(n, re.compile(p)) for n, p in GENERIC]

def load_allow(path):
    out = []
    if os.path.exists(path):
        for ln in open(path, encoding='utf-8'):
            ln = ln.strip()
            if ln and not ln.startswith('#'): out.append(re.compile(ln, re.I))
    return out

def load_denylist(path):
    terms, allow = [], []
    for ln in open(path, encoding='utf-8'):
        ln = ln.rstrip('\n').strip()
        if not ln or ln.startswith('#'): continue
        if ln.startswith('!allow '):
            allow.append(re.compile(ln[7:].strip(), re.I)); continue
        digits = re.sub(r'\D', '', ln)
        if len(digits) >= 10 and not re.search(r'[A-Za-z]', ln):   # phone-like: any separators
            d = digits[-10:]
            rx = r'(?<!\d)\(?' + d[:3] + r'\)?[-. ]?' + d[3:6] + r'[-. ]?' + d[6:] + r'(?!\d)'
        else:
            rx = r'(?<![A-Za-z0-9])' + re.escape(ln) + r'(?![A-Za-z0-9])'
        terms.append((ln, re.compile(rx, re.I)))
    return terms, allow

def tracked_files():
    try:
        out = subprocess.run(['git', '-C', ROOT, 'ls-files', '-z', '--cached', '--others', '--exclude-standard'],
                             capture_output=True, check=True).stdout.decode().split('\0')
        return [f for f in out if f]
    except Exception:
        return [os.path.relpath(os.path.join(d, f), ROOT) for d, _, fs in os.walk(ROOT) if '/.git' not in d + '/' for f in fs]

def scrub(text, allows):
    for rx in allows: text = rx.sub(lambda m: ' ' * len(m.group(0)), text)
    return text

def main(argv):
    deny_path = None
    if '--denylist' in argv:
        i = argv.index('--denylist'); deny_path = argv[i + 1]; del argv[i:i + 2]
    files = argv or tracked_files()
    pub_allow = load_allow(os.path.join(ROOT, 'scripts', 'pii_allow.txt'))
    terms, priv_allow = load_denylist(deny_path) if deny_path else ([], [])
    hits = 0
    for f in files:
        path = f if os.path.isabs(f) else os.path.join(ROOT, f)
        rel = os.path.relpath(path, ROOT)
        if not os.path.isfile(path) or rel.startswith('.git/'): continue
        try: raw = open(path, encoding='utf-8').read()
        except UnicodeDecodeError:
            blob = open(path, 'rb').read()
            # Learning lessons ship rendered PDFs. Scan their bytes with the same
            # patterns; do not treat a real PDF as an automatic finding.
            if rel.endswith('.pdf') and blob.startswith(b'%PDF-'):
                raw = blob.decode('latin-1')
            else:
                print(f'{rel}: binary file (not allowed in this repo; publish text/HTML only)'); hits += 1; continue
        checks = []
        if rel not in SELF: checks += [(n, rx, pub_allow) for n, rx in GENERIC if (rel, n) not in DOC_WAIVE]
        checks += [('denylisted term', rx, pub_allow + priv_allow) for _, rx in terms]
        for name, rx, allows in checks:
            text = scrub(raw, allows)
            for m in rx.finditer(text):
                line = text.count('\n', 0, m.start()) + 1
                shown = 'redacted' if name == 'denylisted term' else m.group(0)[:60]
                print(f'{rel}:{line}: {name}: {shown}')
                hits += 1
    if hits:
        print(f'\npii_scan: {hits} finding(s). Remove the data (do not just allowlist it) before publishing.')
        return 1
    print(f'pii_scan: clean ({len(files)} file(s) checked{", with private denylist" if terms else ""}).')
    return 0

if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
