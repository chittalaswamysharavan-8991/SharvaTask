# DESCRIPTOR_DIFF_REPORT.md

**Project:** SharvaTask MCP V2.1 Production Room  
**Agent:** MCP Architect Agent  
**Phase:** Phase C descriptor/tool-surface implementation  
**Branch:** `phase-c-descriptor-tool-surface`  
**Base branch:** `main`  
**Base evidence commit:** `e54f9449da98e6be68ce99bf4cd556bbd79538a9`  
**Status:** Implementation branch artifact only — no deploy, no connector reconnect, no production-ready claim

---

## 1. Files changed

| File | Change type | Purpose |
|---|---|---|
| `app/api/mcp/route.ts` | Modified | Added canonical `open_task_board`; split shared widget metadata; removed `outputTemplate` / `ui.resourceUri` from all data, read, internal, and alias tools; added V2.1 read/query tools; rewrote descriptors. |
| `src/domain/sharvaTaskService.ts` | Modified | Added structured response envelopes, board snapshots, duplicate candidate behavior, list/task ambiguity placeholders, V2.1 read/query data functions, proof IDs for future proof writes, and no-history-write read paths. |
| `src/types.ts` | Modified | Extended `SharvaTaskWidgetOutput` and related types with V2.1 response fields, error codes, sync/mode metadata, ambiguity candidates, and task-detail output support. |
| `reports/DESCRIPTOR_DIFF_REPORT.md` | Added | Captures source-level descriptor/tool-surface diff, verification status, and QA handoff checklist. |

---

## 2. Current/before descriptor risk

Before this Phase C branch, `app/api/mcp/route.ts` used one shared `widgetToolMeta` object containing both `ui.resourceUri: SHARVATASK_WIDGET_URI` and `'openai/outputTemplate': SHARVATASK_WIDGET_URI`.

That shared metadata object was attached to every registered tool, which made all current tools effective widget-template owners:

1. `create_list`
2. `add_task`
3. `update_task_status`
4. `update_task`
5. `add_proof`
6. `show_list`
7. `list_all`
8. `search_lists`
9. `continue_list`
10. `show_history`
11. `archive_list`

Before risk classification:

| Risk | Severity | Before behavior |
|---|---:|---|
| Mutation tools carried widget metadata | P0 | Normal writes could mount/re-render widget cards. |
| Read/show/history/search aliases carried widget metadata | P0 | Navigation could create separate widget cards. |
| One shared invocation label for every tool | P1 | All tools said `Updating SharvaTask…`, obscuring render/data boundaries. |
| `update_task` existed outside locked V2.1 model-visible set | P1 | Unapproved tool was model-visible and template-bearing. |
| No V2.1 structured envelope | P1 | Outputs were view-oriented only: `list`, `lists`, `history`, `message`. |

---

## 3. Final/after tool surface

### Canonical render/open tool

| Tool | Visibility intent | Template? | Resource? | Purpose |
|---|---|---:|---:|---|
| `open_task_board` | Model + app | Yes | Yes | Opens the single SharvaTask board shell. Only tool allowed to mount UI. |

### Approved data-only mutations

| Tool | Visibility intent | Template? | Resource? | Purpose |
|---|---|---:|---:|---|
| `create_list` | Model + app | No | No | Duplicate-aware list creation; returns structured create/candidate state. |
| `add_task` | Model + app | No | No | Adds task and returns structured mutation result plus board snapshot. |
| `update_task_status` | Model + app | No | No | Updates status by stable task ID when possible; returns ambiguity when unsafe. |
| `add_proof` | Model + app | No | No | Adds proof and returns structured proof result plus board/proof state. |
| `archive_list` | Model + app | No | No | Archives list and returns structured archive recovery/browser state. |

### Internal/app data tools

