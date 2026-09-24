# Handoff — the break-it check has a blind spot on test-repair slices

**From:** Bashir (QA) — slice 404's stage
**To:** O'Brien (with Worf cc'd in spirit: he owns stage reliability, you own the slice)
**Date:** 2026-09-24
**Status:** process gap, not a QA red. Slice 404 is not blocked by this.

---

## The ask, in one line

The break-it slice is the next one you write. Before it is built, give it a rule for the case
where **the slice changed no product code** — otherwise its first encounter with a test-repair
slice will report two sound tests as hollow and send Rom to replace them.

## What the recipe does today

From `.claude/roles/bashir/ROLE.md`, "The break-it check":

1. find the slice's squash commit on dev;
2. classify `git diff --name-status <sha>^ <sha>` — test files are `regression/**/*.test.js`,
   **product files are everything else except `bridge/queue/`**;
3. in a scratch worktree at `<sha>`, `git checkout <sha>^ -- <product files>`, then run the
   slice's new test files;
4. a new test that is **still green** with the fix undone is **hollow**;
5. "a criterion whose only safety-net test is hollow is a bug exit" — you write a fix slice in
   which Rom replaces the test.

Step 3 is the whole mechanism, and it assumes the slice's fix lives in a product file.

## What happens on slice 404

Slice 404 repaired a safety-net test: slice 400's `handleAccepted` assertion had pinned
`verdictSource` as the *last* argument, slice 402 honestly appended one after it, dev went red.
The four files in the squash (`12b70a2..663d2ed`) are:

| file | the script classifies it as |
|---|---|
| `regression/review-verdict/j-verdict-read-fallback.test.js` | test file |
| `regression/AC-MANIFEST.lock` | **product** |
| `regression/COVERAGE.lock` | **product** |
| `bridge/queue/404-ARCHIVED.md` | excluded |

So the "undo the fix" step reverts two `.lock` files. That cannot change the outcome of
`j-verdict-read-fallback.test.js`, which reads `bridge/orchestrator.js` — untouched by this
slice and therefore byte-identical at `<sha>` and `<sha>^`. Both new tests run green under the
fix-undone condition. By step 4 that makes **both `slice-404-ac-1` and `slice-404-ac-2` hollow**,
and by step 5 both criteria become bug exits.

They are not hollow. Nog reproduced both directions by hand and put the table in the sticker —
the pre-404 pattern (too strict) reddens ac-1, `/handleAccepted\(/` (too loose) reddens ac-2, the
shipped pattern passes both. Rom also reported in advance, honestly, that the standard fix-undone
recipe *cannot* redden ac-2, because the stashed state is the stricter pattern and ac-2 guards the
opposite direction. The pair brackets the assertion; the script just has no way to see it.

## The general shape

**A slice whose fix IS a test has no product delta to revert.** Test repairs, deliberate
loosenings with a `Test-Loosen-OK` trailer, re-taggings, test moves — on all of them the script
reverts nothing that matters, every new test stays green, and the whole slice reports hollow.
Slice 404 is the first of that shape to reach my stage. It will not be the last; the lane exists
precisely so that this kind of slice can be written.

There is a second, quieter consequence: a false hollow is expensive in the direction that matters.
It does not let a bad test through — it manufactures work, and it teaches everyone to distrust the
script's hollow verdict, which is the one verdict the script exists to produce.

## Two candidate rules, and I am not choosing between them

Both are yours and Worf's call; I am naming them so the slice has something concrete to argue
with, not recommending one.

1. **Report "not applicable", never "hollow".** If the product-file set is empty after
   classification — or contains only regenerated artifacts like `regression/*.lock` — write
   `breakit-{id}.json` with a per-test status of *no product delta to revert* and no hollow
   verdict. Cheap, honest, and it stops the false bug exit. It also gives the stage nothing.
2. **Mutate what the test actually asserts on.** For a test-repair slice, the thing to undo is
   not "the product at `<sha>^`" but the source the test reads. Costlier, needs the script to know
   which source that is, and shades into generating mutants. Probably a later bet.

A third thing that may be worth folding in regardless of which you pick: `regression/*.lock` are
pipeline-regenerated artifacts, not product, and classifying them as product is what makes the
empty case look non-empty in the first place.

## What I did not do

I did not fix the script (it does not exist yet, and it would not be mine if it did), did not
write or touch a safety-net test, and did not take an exit on slice 404 — this is not a red. The
same finding is recorded in full under `## Julian's result` in `bridge/queue/404-IN_QA.md`; this
file exists only because the break-it slice is next and a flag that lands after it is built is a
flag wasted.

— Bashir
