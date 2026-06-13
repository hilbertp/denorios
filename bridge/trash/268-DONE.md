---
id: "268"
title: "F-Bash-6 — Test-run step + regression-pass/fail events"
from: rom
to: nog
status: DONE
slice_id: "268"
branch: "slice/268"
completed: "2026-04-30T15:45:00.000Z"
tokens_in: 85000
tokens_out: 18000
elapsed_ms: 420000
estimated_human_hours: 3.0
compaction_occurred: false
---

## Summary

Replaced the placeholder `regression-fail` in `_gateTestsUpdated` with a real test-execution step that spawns `node --test regression/**/*.test.js`, parses results, and emits structured gate events.

## What changed

### `bridge/orchestrator.js`

- **`_gateTestsUpdated`**: Now spawns the Node-native test runner as a subprocess instead of emitting a placeholder `regression-fail`. Handles three outcomes:
  - **Pass (exit 0)**: Emits `regression-pass` with `{ suite_size, duration_ms }`, updates `branch-state.gate.last_pass`, keeps mutex held for slice 269.
  - **Fail (exit non-zero)**: Parses spec-format output (`✖` lines) to extract `failed_acs` with `(slice_id, ac_index)` per the naming convention. Emits `regression-fail` with structured payload. Sets `gate.status = "GATE_FAILED"`, releases mutex.
  - **Timeout**: Emits `regression-fail` with `reason: "suite-timeout"` and empty `failed_acs`. Releases mutex. Runner killed by `execFile` timeout.

- **`_parseFailedAcs(output)`**: New helper. Parses Node-native test runner spec-format output (also supports TAP `not ok` lines). Extracts `slice-<id>-ac-<index>` from test names via regex. Tests that don't follow the convention get `slice_id: "unknown"`, `ac_index: -1` and set `hasNamingViolation: true`.

- **`_parseSuiteSize(output)`**: New helper. Extracts suite size from spec format (`ℹ tests N`), TAP plan (`1..N`), or TAP summary (`# tests N`).

- **`_updateBranchStateOnFail(devTipSha, failedAcs)`**: New helper. Sets `gate.status = "GATE_FAILED"`, clears `current_run`, records `last_failure`.

- **Naming violation handling**: When a failing test doesn't match `slice-<id>-ac-<index>`, emits `BASHIR_TEST_NAMING_VIOLATION` via `registerEvent` (not gate-telemetry — it's not a gate event). Pipeline does NOT block.

- **Timeout**: Configurable via `DS9_REGRESSION_TIMEOUT_S` env var (default 600s = 10 min).

### `regression/README.md`

New file documenting the framework choice (Node-native test runner), invocation pattern, and test naming convention (`slice-<id>-ac-<index>` substring required).

### `test/bashir-tests-updated.test.js`

Updated slice 267's tests to reflect the new async behavior. The old synchronous placeholder tests are replaced with an async poll-based test that verifies `regression-pass` on an empty suite.

### New test files

- `test/regression-pass.test.js`: Unit tests for `_parseSuiteSize` + integration test with a synthetic all-pass suite. Verifies `regression-pass` event, `last_pass` state, mutex held.
- `test/regression-fail.test.js`: Unit tests for `_parseFailedAcs` + integration test with a synthetic failing suite. Verifies `regression-fail` event with structured `failed_acs`, `GATE_FAILED` state, mutex released.
- `test/regression-timeout.test.js`: Integration test with an infinite-loop suite. Verifies `regression-fail` with `reason: "suite-timeout"`, mutex released. Requires `DS9_REGRESSION_TIMEOUT_S=2`.
- `test/regression-naming-violation.test.js`: Unit tests for naming violation detection + integration test with a badly-named failing test. Verifies fallback payload + `BASHIR_TEST_NAMING_VIOLATION` register event + pipeline continues.

## Acceptance criteria verification

1. ✅ After `tests-updated`, orchestrator spawns `node --test regression/**/*.test.js` per README.md's framework declaration.
2. ✅ All-pass case: `regression-pass` event with `{ suite_size, duration_ms }`; `gate.last_pass` populated; mutex held (NOT released).
3. ✅ Any-fail case: `regression-fail` event with structured `failed_acs`; `gate.status = "GATE_FAILED"`; mutex released.
4. ✅ Timeout: `regression-fail { reason: "suite-timeout" }`; mutex released; runner subprocess killed.
5. ✅ Naming-violation case: fallback payload + `BASHIR_TEST_NAMING_VIOLATION` register event; pipeline does NOT block.
6. ✅ All gate events through `gate-telemetry.emit`; naming-violation through `registerEvent`.
7. ✅ Worf's gate-recovery suite (`test/state-gate-mutex.test.js`) passes — 9/9.
8. ✅ All four new tests pass.

## Quality checks

- `releaseGateMutex` does NOT appear in the pass branch — confirmed by grep.
- Runner spawn args match Bashir's framework choice (`node --test regression/**/*.test.js`).
- All state writes use `writeJsonAtomic`.
- No modifications to `bridge/state/*` modules or `roles/bashir/ROLE.md`.
