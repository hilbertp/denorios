---
id: "411"
title: "Dev is green again: two test fixes after slices 406 and 410"
from: rom
to: nog
status: DONE
slice_id: "411"
branch: "slice/411"
completed: "2026-09-26T02:00:08.436Z"
tokens_in: 56
tokens_out: 36691
elapsed_ms: 439975
estimated_human_hours: 1.0
compaction_occurred: false
tokens_cache_read: 1721750
cost_usd: 2.554824
---

# Dev is green again: two test fixes after slices 406 and 410

## Summary

Two independent red lights on dev, both in test code, neither in the product.

Slice 406 gave `renderTopoSvg()` a call to `kindMeaning()`, which reads the const `KIND_MEANINGS`. `j-dev-commit-list.test.js` lifts `renderTopoSvg` out of the page by copying named functions into a `new Function` factory, and it copied the caller without the callee — so both slice-397 guards threw `ReferenceError: kindMeaning is not defined`. The factory now copies the table and `kindMeaning()` too.

Slice 410's fixture helper built its source text by concatenating a chunk that ended in a test-call opener. The slice-316-ac-9 tag scanner reads every regression source for that opener followed by a quote; the quote that closed the chunk was the quote it wanted, so it took the join that followed for the name of an untagged test. The helper is now one template literal, emitting the same bytes, with nothing for the scanner to latch onto. `j-gate-fail-retry.test.js` is untouched — the criterion was to stop tripping the scanner, not to loosen it.

## What changed

- `regression/gate-merge/j-dev-commit-list.test.js` — `extractBlock()` and `render()` take an optional `src` (defaulting to the page on disk); the factory now also copies `const KIND_MEANINGS` and `function kindMeaning`. Plus the two slice-411 guards.
- `regression/gate-merge/j-coverage-run-and-require.test.js` — the `tagged` fixture helper is one template literal instead of a concatenation. Plus the slice-411-ac-3 guard.

No product code changed. No `e2e/` file touched. `regression/*.lock` not regenerated and not edited, as the brief instructs.

## Acceptance criteria verification

| Criterion | Test file | Command | Result |
|---|---|---|---|
| slice-411-ac-1 | `regression/gate-merge/j-dev-commit-list.test.js` | `node --test regression/gate-merge/j-dev-commit-list.test.js` | pass — `slice-397-ac-1`, `slice-397-ac-2` and `slice-411-ac-1` all green (4/4 in the file) |
| slice-411-ac-2 | `regression/gate-merge/j-dev-commit-list.test.js` | `node --test regression/gate-merge/j-dev-commit-list.test.js` | pass — rewording the S line in a copy of the page source moves the rendered S hover with it |
| slice-411-ac-3 | `regression/gate-merge/j-coverage-run-and-require.test.js` | `node --test regression/gate-merge/j-coverage-run-and-require.test.js` and `node --test regression/gate-merge/j-gate-fail-retry.test.js` | pass — 8/8 in the coverage file (including slice-410-ac-6, the lock ratchet and the two byte-identical regenerations); 9/9 in the retry file, `slice-316-ac-9` green, file unmodified in `git status` |

Fixture bytes: `tagged()` was compared old-vs-new for the default tag, the empty tag, a slice tag and an untagged name — identical in all four. The pinned literal in slice-411-ac-3 holds that going forward.

Only two files appear in `git status`; `j-gate-fail-retry.test.js` is not one of them.

## Safety-net tests

Three written, one per criterion. The brief lists no traps, so three is the whole set.

- `slice-411-ac-1` — renders three commits carrying kind letters S, P and H through the lifted renderer and checks the rows, the per-node kind labels and the (i) legend. Nothing is stubbed, so a callee the factory forgets is a `ReferenceError`.
- `slice-411-ac-2` — renders the S commit twice: once from the page as shipped, once from a copy of the page source with the S line of `KIND_MEANINGS` reworded, and requires the hover to follow the reword (and the shipped wording to be gone from it).
- `slice-411-ac-3` — pins the fixture bytes against a written-out literal, then runs the slice-316-ac-9 scanner (regex and predicate copied, with a comment saying so, since requiring that file would register its suite here) over this file alone.

Break-it, three runs:

1. **Fix removed** (the two `extractBlock` lines dropped from the factory; `tagged` back to a concatenation) — `slice-411-ac-1` RED, `slice-411-ac-2` RED, `slice-411-ac-3` RED. The two slice-397 guards went red too, which is the bug this slice was sent to fix. With that break in place the real `slice-316-ac-9` also went red, so the copied scanner and the original agree.
2. **ac-2 specifically** — fix restored, then a hardcoded copy of the table injected into the factory instead of lifting it from `src`: `slice-411-ac-1` stayed GREEN and only `slice-411-ac-2` went RED, on the right assertion ("rewording S in the page must reword the hover; if it does not, this file is reading a table of its own"). So ac-2 is not green by construction — it fails exactly when the wording stops being the page's.
3. **Fix restored** — 12/12 across both files, 9/9 in `j-gate-fail-retry.test.js`.

Browser: I did not look. This slice changes no product code, and the brief's own reading is that the page works — the incomplete copy was in the test.

## Screen hooks

No criterion ships a screen change; the page is byte-unchanged. For completeness, the hooks slice-411-ac-1 and ac-2 read are the ones slice 406 already shipped, and all three exist in `dashboard/lcars-dashboard.html`:

- `circle.topo-dev-node[data-sha]` with a child `<title>` — visible whenever the dev line has commits; the title's first line is the kind label and its meaning.
- `text.topo-node-label[data-sha]` — visible only for a commit the server sent a `label` for.
- `text.topo-kind-info` with a child `<title>` — the "(i)" legend at the right end of the dev line, visible when there is at least one commit.

## Tests moved or weakened

None weakened, none moved, none removed.

Two existing helpers in `j-dev-commit-list.test.js` were widened, not loosened: `extractBlock(header)` and `render(bs)` each gained a trailing optional `src` parameter defaulting to the page on disk. Every existing call site is unchanged and still reads the real page; the parameter exists so slice-411-ac-2 can prove the renderer reads what it is handed. The two slice-397 guards are otherwise untouched and assert exactly what they asserted before.

`regression/gate-merge/j-gate-fail-retry.test.js` was not edited, as the brief requires.

## Commit

Branch `slice/411`, cut from dev at `3abca6a`. One commit for the two fixes and the three guards, with the three AC trailers; this report committed after it.
