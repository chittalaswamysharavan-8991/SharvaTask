import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const widget = readFileSync(new URL('../src/widget/sharvaTaskWidget.html', import.meta.url), 'utf8');
const service = readFileSync(new URL('../src/domain/taskDetailsService.ts', import.meta.url), 'utf8');

function functionBody(name) {
  const start = widget.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `${name} must exist`);
  const remainder = widget.slice(start + 1);
  const nextMatch = /\n(?:async )?function /.exec(remainder);
  const end = nextMatch ? start + 1 + nextMatch.index : widget.length;
  return widget.slice(start, end);
}

const openDetail = functionBody('openTaskDetail');
const saveDetails = functionBody('saveTaskDetails');
const backToBoard = functionBody('backToBoard');
const setGlobals = functionBody('applySetGlobals');
const historyGuard = functionBody('historyGuardActive');

assert.match(widget, /view:'task_detail',mode:'task_detail'/, 'task_detail mode must exist');
assert.match(widget, /data-action="task-detail"[\s\S]*?>Open\/Edit</, 'task rows must expose Open/Edit');
assert.doesNotMatch(openDetail, /callTool\(|open_task_board/, 'Open/Edit must not call open_task_board or another backend tool');
assert.match(saveDetails, /callTool\('edit_task_details',args\)/, 'Save must call edit_task_details');
assert.match(saveDetails, /list_id_or_query:listId,item_id_or_title:taskId/, 'Save must use stable list/task IDs');
assert.doesNotMatch(backToBoard, /callTool\(/, 'Back must not call a backend tool');
assert.match(backToBoard, /detailDirty\(\)&&!confirm\(/, 'Back must confirm before discarding a dirty draft');
assert.match(setGlobals, /detailDirty\(\)/, 'set_globals must guard dirty Task Detail drafts');
assert.match(setGlobals, /set_globals preserved dirty Task Detail draft/, 'dirty-draft preservation must be diagnosable');
assert.match(widget, /No notes yet\./, 'legacy empty notes must render');
assert.match(widget, /No next action set\./, 'legacy empty next action must render');
assert.match(widget, /No Pablo instruction set\./, 'legacy empty Pablo instruction must render');
assert.match(historyGuard, /view==='history'/, 'existing History guard must remain present');
assert.match(setGlobals, /set_globals preserved History mode/, 'set_globals History preservation must remain present');
assert.equal((service.match(/createEvent\('task_updated'/g) || []).length, 1, 'one successful save path must create exactly one task_updated event');

console.log('Phase F verification passed: F2 detail guards and F3 draft/save behavior are present.');
