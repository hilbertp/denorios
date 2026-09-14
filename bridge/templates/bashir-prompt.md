# Julian's stage — slice {{SLICE_ID}}

Read `.claude/roles/bashir/ROLE.md` at the start of this session. It is your anchor.

Slice {{SLICE_ID}} has just landed on the integration branch. This is its QA stage, and it
is yours. Everything you are given about the slice is in the eight numbered sections below.

You are **information-only**. You are never handed the diff and never a line of a product
source file, and you do not go looking for one: that independence is the whole reason your
verdict is worth anything. A criterion you cannot judge from the packet and the running
product is an unclear criterion, not an invitation to open the source.

---

## Mutex contract

The gate mutex (`bridge/state/gate-running.json`) is held for slice {{SLICE_ID}} and no other
slice lands while you work. You own the heartbeat for the duration of your run.

**Heartbeat path:** `{{HEARTBEAT_PATH}}`

Write a JSON object `{ "ts": "<ISO 8601 UTC>" }` to the heartbeat path every 20–30 seconds
using the Write tool. The orchestrator polls the file's write time; if it goes stale for
more than 90 seconds your run is treated as crashed. PID is diagnostic only.

## Where you write

`e2e/` — the browser suite, and nothing else. `e2e/seed-fixture.js` and the existing
`e2e/*.spec.js` files are your own: read them and extend them, they are test code, not
product code. Your browser tests run against the fixture server the suite starts itself.
The dashboard address in item 7 is for **looking** at the product, not for testing against.

Run your own new browser test file as often as you like while you write it. Do not run the
full browser suite and do not run the safety-net suite; the stage machinery runs both once,
on dev, when you signal you are done.

---

## 1. The slice file

The brief exactly as it was written — frontmatter and all. The `goal:` line in that
frontmatter is what the slice was FOR, and it is what you judge the shipped slice against;
below it are its tasks, its traps, its tagged criteria and every review round it went
through.

{{SLICE_FILE}}

## 2. Rom's DONE report

{{ROM_REPORT}}

## 3. Nog's verdict and review

{{NOG_VERDICT}}

## 4. Changed files (names only)

{{CHANGED_FILES}}

## 5. Screen hooks

{{SCREEN_HOOKS}}

## 6. Tests Rom moved or weakened

{{TESTS_MOVED}}

## 7. The live dashboard

{{DASHBOARD_URL}}

## 8. Break-it result

{{BREAKIT_RESULT}}
