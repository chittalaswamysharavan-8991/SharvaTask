import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

const html = readFileSync(new URL('../src/widget/sharvaTaskWidget.html', import.meta.url), 'utf8');
const script = html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
assert.ok(script, 'widget script must be embedded in the HTML');

const materializeSource = readFileSync(new URL('../src/domain/materialize.ts', import.meta.url), 'utf8');
const materializeJavaScript = ts.transpileModule(materializeSource, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 }
}).outputText;
const { materializeLists, serializeListForBoard } = await import(`data:text/javascript;base64,${Buffer.from(materializeJavaScript).toString('base64')}`);

const originalTask = {
  item_id: 'task-1',
  task_id: 'task-1',
  title: 'Legacy task',
  notes: '',
  next_action: '',
  pablo_instruction: '',
  priority: 'P1',
  status: 'pending',
  proof: []
};

function output(task = originalTask, stateVersion = 2) {
  return {
    view: 'list',
    mode: 'list',
    message: 'Board ready',
    list: { list_id: 'list-1', title: 'QA list', status: 'active', items: [{ ...task }] },
    events: [],
    state_version: stateVersion,
    state_version_after: stateVersion
  };
}

function harness() {
  const calls = [];
  const root = { innerHTML: '', addEventListener() {} };
  const listeners = {};
  const context = {
    console,
    Date,
    JSON,
    Object,
    Array,
    String,
    Number,
    Math,
    setTimeout,
    clearTimeout,
    document: { getElementById(id) { return id === 'root' ? root : null; } },
    confirm: () => true,
    prompt: () => null,
    window: {
      openai: {
        toolOutput: output(),
        notifyIntrinsicHeight() {},
        async callTool(name, args) {
          calls.push({ name, args });
          return { structuredContent: output() };
        }
      },
      addEventListener(name, handler) { listeners[name] = handler; }
    }
  };
  context.globalThis = context;
  vm.createContext(context);
  vm.runInContext(`${script}\n;globalThis.phaseF={openTaskDetail,beginTaskEdit,updateDetailDraft,saveTaskDetails,refreshBoard,backToBoard,applySetGlobals,getState:()=>current,getDraft:()=>detailDraft,getOriginal:()=>detailOriginal,isEditing:()=>detailEditing,getSaveError:()=>detailSaveError};`, context);
  return { api: context.phaseF, calls, context, root, listeners };
}

test('F2 opens legacy empty details in the same widget without a backend call', () => {
  const h = harness();
  h.api.openTaskDetail('list-1', 'task-1');
  assert.equal(h.calls.length, 0);
  assert.equal(h.api.getState().mode, 'task_detail');
  assert.match(h.root.innerHTML, /No notes yet\./);
  assert.match(h.root.innerHTML, /No next action set\./);
  assert.match(h.root.innerHTML, /No Pablo instruction set\./);
});

test('F3 saves only changed editable fields and remains in Task Detail', async () => {
  const h = harness();
  h.api.openTaskDetail('list-1', 'task-1');
  h.api.beginTaskEdit();
  h.api.updateDetailDraft('notes', 'Saved notes');
  h.api.updateDetailDraft('next_action', 'Ship preview');
  h.context.window.openai.callTool = async (name, args) => {
    h.calls.push({ name, args });
    const task = { ...originalTask, notes: 'Saved notes', next_action: 'Ship preview' };
    return { structuredContent: { ...output(task), task, response_type: 'mutation_result', mode_recommendation: 'task_detail', success: true } };
  };

  assert.equal(await h.api.saveTaskDetails(), true);
  assert.deepEqual(JSON.parse(JSON.stringify(h.calls)), [{
    name: 'edit_task_details',
    args: {
      list_id_or_query: 'list-1',
      item_id_or_title: 'task-1',
      notes: 'Saved notes',
      next_action: 'Ship preview'
    }
  }]);
  assert.equal(h.api.getState().mode, 'task_detail');
  assert.equal(h.api.getState().list.items[0].notes, 'Saved notes');
  assert.equal(h.api.isEditing(), false);
});

test('failed save preserves the local draft and exposes an inline retry error', async () => {
  const h = harness();
  h.api.openTaskDetail('list-1', 'task-1');
  h.api.beginTaskEdit();
  h.api.updateDetailDraft('notes', 'Do not lose this');
  h.context.window.openai.callTool = async () => { throw new Error('temporary failure'); };

  assert.equal(await h.api.saveTaskDetails(), false);
  assert.equal(h.api.getDraft().notes, 'Do not lose this');
  assert.equal(h.api.getState().mode, 'task_detail');
  assert.match(h.api.getSaveError(), /draft is preserved; retry Save/i);
  assert.match(h.root.innerHTML, /role="alert"/);
});