| Tool | Visibility intent | Template? | Resource? | Purpose |
|---|---|---:|---:|---|
| `get_board_snapshot` | App/internal | No | No | Board snapshot read path. |
| `browse_lists` | App/internal | No | No | List browser data. |
| `search_board` | App/internal | No | No | Search-mode data. |
| `get_history` | App/internal | No | No | Business history read. |
| `get_task_detail` | App/internal | No | No | Task/proof/detail data. |
| `refresh_board_state` | App/internal | No | No | Refresh current shell state. |

### Compatibility/internal aliases retained without templates

| Tool | Visibility intent | Template? | Resource? | Treatment |
|---|---|---:|---:|---|
| `show_list` | App/internal compatibility | No | No | Routes to `getBoardSnapshotData`. |
| `list_all` | App/internal compatibility | No | No | Routes to `browseListsData`. |
| `search_lists` | App/internal compatibility | No | No | Routes to `searchBoardData`. |
| `continue_list` | App/internal compatibility | No | No | Routes to active-list restore data path. |
| `show_history` | App/internal compatibility | No | No | Routes to `getHistoryData`. |
| `update_task` | App/internal compatibility | No | No | Retained as no-template data-only edit action for the current widget edit button. |

---

## 4. outputTemplate count before and after

| State | Static source literal count | Effective tool-level owners | Notes |
|---|---:|---:|---|
| Before Phase C | 1 | 11 | One literal lived inside shared `widgetToolMeta`; the object was reused by every tool. |
| After Phase C branch | 1 | 1 | One literal lives inside `boardShellToolMeta`; only `open_task_board` uses that metadata object. |

Source-level check performed on the planned route source before commit:

```text
openai/outputTemplate count: 1
resourceUri count: 1
widgetToolMeta count: 0
```

---

## 5. outputTemplate owner proof

After Phase C, the only metadata object containing `'openai/outputTemplate'` is:

```ts
const boardShellToolMeta = {
  ui: {
    resourceUri: SHARVATASK_WIDGET_URI,
    visibility: ['model', 'app']
  },
  'openai/outputTemplate': SHARVATASK_WIDGET_URI,
  'openai/widgetAccessible': true,
  'openai/toolInvocation/invoking': 'Opening SharvaTask board…',
  'openai/toolInvocation/invoked': 'SharvaTask board ready'
};
```

The only tool using `boardShellToolMeta` is `open_task_board`.

All other registered tools use either `mutationDataToolMeta` or `internalDataToolMeta`, neither of which contains `openai/outputTemplate`.

---

## 6. ui.resourceUri owner proof

After Phase C, `ui.resourceUri` exists only inside `boardShellToolMeta`.

`mutationDataToolMeta` contains only visibility and invocation/widget-access metadata:

```ts
const mutationDataToolMeta = {
  ui: {
    visibility: ['model', 'app']
  },
  'openai/widgetAccessible': true,
  'openai/toolInvocation/invoking': 'Updating SharvaTask state…',
  'openai/toolInvocation/invoked': 'SharvaTask state ready'
};
```

`internalDataToolMeta` also contains no resource URI and no output template:

```ts
const internalDataToolMeta = {
  ui: {
    visibility: ['app']
  },
  'openai/widgetAccessible': true,
  'openai/toolInvocation/invoking': 'Loading SharvaTask state…',
  'openai/toolInvocation/invoked': 'SharvaTask state loaded'
};
```

---

## 7. Model-visible tools

Intended final model-visible set:

1. `open_task_board`
2. `create_list`
3. `add_task`
4. `update_task_status`
5. `add_proof`
6. `archive_list`

Implementation note: this branch uses `ui.visibility` metadata to express model/app intent. If the runtime ignores `ui.visibility`, QA/Metadata must inspect the deployed descriptor and decide whether a stronger hide/remove mechanism is required for app/internal tools.

---

## 8. App-only/internal tools

Intended app/internal tools:

1. `get_board_snapshot`
2. `browse_lists`
3. `search_board`
4. `get_history`
5. `get_task_detail`
6. `refresh_board_state`
7. `update_task`
8. `show_list`
9. `list_all`
10. `search_lists`
11. `continue_list`
12. `show_history`

All app/internal tools are no-template and no-resource. They are kept for mounted-widget calls and compatibility routing only.

