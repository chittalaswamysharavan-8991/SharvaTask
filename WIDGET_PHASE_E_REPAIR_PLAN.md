# WIDGET_PHASE_E_REPAIR_PLAN.md

**Project:** SharvaTask MCP V2.1 Production Room  
**Phase:** E runtime widget repair  
**Agents activated:** Widget UX Agent + Backend State Agent  
**Operating under:** Pablo Orchestrator control  
**Repository:** `chittalaswamysharavan-8991/SharvaTask`  
**Current main merge:** `8a7f846` - Phase C descriptor/tool surface merge  
**Production site:** `https://sharvatask.vercel.app`  
**Preview deployment:** `https://sharvatask-epljzvkvy-chittalaswamysharavan-7613s-projects.vercel.app`  
**Status:** Repair plan only. No implementation approval. No code changes approved by this artifact. No production data modification approved.

---

## 1. Executive decision

Phase C fixed the descriptor/tool-surface layer well enough for the initial runtime gates: `open_task_board` can mount one widget card, mutation tools are no-template, and internal read tools exist. Phase E must now repair the **mounted widget shell runtime**, especially how it calls data tools, applies returned `structuredContent`, renders history, and presents state compactly.

The repair must preserve the locked V2.1 architecture:

1. `open_task_board` is the only widget-opening tool.
2. All post-open actions update the existing shell from backend-confirmed structured state.
3. Refresh and history are read-only widget modes and must not write business history.
4. Backend owns business data.
5. Widget owns only UI state.
6. No production data cleanup, migration, archive, merge, rename, or active-pointer write is approved.
7. No production-ready claim is allowed until evidence-backed QA passes.

---

## 2. Source evidence reviewed

### Planning artifacts

| Artifact | Use in this plan |
|---|---|
| `CURRENT_STATE_AUDIT.md` | Confirms original goal: one board opens once and all actions update the same widget. |
| `WIDGET_LIFECYCLE_SPEC.md` | Defines refresh, history, action, error, and compact one-shell UX expectations. |
| `BACKEND_STATE_CONTRACT.md` | Defines backend-owned state, full snapshots, version metadata, and no business events for open/view/refresh/search. |
| `TOOL_ARCHITECTURE_DECISION.md` | Locks `open_task_board` as the only render/open tool and read/mutation tools as data-only. |
| `MCP_METADATA_SPEC.md` | Confirms no data/read/alias tool may mount or render a widget. |
| `QA_TEST_PLAN.md` | Defines no-widget-spam, refresh, history, mutation, fresh-chat, archive, and evidence requirements. |

### Current source evidence inspected on `main`

| File | Relevant current observation |
|---|---|
| `app/api/mcp/route.ts` | Phase C split metadata exists: `boardShellToolMeta`, `mutationDataToolMeta`, and `internalDataToolMeta`. `open_task_board` owns `openai/outputTemplate`; read tools including `get_history` and `refresh_board_state` are registered as internal data tools. |
| `src/widget/sharvaTaskWidget.html` | Header buttons still call compatibility tools: `show_history` and `show_list`, not the canonical internal tools `get_history` and `refresh_board_state`. |
| `src/widget/sharvaTaskWidget.html` | Widget `callTool()` only replaces `current` when it finds returned `structuredContent`; it has no central V2.1 response normalizer and still renders from legacy `view` fields. |
| `src/domain/sharvaTaskService.ts` | `refreshBoardStateData()` currently delegates to `getBoardSnapshotData()`, which is acceptable for a read-only refresh if the widget applies the returned state correctly. |
| `src/domain/sharvaTaskService.ts` | `getHistoryData()` filters events by resolved list ID and returns `view: history`, `list`, and `events`; the widget must render those events and avoid false empty states. |
| `src/domain/materialize.ts` | Business events update list/task `updated_at` during replay and no read/refresh event write is required. |

---

## 3. Runtime blockers and ownership

| Bug ID | Title | Owner | Severity | Current status |
|---|---|---|---|---|
| `WIDGET-REFRESH-001` | Refresh button does not visibly refresh existing widget state | Widget UX Agent + Backend State Agent | P0 | Open |
| `WIDGET-HISTORY-001` | History mode opens inside same widget but does not show meaningful business history | Widget UX Agent + Backend State Agent | P0 | Open |
| `WIDGET-DENSITY-001` | Widget has too much low-value UI, space, labels, and clutter | Widget UX Agent | P1 | Open |

---

## 4. Root-cause hypotheses

### 4.1 WIDGET-REFRESH-001

