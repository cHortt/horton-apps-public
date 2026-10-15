#!/usr/bin/env python3
"""Fail if a tracked file is outside the public path allowlist.

Root files are named explicitly. Each applet is one top-level folder and may
contain only the file types listed for it. Adding an applet is a new APPLETS
entry, not an edit to a shared regex. The applet's test workflow, if it has
one, is .github/workflows/<folder>.yml and is allowed with that entry.

This does not relax secret or PII scanning. gitleaks and scripts/pii_scan.py
still run on every tracked file. Paths that are not declared here are rejected,
including data files, keys, and binaries an applet did not list.
"""
import os, re, subprocess, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

ROOT_FILES = {
    "README.md",
    "POLICY.md",
    ".nojekyll",
    ".gitignore",
    "index.html",
    "scripts/pii_scan.py",
    "scripts/pii_allow.txt",
    "scripts/path_allow.py",
    ".github/workflows/scan.yml",
}

# Types are full-match patterns for the path inside the applet folder.
APPLETS = {
    "grocery": [
        r"(?:index|[0-9]{4}-[0-9]{2}-[0-9]{2})\.html",
    ],
    "vocal": [
        r"index\.html",
        r"style\.css",
        r"sw\.js",
        r"OFL-[A-Za-z0-9]+\.md",
        r"js/[a-z0-9]+\.mjs",
        r"fixtures/[a-z0-9-]+\.musicxml",
        r"test/[a-z0-9-]+\.test\.mjs",
    ],
}


def _compiled():
    return {name: [re.compile(rf"{pat}\Z") for pat in pats] for name, pats in APPLETS.items()}


def allowed(path, types=None):
    if path in ROOT_FILES:
        return True
    types = types if types is not None else _compiled()
    for name, pats in types.items():
        prefix = name + "/"
        if path.startswith(prefix):
            rel = path[len(prefix):]
            return any(pat.match(rel) for pat in pats)
        if path == f".github/workflows/{name}.yml":
            return True
    return False


def tracked_files():
    out = subprocess.run(
        ["git", "-C", ROOT, "ls-files", "-z"],
        capture_output=True, check=True,
    ).stdout.decode().split("\0")
    return [path for path in out if path]


def main():
    types = _compiled()
    bad = [path for path in tracked_files() if not allowed(path, types)]
    if bad:
        print("Files outside the public allowlist:")
        for path in bad:
            print(path)
        return 1
    print(f"All tracked files are on the allowlist ({len(tracked_files())} files).")
    return 0


if __name__ == "__main__":
    sys.exit(main())