---

## 9. Deprecated alias treatment

Deprecated render-like aliases were not allowed to remain independent widget renderers. Phase C retained them as no-template internal compatibility routes because the current widget still calls some of these tool names from inside the shell.

| Alias | New behavior |
|---|---|
| `show_list` | Returns structured board snapshot through `showSharvaListData` / `getBoardSnapshotData`. |
| `list_all` | Returns structured list-browser data through `browseListsData`. |
| `search_lists` | Returns structured search results through `searchBoardData`. |
| `continue_list` | Returns structured active-list board snapshot or ambiguity/error state. |
| `show_history` | Returns structured business history through `getHistoryData`. |

No alias carries `outputTemplate` or `ui.resourceUri`.

---

## 10. update_task decision

Decision: **Retain `update_task` as app/internal no-template data-only compatibility tool.**

Reason:

- The current widget edit button calls `update_task`.
- Removing it in Phase C would break the existing edit affordance before Widget UX Phase E can replace that flow.
- Keeping it internal/no-template preserves functionality while removing widget-spam risk.

Constraints applied:

- No `openai/outputTemplate`.
- No `ui.resourceUri`.
- Uses `internalDataToolMeta` with app visibility intent.
- Descriptor says it is internal/app-only and does not render/open/mount/re-render widgets.
- Service path returns structured mutation envelope and `TASK_AMBIGUOUS` when title resolution is unsafe.

---

## 11. StructuredContent envelope changes

`src/types.ts` now supports V2.1 envelope fields on `SharvaTaskWidgetOutput`:

- `response_type`
- `success`
- `action`
- `request_id`
- `server_time`
- `state_version`
- `state_version_after`
- `mode_recommendation`
- `sync_status`
- `error_code`
- `recovery_actions`
- `affected`
- `active_pointer`
- `board_snapshot`
- `ambiguity`
- `duplicate`
- `event`
- `task`

The legacy view fields remain for current widget compatibility:

- `view`
- `message`
- `list`
- `lists`
- `events`
- `query`

Service responses now include envelope metadata while still preserving legacy view payloads.

---

## 12. Ambiguity behavior changes

Phase C adds structured placeholders/behavior for:

| Code | Behavior |
|---|---|
| `LIST_AMBIGUOUS` | Returned when list title/project/query matches multiple active candidates. No mutation is performed. |
| `TASK_AMBIGUOUS` | Returned when task title/query matches multiple tasks and no stable task ID disambiguates. No mutation is performed. |
| `DUPLICATE_LIST_CANDIDATE` | Returned by `create_list` when an active list with the same normalized title/project already exists. No duplicate list is created. |

The duplicate check is intentionally conservative: active exact normalized title + project match blocks creation and returns candidates.

---

## 13. No-production-data-write proof

Actions performed in this Phase C implementation:

- Created branch `phase-c-descriptor-tool-surface`.
- Edited GitHub source files only.
- Added `reports/DESCRIPTOR_DIFF_REPORT.md`.
- Compared branch diff against `main`.

Actions deliberately not performed:

- No Vercel Blob reads beyond accepted Phase B evidence.
- No Vercel Blob writes.
- No active pointer writes.
- No list/task/proof/event mutations through MCP tools.
- No merge/archive/rename/delete of production lists.
- No generation of missing task IDs in production data.
- No deploy.
- No connector reconnect.
- No full export JSON committed.
- No secrets exposed.

---

## 14. Build/test result

### Build command

Required command: `npm run build`.

Result: **Not run in this chat runtime.**

Reason: the sandbox could not clone GitHub due DNS/network resolution failure, so a local project checkout with dependencies was unavailable. The GitHub connector allowed source edits, but it does not execute `npm run build`.

### Available equivalent verification completed