test('dirty Back requires confirmation and never calls a backend tool', () => {
  const h = harness();
  h.api.openTaskDetail('list-1', 'task-1');
  h.api.beginTaskEdit();
  h.api.updateDetailDraft('notes', 'Unsaved');
  h.context.confirm = () => false;
  assert.equal(h.api.backToBoard(), false);
  assert.equal(h.api.getState().mode, 'task_detail');
  h.context.confirm = () => true;
  assert.equal(h.api.backToBoard(), true);
  assert.equal(h.api.getState().mode, 'list');
  assert.match(h.root.innerHTML, /QA list/);
  assert.doesNotMatch(h.root.innerHTML, /Task not found in current board snapshot/);
  assert.equal(h.calls.length, 0);
});

test('set_globals cannot overwrite a dirty draft', () => {
  const h = harness();
  h.api.openTaskDetail('list-1', 'task-1');
  h.api.beginTaskEdit();
  h.api.updateDetailDraft('notes', 'Local draft');
  h.context.window.openai.toolOutput = output({ ...originalTask, notes: 'Incoming server value' });
  h.api.applySetGlobals();
  assert.equal(h.api.getDraft().notes, 'Local draft');
  assert.equal(h.api.getState().mode, 'task_detail');
  assert.match(h.api.getState().diag_label, /preserved dirty Task Detail draft/);
});

test('saved Phase F fields survive refresh and stale set_globals before reopening Task Detail', async () => {
  const events = [
    { event_id: 'event-1', event_time: '2026-07-10T00:00:00.000Z', list_id: 'list-1', action: 'list_created', payload: { title: 'QA list', project: 'QA' } },
    { event_id: 'event-2', event_time: '2026-07-10T00:01:00.000Z', list_id: 'list-1', action: 'task_added', payload: { item_id: 'task-1', title: 'Legacy task', priority: 'P1', status: 'pending' } },
    { event_id: 'event-3', event_time: '2026-07-10T00:02:00.000Z', list_id: 'list-1', action: 'task_updated', payload: { item_id: 'task-1', task_id: 'task-1', title: 'Legacy task', notes: '', next_action: 'Persisted next action', pablo_instruction: 'Persisted Pablo instruction', priority: 'P1', status: 'pending' } }
  ];
  const refreshedList = serializeListForBoard(materializeLists(events)[0]);
  const savedTask = refreshedList.items[0];
  assert.equal(savedTask.next_action, 'Persisted next action');
  assert.equal(savedTask.pablo_instruction, 'Persisted Pablo instruction');
  const legacySnapshotTask = serializeListForBoard(materializeLists(events.slice(0, 2))[0]).items[0];
  assert.equal(legacySnapshotTask.next_action, '');
  assert.equal(legacySnapshotTask.pablo_instruction, '');
  assert.equal(Object.hasOwn(legacySnapshotTask, 'next_action'), true);
  assert.equal(Object.hasOwn(legacySnapshotTask, 'pablo_instruction'), true);

  const h = harness();
  h.api.openTaskDetail('list-1', 'task-1');
  h.api.beginTaskEdit();
  h.api.updateDetailDraft('next_action', savedTask.next_action);
  h.api.updateDetailDraft('pablo_instruction', savedTask.pablo_instruction);
  h.context.window.openai.callTool = async (name, args) => {
    h.calls.push({ name, args });
    if (name === 'edit_task_details') {
      return { structuredContent: { ...output(savedTask, 3), list: refreshedList, task: savedTask, response_type: 'mutation_result', mode_recommendation: 'task_detail', success: true } };
    }
    if (name === 'refresh_board_state') {
      return { structuredContent: { ...output(savedTask, 3), list: refreshedList, response_type: 'board_snapshot', mode_recommendation: 'board', success: true } };
    }
    throw new Error(`Unexpected tool: ${name}`);
  };

  assert.equal(await h.api.saveTaskDetails(), true);
  assert.equal(await h.api.refreshBoard('list-1'), true);
  assert.equal(h.api.getState().list.items[0].next_action, 'Persisted next action');
  assert.equal(h.api.getState().list.items[0].pablo_instruction, 'Persisted Pablo instruction');

  const staleGlobalOutput = output(originalTask, 2);
  delete staleGlobalOutput.state_version_after;
  h.context.window.openai.toolOutput = staleGlobalOutput;
  h.api.applySetGlobals();
  h.api.openTaskDetail('list-1', 'task-1');
  assert.match(h.root.innerHTML, /Persisted next action/);
  assert.match(h.root.innerHTML, /Persisted Pablo instruction/);
  assert.doesNotMatch(h.root.innerHTML, /No next action set\./);
  assert.doesNotMatch(h.root.innerHTML, /No Pablo instruction set\./);
  assert.equal(h.calls.filter(({ name }) => name === 'edit_task_details').length, 1);
  assert.equal(h.calls.filter(({ name }) => name === 'refresh_board_state').length, 1);
});
