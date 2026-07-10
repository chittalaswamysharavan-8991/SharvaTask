import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const route = readFileSync(new URL('../app/api/mcp/route.ts', import.meta.url), 'utf8');
const widgetModule = readFileSync(new URL('../src/widget/sharvaTaskWidget.ts', import.meta.url), 'utf8');

function registeredTool(name) {
  const match = new RegExp(`server\\.registerTool\\(\\s*['\"]${name}['\"]`).exec(route);
  const start = match?.index ?? -1;
  assert.notEqual(start, -1, `${name} must remain registered`);
  const end = route.indexOf('server.registerTool(', start + 1);
  return route.slice(start, end === -1 ? route.length : end);
}

function metadataObject(name) {
  const start = route.indexOf(`const ${name} = {`);
  assert.notEqual(start, -1, `${name} must remain defined`);
  const end = route.indexOf('\n};', start);
  assert.notEqual(end, -1, `${name} must have a bounded object definition`);
  return route.slice(start, end + 3);
}

const templateOwners = route.match(/['"]openai\/outputTemplate['"]\s*:/g) || [];
assert.equal(templateOwners.length, 1, 'openai/outputTemplate effective owner count must be exactly one');

const boardMeta = metadataObject('boardShellToolMeta');
const mutationMeta = metadataObject('mutationDataToolMeta');
const internalMeta = metadataObject('internalDataToolMeta');
const openBoard = registeredTool('open_task_board');
const editDetails = registeredTool('edit_task_details');

assert.match(boardMeta, /'openai\/outputTemplate': SHARVATASK_WIDGET_URI/, 'boardShellToolMeta must own the output template');
assert.match(boardMeta, /resourceUri: SHARVATASK_WIDGET_URI/, 'boardShellToolMeta must own the widget resource URI');
assert.match(openBoard, /_meta: boardShellToolMeta/, 'open_task_board must be the sole template-owning tool');
assert.equal((route.match(/_meta: boardShellToolMeta/g) || []).length, 1, 'boardShellToolMeta must be assigned to exactly one tool');

for (const [name, block] of [
  ['edit_task_details', editDetails],
  ['mutationDataToolMeta', mutationMeta],
  ['internalDataToolMeta', internalMeta]
]) {
  assert.doesNotMatch(block, /outputTemplate/, `${name} must remain template-free`);
  assert.doesNotMatch(block, /resourceUri/, `${name} must remain resourceUri-free`);
}

assert.match(
  widgetModule,
  /SHARVATASK_WIDGET_URI\s*=\s*'ui:\/\/widget\/sharvatask-v2-4-clickdiag\.html'/,
  'widget URI must remain ui://widget/sharvatask-v2-4-clickdiag.html'
);

console.log('Descriptor verification passed: one open_task_board template owner; data tools are template-free.');
