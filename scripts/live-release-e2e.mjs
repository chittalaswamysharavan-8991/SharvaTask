import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const endpoint = process.env.SHARVATASK_MCP_URL || 'https://sharvatask.vercel.app/api/mcp';
const runId = process.env.GITHUB_RUN_ID || String(Date.now());
const auditTag = `RELEASE-AUDIT-${runId}-${Date.now()}`;
const listTitle = `Disposable ${auditTag}`;
const originalTaskTitle = `Create ${auditTag}`;
const editedTaskTitle = `Edited ${auditTag}`;
const proofText = `Production proof ${auditTag}`;
const evidence = {
  endpoint,
  run_id: runId,
  audit_tag: auditTag,
  started_at: new Date().toISOString(),
  steps: []
};

function structured(result) {
  if (result?.structuredContent && typeof result.structuredContent === 'object') return result.structuredContent;
  for (const item of result?.content || []) {
    if (item?.structuredContent && typeof item.structuredContent === 'object') return item.structuredContent;
    if (item?.type === 'text' && typeof item.text === 'string') {
      try {
        const parsed = JSON.parse(item.text);
        if (parsed && typeof parsed === 'object') return parsed;
      } catch {}
    }
  }
  throw new Error(`Tool result did not include structuredContent: ${JSON.stringify(result).slice(0, 1200)}`);
}

function record(name, output, extra = {}) {
  evidence.steps.push({
    name,
    at: new Date().toISOString(),
    success: output?.success,
    response_type: output?.response_type,
    action: output?.action,
    error_code: output?.error_code,
    state_version: output?.state_version_after ?? output?.state_version,
    list_id: output?.list?.list_id || output?.affected?.list_id,
    task_id: output?.task?.item_id || output?.affected?.task_id,
    ...extra
  });
}

const client = new Client({ name: 'sharvatask-production-release-audit', version: '1.0.0' });
const transport = new StreamableHTTPClientTransport(new URL(endpoint));

async function call(name, args) {
  const result = await client.callTool({ name, arguments: args });
  const output = structured(result);
  record(name, output);
  return output;
}

async function expectArchivedMutationBlocked(name, args) {
  try {
    const result = await client.callTool({ name, arguments: args });
    const output = structured(result);
    const blocked = output?.success === false || output?.error_code === 'ARCHIVED_LIST';
    record(`${name}_after_archive`, output, { blocked });
    assert.equal(blocked, true, `${name} unexpectedly succeeded on archived list`);
  } catch (error) {
    evidence.steps.push({
      name: `${name}_after_archive`,
      at: new Date().toISOString(),
      blocked: true,
      transport_or_tool_error: String(error?.message || error)
    });
  }
}