| Check | Result |
|---|---|
| Branch created | Passed — `phase-c-descriptor-tool-surface`. |
| GitHub source diff | Passed — branch ahead of `main`; only intended source files changed before this report. |
| Source-level `openai/outputTemplate` check | Passed in planned route source: one occurrence. |
| Source-level `resourceUri` check | Passed in planned route source: one occurrence. |
| Shared `widgetToolMeta` removal check | Passed in planned route source: zero occurrences. |
| Data tool metadata review | Passed by source inspection: `mutationDataToolMeta` and `internalDataToolMeta` contain no `outputTemplate` and no `resourceUri`. |
| Production data write check | Passed — no MCP mutation tools or Blob write paths invoked. |

### Required follow-up

Run before merge/deploy:

```bash
npm install
npm run build
npm run typecheck
```

If install is already complete in the maintainer environment, run:

```bash
npm run build
npm run typecheck
```

---

## 15. Remaining blockers

| Blocker | Severity | Owner | Resolution needed |
|---|---:|---|---|
| Build not executed in this runtime | P0 before merge/deploy | MCP Architect / QA | Run `npm run build` and `npm run typecheck` in an environment with repo checkout and dependencies. |
| Descriptor visibility behavior unproven | P0 before production | Metadata / Connector Agent | Inspect deployed descriptor after build/deploy candidate and confirm app/internal tools are hidden or safe. |
| No deployed descriptor diff yet | P0 before production | Metadata / Connector Agent + QA | Fetch deployed descriptor after candidate deploy; prove one effective template owner. |
| Current widget still has legacy internal calls | P1 | Widget UX Agent | Phase E should replace legacy calls with canonical app-only reads where needed. |
| Backend persistence/state version is event-count based | P1 | Backend State Agent | Phase D should formalize durable state version and active pointer. |
| Production duplicate/task ambiguity remains | P1/P0 for data writes | Migration + Backend State | Keep all production data untouched until approved migration write plan. |

---

## 16. QA handoff checklist

QA / Metadata must verify after build/deploy candidate, before production claim:

- [ ] Raw deployed descriptor contains exactly one `_meta.openai/outputTemplate`.
- [ ] The only owner is `open_task_board`.
- [ ] No mutation tool has `outputTemplate` or `ui.resourceUri`.
- [ ] No read/query/internal tool has `outputTemplate` or `ui.resourceUri`.
- [ ] Deprecated aliases are hidden or at least no-template/no-resource.
- [ ] `update_task` is not model-preferred and has no template/resource.
- [ ] `open_task_board` mounts the existing single widget shell.
- [ ] In-widget add/status/proof/archive operations do not create new widget cards.
- [ ] `create_list` returns `DUPLICATE_LIST_CANDIDATE` instead of silently duplicating exact active title/project.
- [ ] Title-based ambiguous task actions return `TASK_AMBIGUOUS`.
- [ ] List ambiguity returns `LIST_AMBIGUOUS`.
- [ ] Reads/search/history/refresh do not create business history events.
- [ ] Protected Phase B regression data remains untouched.
- [ ] `npm run build` passes.
- [ ] `npm run typecheck` passes.

---

Decision:  
Phase C descriptor/tool-surface implementation is complete on branch `phase-c-descriptor-tool-surface` as a source branch only. It is not deployed, not reconnected, not QA-passed, and not production-ready.

Output:  
`reports/DESCRIPTOR_DIFF_REPORT.md` created. Source changes applied to `app/api/mcp/route.ts`, `src/domain/sharvaTaskService.ts`, and `src/types.ts`.

Open Issues:  
`npm run build` and `npm run typecheck` could not be executed in this chat runtime and must be run before merge/deploy. Runtime enforcement of `ui.visibility` must be verified by Metadata / Connector Agent. Deployed descriptor proof is still pending. Phase D/E/QA remain open.

Handoff To:  
Metadata / Connector Agent for descriptor validation, QA / Test Agent for build and no-widget-spam evidence, Backend State Agent for Phase D persistence/state-version hardening, Widget UX Agent for Phase E shell/internal-call cleanup, Pablo Orchestrator for merge/deploy approval decision.

Approval Needed:  
Approval is needed before merge, deploy, connector reconnect, production data writes, or any production-ready claim.