**Primary hypothesis:** The widget shell is not using the Phase C internal refresh path. The current Refresh button calls compatibility `show_list` instead of `refresh_board_state`. Even though `show_list` is no-template, this keeps the widget tied to the old view-oriented flow and weakens the runtime proof that refresh is an internal read mode.

**Secondary hypothesis:** The widget has no robust V2.1 response adapter. It assigns `current = output` only when a narrow structuredContent path is found, then renders from legacy `view` fields. If the ChatGPT Apps SDK returns the result in a slightly different shape, or if the new envelope primarily updates `board_snapshot`, visible state can remain stale.

**Tertiary hypothesis:** The visible “updated” value is tied to `list.updated_at`, not explicit sync metadata such as `server_time`, `state_version`, or `sync_status`. A refresh can return a newer `server_time/state_version` but the UI may still show an older list business timestamp, making refresh look stale.

### 4.2 WIDGET-HISTORY-001

**Primary hypothesis:** The History button calls compatibility `show_history` instead of app-only `get_history`. That alias currently delegates correctly, but the UI still frames history as a legacy `view` payload rather than a V2.1 internal mode fed by `response_type: history`.

**Secondary hypothesis:** The history renderer only reads `current.events`. If the data tool returns events in a nested envelope later, for example `history.events`, `board_snapshot.board.recent_events`, or another structured field, the widget can incorrectly show the empty state even when history exists.

**Tertiary hypothesis:** The empty state is too trusting. It displays “No history found” when `events` is falsy or missing, instead of distinguishing: loading, tool output shape mismatch, list mismatch, truly empty history, or failed read.

### 4.3 WIDGET-DENSITY-001

**Primary hypothesis:** The current shell carries Phase C/QA debug weight into the user-facing UI. Project/status/updated labels, large stat cards, glass-card spacing, raw event JSON, visible IDs/details, and multiple actions compete with the core job: see the list, know sync health, act on tasks.

**Product direction:** Keep the shell alive, but trim the feathers. Show less surface, more signal.

---

## 5. Files and functions to inspect

### Must inspect before implementation

| File | Functions/areas | Reason |
|---|---|---|
| `src/widget/sharvaTaskWidget.html` | `current` initialization, `openai:set_globals`, `callTool`, `header`, `render`, `renderList`, `renderHistory`, `renderLists`, mobile CSS | Runtime bug likely lives here. |
| `src/domain/sharvaTaskService.ts` | `withEnvelope`, `boardSnapshot`, `getBoardSnapshotData`, `refreshBoardStateData`, `getHistoryData`, `openTaskBoardData` | Confirm backend returns enough state and metadata for the shell. |
| `src/domain/materialize.ts` | `materializeLists`, business event replay, `updated_at` handling | Confirm list/task timestamps are business timestamps and not sync timestamps. |
| `src/types.ts` | `SharvaTaskWidgetOutput`, event/list/task output types | Align widget adapter with concrete response shape. |
| `app/api/mcp/route.ts` | `outputSchema`, read-tool registration, internal tool metadata | Confirm no descriptor regression is introduced while repairing runtime. |

### Do not edit unless needed

| File | Reason |
|---|---|
| `app/api/mcp/route.ts` | Phase C descriptor passed. Avoid reopening descriptor risk unless response schema or app visibility requires it. |
| Storage files under `src/storage/` | No production data/schema writes are approved. Read behavior only. |
| Migration/export tools | Out of scope for Phase E runtime repair. |

---

## 6. Files/functions likely to edit after approval

| File | Likely edit | Owner |
|---|---|---|
| `src/widget/sharvaTaskWidget.html` | Replace compatibility calls with internal data tools: `show_list` -> `refresh_board_state`, `show_history` -> `get_history`, list open -> `get_board_snapshot`, continue -> explicit board snapshot/selection. | Widget UX Agent |
| `src/widget/sharvaTaskWidget.html` | Add `applyToolOutput()` / `normalizeOutputToViewState()` adapter for V2.1 envelopes. | Widget UX Agent |
| `src/widget/sharvaTaskWidget.html` | Add explicit sync display from `server_time`, `state_version`, `sync_status`, and optional `snapshot_created_at`. | Widget UX Agent |
| `src/widget/sharvaTaskWidget.html` | Add history loading/error/empty distinctions and render events from the canonical response path. | Widget UX Agent |
| `src/widget/sharvaTaskWidget.html` | Compact CSS and layout: tighter header, smaller counts, hidden secondary details, reduced card gaps, primary actions only. | Widget UX Agent |
| `src/domain/sharvaTaskService.ts` | Only if needed: make `refreshBoardStateData` return explicit refresh message/mode metadata and ensure `getHistoryData` exposes stable event list in the expected canonical field. | Backend State Agent |
| `src/types.ts` | Only if needed: document/extend the structured output type for canonical history and snapshot fields. | Backend State Agent |