try {
  await client.connect(transport);
  evidence.server_version = client.getServerVersion?.();
  evidence.server_capabilities = client.getServerCapabilities?.();
  const tools = await client.listTools();
  const toolNames = (tools?.tools || []).map((tool) => tool.name);
  evidence.tool_names = toolNames;
  for (const required of ['open_task_board','create_list','add_task','edit_task_details','update_task_status','add_proof','refresh_board_state','get_history','archive_list']) {
    assert.ok(toolNames.includes(required), `Missing required production tool: ${required}`);
  }

  const created = await call('create_list', { title: listTitle, project: 'Release Audit' });
  assert.equal(created.success, true, `create_list failed: ${created.message || created.error_code}`);
  const listId = created.list?.list_id || created.affected?.list_id;
  assert.ok(listId, 'create_list did not return a stable list ID');
  evidence.list_id = listId;

  const added = await call('add_task', { list_id_or_query: listId, title: originalTaskTitle, notes: 'Disposable production release audit task', priority: 'P1' });
  assert.equal(added.success, true, `add_task failed: ${added.message || added.error_code}`);
  const taskId = added.affected?.task_id || added.list?.items?.find((item) => item.title === originalTaskTitle)?.item_id;
  assert.ok(taskId, 'add_task did not return a stable task ID');
  evidence.task_id = taskId;

  const edited = await call('edit_task_details', {
    list_id_or_query: listId,
    item_id_or_title: taskId,
    title: editedTaskTitle,
    notes: 'Edited during production release audit',
    next_action: 'Verify persistence and history read-back',
    pablo_instruction: 'Disposable release audit only',
    priority: 'P0'
  });
  assert.equal(edited.success, true, `edit_task_details failed: ${edited.message || edited.error_code}`);
  const editedTask = edited.task || edited.list?.items?.find((item) => item.item_id === taskId);
  assert.equal(editedTask?.title, editedTaskTitle, 'Edited title not returned from backend');
  assert.equal(editedTask?.priority, 'P0', 'Edited priority not returned from backend');

  const status = await call('update_task_status', { list_id_or_query: listId, item_id_or_title: taskId, status: 'done', notes: 'Status changed during release audit' });
  assert.equal(status.success, true, `update_task_status failed: ${status.message || status.error_code}`);

  const proof = await call('add_proof', { list_id_or_query: listId, item_id_or_title: taskId, proof: proofText });
  assert.equal(proof.success, true, `add_proof failed: ${proof.message || proof.error_code}`);

  const refreshed = await call('refresh_board_state', { list_id_or_query: listId });
  assert.equal(refreshed.success, true, `refresh_board_state failed: ${refreshed.message || refreshed.error_code}`);
  const persistedTask = refreshed.list?.items?.find((item) => item.item_id === taskId);
  assert.ok(persistedTask, 'Task missing after backend refresh');
  assert.equal(persistedTask.title, editedTaskTitle, 'Edited title did not persist across refresh');
  assert.equal(persistedTask.status, 'done', 'Status did not persist across refresh');
  assert.ok(Array.isArray(persistedTask.proof) && persistedTask.proof.includes(proofText), 'Proof did not persist across refresh');
  evidence.persisted_task = persistedTask;

  const historyBeforeArchive = await call('get_history', { list_id_or_query: listId });
  assert.equal(historyBeforeArchive.success, true, `get_history failed: ${historyBeforeArchive.message || historyBeforeArchive.error_code}`);
  const actionsBefore = (historyBeforeArchive.events || []).map((event) => event.action);
  for (const requiredAction of ['list_created','task_added','task_updated','task_status_updated','task_proof_added']) {
    assert.ok(actionsBefore.includes(requiredAction), `History missing ${requiredAction}`);
  }
  evidence.history_actions_before_archive = actionsBefore;

  const archived = await call('archive_list', { list_id_or_query: listId, reason: `Disposable release audit ${auditTag} completed` });
  assert.equal(archived.success, true, `archive_list failed: ${archived.message || archived.error_code}`);
  assert.equal(archived.list?.status, 'archived', 'archive_list did not return archived state');

  const archivedReadback = await call('open_task_board', {
    initial_mode: 'archive_recovery',
    list_id: listId,
    include_archived: true,
    restore_strategy: 'explicit_only'
  });
  assert.equal(archivedReadback.success, true, `Archived read-back failed: ${archivedReadback.message || archivedReadback.error_code}`);
  assert.equal(archivedReadback.list?.status, 'archived', 'Archived state not preserved on read-back');

  const historyAfterArchive = await call('get_history', { list_id_or_query: listId });
  const actionsAfter = (historyAfterArchive.events || []).map((event) => event.action);
  assert.ok(actionsAfter.includes('list_archived'), 'History missing list_archived');
  evidence.history_actions_after_archive = actionsAfter;
  const beforeNegativeCount = actionsAfter.length;

  await expectArchivedMutationBlocked('update_task_status', { list_id_or_query: listId, item_id_or_title: taskId, status: 'pending', notes: 'This must be blocked' });
  await expectArchivedMutationBlocked('add_proof', { list_id_or_query: listId, item_id_or_title: taskId, proof: `MUST-NOT-WRITE-${auditTag}` });

  const finalHistory = await call('get_history', { list_id_or_query: listId });
  const finalActions = (finalHistory.events || []).map((event) => event.action);
  assert.equal(finalActions.length, beforeNegativeCount, 'Blocked archived mutations wrote new business events');
  evidence.final_history_actions = finalActions;
  evidence.final_history_count = finalActions.length;
  evidence.completed_at = new Date().toISOString();
  evidence.verdict = 'PASS';
} catch (error) {
  evidence.completed_at = new Date().toISOString();
  evidence.verdict = 'FAIL';
  evidence.error = { message: String(error?.message || error), stack: error?.stack };
  throw error;
} finally {
  await mkdir('artifacts/release-gate', { recursive: true });
  await writeFile('artifacts/release-gate/live-production-e2e.json', JSON.stringify(evidence, null, 2));
  try { await transport.terminateSession?.(); } catch {}
  try { await client.close(); } catch {}
}
