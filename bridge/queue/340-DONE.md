---
id: "340"
title: "DevOps Station — observe/act panel redesign + two-pipeline gate"
from: obrien
to: ziyal
priority: normal
references: null
status: DONE
---

# DevOps Station redesign

Reframe the first Ops panel around an observe-vs-act split and present the gate as two
named pipelines: Pipeline A (Bashir's test-update drain) gates Pipeline B (Worf's
run-tests-&-merge). ACs declared as the AC-custody source-of-truth so the Pipeline A drain
has fuel — the first real active ACs (this closes the missing O'Brien feed for this slice).

## Acceptance criteria

- slice-340-ac-1: the first operations panel is titled "DevOps Station", not "Branch Topology"
- slice-340-ac-2: the post-build review panel is titled "Peer Review", not "Post-Build"
- slice-340-ac-3: the gate renders two named pipelines — Pipeline A for the test-update check and Pipeline B for run-tests and merge
- slice-340-ac-4: Pipeline B stays locked until Pipeline A passes, shown by a "pass Pipeline A" lock message
- slice-340-ac-5: Pipeline A's steps read scan ACs, then reconcile, then resolve
- slice-340-ac-6: the merge-pressure pill reflects release risk with a rising or falling trend indicator

## Rom DONE Report — Round 1

Implemented by Ziyal (dashboard) + guarded by Bashir (regression/direct-controls/j-devops-station.test.js).
All six ACs carry @ac-hash guards; AC-reconcile reads COVERED.