---

## 7. Repair plan

### 7.1 Refresh repair

**Goal:** Pressing Refresh updates the visible same-shell state, sync indicator, and state version without creating a widget card and without writing a business event.

**Implementation steps after approval:**

1. In `src/widget/sharvaTaskWidget.html`, change header Refresh action to call:
   - `refresh_board_state({ list_id_or_query: current list_id })`
2. Add `applyToolOutput(result, sourceAction)`:
   - Locate structured content robustly.
   - Accept direct `structuredContent`.
   - Accept nested known MCP result shapes.
   - Reject missing structured content with an inline error, not silent stale UI.
3. Add `normalizeOutputToViewState(output, previousState)`:
   - If `output.response_type` is `board_snapshot` or `mutation_result`, prefer `output.board_snapshot.board.list` when available.
   - Fallback to `output.list` for legacy compatibility.
   - Preserve current mode only when safe; for refresh, return to board mode unless backend recommends error/archive/ambiguity.
   - Preserve `events` only when response includes canonical history or the current mode is history.
4. Store and display sync metadata:
   - `state_version` or `state_version_after`
   - `server_time`
   - `sync_status`
   - optional `snapshot_created_at`
5. UI copy target:
   - Replace “Updated: list business time” as the primary refresh proof.
   - Show compact sync text, for example: `Fresh • v42 • 5:58 PM`.
6. Error behavior:
   - Keep last known good board visible.
   - Show `Refresh failed` only if tool call fails or output shape is invalid.
   - Do not clear tasks on refresh failure.

**Backend expectation:** `refreshBoardStateData()` may remain a read-only wrapper around `getBoardSnapshotData()` if it returns fresh `server_time`, `state_version`, and board snapshot. No write path is allowed.

### 7.2 History repair

**Goal:** History mode uses `get_history`, renders business events inside the existing shell, and shows empty only when returned event list is truly empty.

**Implementation steps after approval:**

1. In `src/widget/sharvaTaskWidget.html`, change History action to call:
   - `get_history({ list_id_or_query: current list_id })`
2. Add `enterHistory(listId)`:
   - Immediately switch to a history loading state inside the same shell.
   - Keep the current list snapshot for the header/back behavior.
   - Call `get_history`.
3. Normalize history output:
   - Prefer `output.events` for current source.
   - Add fallback support for future canonical fields if introduced, for example `output.history?.events` or `output.board_snapshot?.board?.recent_events`.
   - Validate that events belong to the selected `list_id` where possible.
4. Improve states:
   - Loading: `Loading history…`
   - Error: `History could not load. Retry.`
   - Empty: `No business events yet.` only when returned array length is exactly 0.
   - Shape mismatch: `History response missing events. Refresh or retry.`
5. Render meaningful event rows:
   - Event type label.
   - Timestamp.
   - Task/list/proof summary from payload.
   - Hide raw JSON behind a developer/details affordance only.
6. Add Board return action:
   - Uses current board snapshot if present.
   - If board snapshot is stale/missing, calls `get_board_snapshot` or `refresh_board_state` inside the same shell.

**Backend expectation:** `getHistoryData()` must remain read-only and must not create `history.viewed` or any business event.

### 7.3 Density repair

**Goal:** Compact widget target: list title, sync/state indicator, counts, task rows, primary actions only. Secondary details live behind detail/history modes.

**Implementation steps after approval:**

1. Header:
   - Keep list title.
   - Remove/compact “SharvaTask MCP” eyebrow.
   - Replace project/status/updated label row with one compact sync line.
   - Move Archive to overflow or confirmation menu.
2. Counts:
   - Use one compact count strip: `Pending 1 • Done 1 • Blocked 0`.
   - Remove large individual stat cards.
3. Tasks:
   - One row per task with status action, title, small status/priority chip only if useful.
   - Hide task IDs and raw details by default.
   - Hide notes after one line; full note in detail mode.
4. Actions:
   - Primary: Add task, Done/Reopen, Block when relevant.
   - Secondary: History, Refresh, Archive, Proof/detail behind compact icon/action menu.
5. History:
   - No raw JSON by default.
   - Show readable event summary first.
6. Mobile:
   - Header actions must not consume title width.
   - No action hidden without an accessible alternative.

---

## 8. Before/after behavior

