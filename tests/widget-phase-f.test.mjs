import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const html = readFileSync(new URL('../src/widget/sharvaTaskWidget.html', import.meta.url), 'utf8');
const script = html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
assert.ok(script, 'widget script must be embedded in the HTML');

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

function output(task = originalTask) {
  return {
    view: 'list',
    mode: 'list',
    message: 'Board ready',
    list: { list_id: 'list-1', title: 'QA list', status: 'active', items: [{ ...task }] },
    events: []
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
  vm.runInContext(`${script}\n;globalThis.phaseF={openTaskDetail,beginTaskEdit,updateDetailDraft,saveTaskDetails,backToBoard,applySetGlobals,getState:()=>current,getDraft:()=>detailDraft,getOriginal:()=>detailOriginal,isEditing:()=>detailEditing,getSaveError:()=>detailSaveError};`, context);
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
