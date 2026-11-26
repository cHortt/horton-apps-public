# Behringer WING Snapshot Fixtures

This directory holds real Behringer WING `.snap` files used to verify schema assumptions and run automated parser/merge regression tests in Vitest.

## `SHC-Monitor.snap`

- **Format:** `type: "snapshot.11"`
- **Creator:** `WING Edit` `3.3.2` (`creator_model: "wing"`, `creator_name: "SHC-MONITOR"`)
- **Console role:** Stage WING Rack monitor console (`LCL` 24 inputs / 8 outputs, `AUX` 8/8, `AES50-A` stage box 32×16, `AES50-C` 48×48 digital split to FOH, `CRD` stereo cue output).
- **Notable routing behaviors covered by tests:**
  - `clink` source-name inheritance vs. explicit channel override (`ch.17` = `"PCORR"` overriding `LCL.1` `"Andrew"`).
  - Direct cross-trunk pass-throughs: `out.C.1..23 <- A.1..23`, `out.C.25..48 <- LCL.*`, and FOH Sub return `out.A.16 <- C.48`.
  - Stereo L/R output slot indexing (`BUS.1..23`, `MAIN.1..2`) and Monitor source indirection (`MON.1..2` → `cfg.mon.1.src = "BUS.7"`).
  - Phantom power (`+48V`), stereo pairs (`mode: "ST"`), and preamp gain metadata.
- **Policy status:** Verified clean against `scripts/pii_scan.py`.
