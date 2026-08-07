import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

const routeIntentSource = readFileSync(new URL('../src/domain/routeIntent.ts', import.meta.url), 'utf8');
const routeIntentJavaScript = ts.transpileModule(routeIntentSource, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 }
}).outputText.replace("from '../types';", "from 'data:text/javascript,export%20{}';");
const routeIntent = await import(`data:text/javascript;base64,${Buffer.from(routeIntentJavaScript).toString('base64')}`);

const taskA = { item_id: 'TASK-A', title: 'Verify add task updates same widget', notes: 'pending duplicate', next_action: '', pablo_instruction: '', status: 'pending', priority: 'P0', proof: ['proof-a'], created_at: '2026-08-06T00:00:00Z', updated_at: '2026-08-06T00:01:00Z' };
const taskB = { ...taskA, item_id: 'TASK-B', status: 'done', proof: ['proof-b'] };
const lists = [
  { list_id: 'LIST-A', title: 'QA Runtime Validation', project: 'Runtime QA', status: 'active', created_at: '2026-08-06T00:00:00Z', updated_at: '2026-08-06T00:01:00Z', items: [taskA, taskB] },
  { list_id: 'LIST-B', title: 'Archived QA', project: 'Runtime QA', status: 'archived', created_at: '2026-08-05T00:00:00Z', updated_at: '2026-08-05T00:01:00Z', items: [{ ...taskA, item_id: 'TASK-C', title: 'Archived task' }] }
];
const events = [{ event_id: 'EVT-1', event_time: '2026-08-06T00:01:00Z', list_id: 'LIST-A', action: 'task_added', payload: {} }];

test('route intent preserves explicit modes and explicit-only does not silently restore', () => {
  const detail = routeIntent.normalizeOpenTaskBoardIntent({ initial_mode: 'task_detail', task_id: 'TASK-A', restore_strategy: 'explicit_only' });
  assert.equal(detail.mode, 'task_detail');
  assert.equal(detail.task_id, 'TASK-A');
  assert.equal(routeIntent.resolveRouteList(lists, events, detail).value, undefined);
});

test('exact stable task ID resolves globally while duplicate titles stay ambiguous', () => {
  const exact = routeIntent.resolveRouteTask(lists, 'TASK-A');
  assert.equal(exact.value?.item_id, 'TASK-A');
  assert.equal(exact.list?.list_id, 'LIST-A');
  const duplicate = routeIntent.resolveRouteTask(lists, 'Verify add task updates same widget');
  assert.equal(duplicate.error_code, 'TASK_AMBIGUOUS');
  assert.equal(duplicate.candidates?.length, 2);
});

test('list-scoped search returns task cards instead of converting the query into list search', () => {
  const result = routeIntent.searchRouteTargets(lists, 'Verify add task', { list: lists[0] });
  assert.equal(result.lists.length, 0);
  assert.equal(result.tasks.length, 2);
  assert.equal(result.tasks[0].list_id, 'LIST-A');
});

test('archived targets require includeArchived for query matching but stable IDs remain deterministic', () => {
  const hidden = routeIntent.resolveRouteList(lists, events, routeIntent.normalizeOpenTaskBoardIntent({ list_query: 'Archived QA', restore_strategy: 'explicit_only' }));
  assert.equal(hidden.error_code, 'LIST_NOT_FOUND');
  const visible = routeIntent.resolveRouteList(lists, events, routeIntent.normalizeOpenTaskBoardIntent({ list_query: 'Archived QA', include_archived: true, restore_strategy: 'explicit_only' }));
  assert.equal(visible.value?.list_id, 'LIST-B');
});

const html = readFileSync(new URL('../src/widget/sharvaTaskWidget.html', import.meta.url), 'utf8');
const script = html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
assert.ok(script);
function widgetHarness(toolOutput) {
  const root = { innerHTML: '', addEventListener() {} };
  const calls = [];
  const context = {
    console, Date, JSON, Object, Array, String, Number, Math, setTimeout, clearTimeout,
    document: { getElementById(id) { return id === 'root' ? root : null; } },
    confirm: () => true, prompt: () => null,
    window: {
      openai: {
        toolOutput,
        notifyIntrinsicHeight() {},
        async callTool(name, args) { calls.push({ name, args }); return { structuredContent: toolOutput }; }
      },
      addEventListener() {}
    }
  };
  context.globalThis = context;
  vm.createContext(context);
  vm.runInContext(`${script}\n;globalThis.routing={getState:()=>current,refreshBoard,openSearchTaskDetail};`, context);
  return { root, calls, api: context.routing };
}

test('initial task_detail backend route renders the focused task without collapsing to board', () => {
  const h = widgetHarness({ response_type: 'task_detail', view: 'task_detail', mode_recommendation: 'task_detail', message: 'Task detail ready', list: lists[0], task: taskA, focused_task_id: 'TASK-A', state_version: 10 });
  assert.equal(h.api.getState().mode, 'task_detail');
  assert.equal(h.api.getState().selected_task_id, 'TASK-A');
  assert.match(h.root.innerHTML, /Verify add task updates same widget/);
});

test('search route renders matching task cards and routes selection through get_task_detail', async () => {
  const h = widgetHarness({ response_type: 'search_results', view: 'search', mode_recommendation: 'search', message: 'Found tasks', task_results: [{ list_id: 'LIST-A', list_title: 'QA Runtime Validation', project: 'Runtime QA', task: taskA }], lists: [], state_version: 10 });
  assert.equal(h.api.getState().mode, 'search');
  assert.match(h.root.innerHTML, /Open task/);
  await h.api.openSearchTaskDetail('LIST-A', 'TASK-A');
  assert.deepEqual(JSON.parse(JSON.stringify(h.calls)), [{ name: 'get_task_detail', args: { list_id_or_query: 'LIST-A', item_id_or_title: 'TASK-A' } }]);
});

test('proof and archive modes render without falling back to the board', () => {
  const proof = widgetHarness({ response_type: 'proof_detail', view: 'proof_detail', mode_recommendation: 'proof_detail', message: 'Proof detail ready', list: lists[0], task: taskA, focused_task_id: 'TASK-A', proofs: ['proof-a'], selected_proof: 'proof-a', state_version: 10 });
  assert.equal(proof.api.getState().mode, 'proof_detail');
  assert.match(proof.root.innerHTML, /proof-a/);
  const archive = widgetHarness({ response_type: 'archive_recovery', view: 'archive_recovery', mode_recommendation: 'archive_recovery', message: 'Archived list ready', list: lists[1], state_version: 10 });
  assert.equal(archive.api.getState().mode, 'archive_recovery');
  assert.match(archive.root.innerHTML, /Archived list/);
});