| Area | Before | After |
|---|---|---|
| Refresh button | Calls `show_list`; visible timestamp/state can remain stale. | Calls `refresh_board_state`; same widget updates list, counts, sync time, and version. |
| Refresh metadata | UI mainly shows list `updated_at`. | UI shows sync status from `server_time/state_version/sync_status`, while business `updated_at` is secondary or hidden. |
| Refresh history pollution | Not observed as polluted, but must be reverified. | Refresh read creates no business event. |
| History button | Calls compatibility `show_history`; empty state can appear despite events. | Calls `get_history`; loading/error/empty states are separated; business events render clearly. |
| History event display | Raw-ish event display and false empty risk. | Human-readable event rows, raw payload hidden. |
| Tool output handling | Direct assignment to `current` if one narrow structuredContent path exists. | Central adapter normalizes V2.1 envelopes and legacy fallback. |
| Widget density | Large glass cards, many labels, extra spacing, visible details. | Compact board: title, sync, counts, task rows, primary actions. |
| Widget card count | Initial P0 gates passed. | Must remain exactly one through refresh/history/mutations/archive/fresh chat. |

---

## 9. Verification plan

No verification mutation is approved by this plan. Later QA must run only on an approved QA list or safe staging context.

### 9.1 Refresh QA

| Field | Value |
|---|---|
| Test ID | `QA-PHASE-E-REFRESH-001` |
| Owner | QA / Test Agent + Widget UX Agent + Backend State Agent |
| Severity | P0 |
| Preconditions | Board open on `LIST-MRAMBPOI-EBIMQCAO`; current state version known; screen/tool trace enabled. |
| Steps | 1. Record visible sync time, state version, counts. 2. Trigger Refresh inside widget. 3. Confirm tool call is `refresh_board_state`. 4. Inspect returned structuredContent. 5. Confirm visible sync time/state version update. 6. Confirm no new widget card. 7. Confirm history event count unchanged. |
| Pass | Same widget updates from returned state; no second widget; no business event; stale UI not retained. |
| Fail | Refresh calls `show_list`, ignores structuredContent, keeps stale sync/version, writes event, or creates card. |

### 9.2 History QA

| Field | Value |
|---|---|
| Test ID | `QA-PHASE-E-HISTORY-001` |
| Owner | QA / Test Agent + Widget UX Agent + Backend State Agent |
| Severity | P0 |
| Preconditions | Target list has known events: create list, add task, status update. |
| Steps | 1. Open board. 2. Tap History. 3. Confirm tool call is `get_history`. 4. Confirm returned events array is non-empty. 5. Confirm UI renders business events inside same shell. 6. Return to board. 7. Confirm no history-view event is written. |
| Pass | Meaningful timeline appears, no false empty state, no second widget, no business history pollution. |
| Fail | History calls `show_history`, empty appears despite events, event rendering is unreadable, or new card appears. |

### 9.3 Add Task QA

| Field | Value |
|---|---|
| Test ID | `QA-PHASE-E-ADD-TASK-001` |
| Owner | QA / Test Agent + Widget UX Agent + Backend State Agent |
| Severity | P0 |
| Steps | 1. Add one uniquely titled task from widget. 2. Confirm `add_task` receives stable list ID. 3. Confirm response has `mutation_result`, affected task ID, event, board snapshot, counts, state version. 4. Confirm existing shell updates. |
| Pass | Task appears in same widget, pending count increments, total increments, one event created. |
| Fail | No visible update, duplicate widget card, missing task ID, or count mismatch not explained by dirty baseline. |

### 9.4 Update Status QA

| Field | Value |
|---|---|
| Test ID | `QA-PHASE-E-UPDATE-STATUS-001` |
| Owner | QA / Test Agent + Widget UX Agent + Backend State Agent |
| Severity | P0 |
| Steps | 1. Mark a stable task ID done. 2. Confirm `update_task_status` receives stable list ID and task ID. 3. Confirm only that task changes. 4. Confirm counts update in same widget. 5. Confirm state version advances. |
| Pass | Status, counts, and sync metadata update in same shell. |
| Fail | Wrong task changes, UI remains stale, duplicate card appears, or no version metadata. |

### 9.5 Add Proof QA

| Field | Value |
|---|---|
| Test ID | `QA-PHASE-E-ADD-PROOF-001` |
| Owner | QA / Test Agent + Widget UX Agent + Backend State Agent |
| Severity | P1 |
| Steps | 1. Add proof to a stable task. 2. Confirm `add_proof` receives stable list/task IDs. 3. Confirm proof ID and event ID returned. 4. Open detail/history inside same widget. 5. Confirm proof event appears. |
| Pass | Proof count and history linkage update in same shell. |
| Fail | Proof attaches to wrong task, no proof/event ID, no history link, or new card appears. |

