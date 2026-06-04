---
id: J-watch-slice-live-log
category: observability
status: draft
last_reviewed: 2026-05-21
---

# Watch a slice's live log while Rom is implementing

## What the user is trying to accomplish

A slice is in IN_PROGRESS state — Rom's `claude -p` invocation is running. Philipp wants to check on progress without waiting for DONE. Philipp opens the Ops Center, navigates to the Active Build panel, and watches Rom's live log output streaming in near real-time.

## Preconditions

- A slice is in IN_PROGRESS state (`bridge/queue/{id}-IN_PROGRESS.md` exists)
- Rom's `claude -p` process is running and producing output
- The orchestrator has captured or is streaming Rom's stdout/stderr to an accessible location
- The Ops Center dashboard is open and connected to the dashboard server

## Steps

1. Rom is implementing slice N; the Active Build panel (`.panel-hero`, `.active-slice`) shows the slice title and elapsed time
2. The orchestrator writes Rom's log output to a per-slice log file or streams it as events to `bridge/register.jsonl`
3. Philipp observes the Active Build panel; a "View live log" button is visible in the panel's action group
4. Philipp clicks "View live log"
5. A modal or expanded section opens, showing the streaming log output (last ~100 lines or a scrollable transcript)
6. New log lines appear as Rom's process writes them (sub-second if event-driven; up to ~1–2s if file-polling)
7. Philipp scrolls up to see earlier output
8. Philipp presses Escape or clicks the close button to dismiss the log view

## Expected outcomes

- Live log modal or panel opens and displays recent log output
- New lines appear in near real-time while Rom's process is running
- Log text is readable and scrollable; close button and Escape key work
- If Rom's process crashes or completes, the log stops updating (not an error state — expected)
- Logs are preserved on disk after the session for post-mortem if needed

## Known failure modes

- **"View live log" button does not appear.** The orchestrator may not have wired a log-output path, or the Active Build panel template is missing the button. *Recovery:* Check `bridge/logs/` for a per-slice log file. Verify the orchestrator is capturing output. File a finding if the button is absent.
- **Log modal opens but shows no content.** The log file may be empty (process just started) or the server is not serving log content. *Recovery:* Wait a few seconds; Rom may still be initializing. If still empty after 10 seconds, check that the process is running.
- **Log updates are laggy or not refreshing.** The file-polling interval may be too long. *Recovery:* Check the server's log-serving implementation for poll frequency.
- **Log contains interleaved or out-of-order stdout/stderr lines.** Multi-threaded output from the subprocess may not be synchronized. *Recovery:* This is a known limitation of subprocess output capture; expected behavior.

## Sources

- `dashboard/DASHBOARD-REDESIGN-SPEC.md` — Active Build panel: "View live log" button, active slice tracker hero panel
- `bridge/logs/` — per-slice log file directory (if file-based log capture is implemented)
- `bridge/orchestrator.js` — log capture and routing for IN_PROGRESS slices

## Open questions

- Is the live log stored per-slice per-round, or accumulated across all rounds? If Rom reworks in Round 2, does the Round 1 log disappear or persist in history?
- Does the live log include the `claude -p` invocation itself (command-line arguments, system prompt), or only Rom's process stdout/stderr?
- If Rom's log output exceeds a size limit (e.g., 10MB), does the oldest content get truncated, or is the entire log preserved with the modal showing only the tail?
- Can Philipp download the log transcript, or is it view-only?
- Is the "View live log" button implemented in the current dashboard HTML? The Active Build panel CSS (`.panel-hero`, `.active-slice`) exists, but it's unclear whether the log-viewing interaction is wired. Route to Ziyal if absent.