### 9.6 Archive QA

| Field | Value |
|---|---|
| Test ID | `QA-PHASE-E-ARCHIVE-001` |
| Owner | QA / Test Agent + Widget UX Agent + Backend State Agent |
| Severity | P1 |
| Preconditions | Dedicated disposable QA list only. Do not archive real production lists. |
| Steps | 1. Confirm archive in widget. 2. Confirm `archive_list` receives stable list ID. 3. Confirm archive recovery mode appears inside same shell. 4. Confirm re-archive is idempotent. 5. Confirm archived list is excluded from default fresh-chat continue. |
| Pass | Archive remains same-shell, preserves history, no duplicate archive event on re-archive. |
| Fail | Archived list widget appears, history lost, active restore opens archived list by default, or duplicate archive events occur. |

### 9.7 Fresh-chat restore QA

| Field | Value |
|---|---|
| Test ID | `QA-PHASE-E-FRESH-CHAT-001` |
| Owner | QA / Test Agent + Backend State Agent + Widget UX Agent |
| Severity | P1 |
| Steps | 1. In Chat A, open/select target list and perform an approved mutation. 2. Record list ID, state version, sync metadata. 3. Open fresh Chat B. 4. Ask to continue SharvaTask. 5. Confirm `open_task_board` restores the intended active list or shows ambiguity/browser state. |
| Pass | Same list ID restores deterministically; no new list; one widget card. |
| Fail | Wrong list, duplicate list, old alias widget, or no safe ambiguity state. |

### 9.8 No-widget-spam QA

| Field | Value |
|---|---|
| Test ID | `QA-PHASE-E-NO-WIDGET-SPAM-001` |
| Owner | QA / Test Agent + all implementation owners |
| Severity | P0 |
| Steps | 1. Open board once. 2. Refresh. 3. Open History. 4. Return Board. 5. Add task. 6. Update status. 7. Add proof. 8. Open list browser/search. 9. Archive disposable QA list. 10. Refresh three times. 11. Count widget cards. |
| Pass | Exactly one SharvaTask widget card for the entire run. |
| Fail | Any second widget card, duplicate assistant response, mode card, or render-like alias behavior. |

---

## 10. QA evidence required

Every Phase E closure must attach:

1. Screen recording or screenshots for the same widget card.
2. Tool trace proving canonical data tools:
   - Refresh -> `refresh_board_state`
   - History -> `get_history`
   - Board/list reads -> `get_board_snapshot` or approved internal equivalent
3. Raw payload samples for refresh/history/add/status/proof/archive.
4. State version table before/after each action.
5. Business history count before/after read-only actions.
6. Widget card count annotation.
7. Bug closure record with owner, severity, fix summary, verification step, and evidence link.

---

## 11. Approval gate before coding

Coding may start only after Pablo Orchestrator explicitly approves this repair plan.

### Approval checklist

| Gate | Required decision |
|---|---|
| Refresh root cause accepted | Approve switching widget Refresh to `refresh_board_state` and adding output normalizer. |
| History root cause accepted | Approve switching History to `get_history` and adding strict loading/error/empty semantics. |
| Density target accepted | Approve compact UI target and hiding secondary details. |
| Backend scope accepted | Backend edits limited to read/envelope fixes only unless separately approved. |
| Production safety accepted | No production data writes, migration cleanup, archive/rename/delete/merge, or active pointer changes during repair planning. |
| QA scope accepted | Mutating QA steps require approved QA list/staging context. |

---

## 12. Specialist handoff

### Widget UX Agent owns

- In-shell tool routing.
- `applyToolOutput()` normalizer.
- Refresh/history visible states.
- Compact UI pass.
- No-widget-spam UI verification hooks.

### Backend State Agent owns

- Read-only refresh correctness.
- History data correctness.
- State version/server time/sync metadata presence.
- No business event writes for refresh/history/open/search/mode changes.
- Snapshot/event shape compatibility with widget normalizer.

### QA / Test Agent owns after implementation

- Evidence pack.
- Card count proof.
- Payload samples.
- State version table.
- History cleanliness proof.
- Bug closure validation.

---

## 13. Final decision

**Decision:** Phase E repair should proceed as a widget runtime/state-application repair, not as a descriptor rewrite. The descriptor surface appears Phase C-correct enough to preserve the single-live-widget rule, while the widget shell still needs canonical internal tool calls, robust V2.1 structuredContent normalization, meaningful history rendering, refresh sync proof, and compact UX cleanup.

**Output:** `WIDGET_PHASE_E_REPAIR_PLAN.md`

**Open status:** Awaiting Pablo Orchestrator approval before coding.
