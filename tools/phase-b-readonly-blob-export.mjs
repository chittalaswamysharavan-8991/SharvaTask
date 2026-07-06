#!/usr/bin/env node

/**
 * SharvaTask MCP V2.1
 * Phase B read-only Vercel Blob export utility
 *
 * STRICT SCOPE:
 * - Reads only Blob objects under sharvatask-v2/events
 * - Writes only local backup/report files
 * - Does NOT write to Vercel Blob
 * - Does NOT call MCP mutation tools
 * - Does NOT deploy
 * - Does NOT expose secrets
 */

import { mkdir, writeFile } from 'node:fs/promises';
import crypto from 'node:crypto';
import path from 'node:path';

const SCRIPT_VERSION = 'phase-b-readonly-export-v1.0.1';
const ALLOWED_PREFIX = 'sharvatask-v2/events';
const PREFIX = process.env.SHARVATASK_BLOB_PREFIX || ALLOWED_PREFIX;

const TOKEN =
  process.env.BLOB_READ_WRITE_TOKEN ||
  process.env.BLOB_READ_ONLY_TOKEN ||
  process.env.BLOB_TOKEN ||
  '';

const startedAt = new Date().toISOString();
const stamp = startedAt.replace(/[:.]/g, '-');

const exportPath = path.join(
  'backups',
  'phase-b',
  `blob-events-export-${stamp}.json`,
);

const manifestPath = path.join(
  'backups',
  'phase-b',
  `blob-events-export-${stamp}.manifest.json`,
);

const reportPath = path.join('reports', 'PHASE_B_BLOB_INVENTORY_REPORT.md');

function sha256(text) {
  return crypto.createHash('sha256').update(text).digest('hex');
}

function safeJson(value) {
  return JSON.stringify(value, null, 2);
}

function normalizeTitle(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .normalize('NFKC')
    .replace(/\s+/g, ' ');
}

function firstString(...values) {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }
  return '';
}

function getPayload(event) {
  return event?.payload || event?.data || event?.after || event?.body || {};
}

async function ensureDirs() {
  await mkdir(path.dirname(exportPath), { recursive: true });
  await mkdir(path.dirname(reportPath), { recursive: true });
}

async function streamToText(stream) {
  if (!stream) return '';

  if (typeof Response !== 'undefined') {
    return await new Response(stream).text();
  }

  const chunks = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString('utf8');
}

function emptyInventory() {
  return {
    event_type_counts: {},
    lists: [],
    tasks: [],
    proofs: [],
    duplicate_candidates: [],
    protected_lists: [],
    protected_tasks: [],
    events_missing_id: 0,
    events_missing_list_id: 0,
    read_errors: 0,
  };
}

function buildInventory(events) {
  const inventory = emptyInventory();

  const lists = new Map();
  const tasks = new Map();
  const proofs = [];

  for (const event of events) {
    const payload = getPayload(event);

    const action = firstString(
      event.action,
      event.event_type,
      event.type,
      payload.action,
      payload.event_type,
      'unknown',
    );

    inventory.event_type_counts[action] =
      (inventory.event_type_counts[action] || 0) + 1;

    const eventId = firstString(
      event.event_id,
      event.id,
      event.eventId,
      payload.event_id,
      payload.eventId,
    );

    if (!eventId) {
      inventory.events_missing_id += 1;
    }

    const listId = firstString(
      event.list_id,
      event.listId,
      payload.list_id,
      payload.listId,
      payload.list?.list_id,
      payload.list?.listId,
      payload.list?.id,
      payload.item?.list_id,
      payload.item?.listId,
      payload.task?.list_id,
      payload.task?.listId,
    );

    if (!listId) {
      inventory.events_missing_list_id += 1;
    }

    if (listId) {
      const existing = lists.get(listId) || {
        list_id: listId,
        title: '',
        normalized_title_key: '',
        status: 'unknown',
        first_event_time: firstString(
          event.event_time,
          event.created_at,
          event.createdAt,
          event.timestamp,
        ),
        last_event_time: '',
        event_count: 0,
        actions: {},
      };

      existing.event_count += 1;
      existing.actions[action] = (existing.actions[action] || 0) + 1;

      existing.last_event_time = firstString(
        event.event_time,
        event.created_at,
        event.createdAt,
        event.timestamp,
        existing.last_event_time,
      );

      const title = firstString(
        payload.title,
        payload.list_title,
        payload.listTitle,
        payload.list?.title,
        event.title,
      );

      if (title) {
        existing.title = title;
        existing.normalized_title_key = normalizeTitle(title);
      }

      const status = firstString(
        payload.status,
        payload.list?.status,
        event.status,
      );

      if (status === 'active' || action === 'list_created' || action === 'list.created') {
        existing.status = 'active';
      }

      if (status === 'archived' || action === 'list_archived' || action === 'list.archived') {
        existing.status = 'archived';
      }

      lists.set(listId, existing);
    }

    const task = payload.item || payload.task || payload;

    const taskId = firstString(
      task.item_id,
      task.task_id,
      task.itemId,
      task.taskId,
      task.id,
      payload.item_id,
      payload.task_id,
      payload.itemId,
      payload.taskId,
    );

    const taskTitle = firstString(
      task.title,
      payload.task_title,
      payload.taskTitle,
      payload.item_title,
      payload.itemTitle,
      payload.title,
    );

    const taskRelatedAction =
      action.includes('task') ||
      action.includes('item') ||
      taskId ||
      taskTitle;

    if (taskRelatedAction && (taskId || taskTitle)) {
      const key = taskId || `${listId || 'NO_LIST'}:${normalizeTitle(taskTitle)}`;

      const existingTask = tasks.get(key) || {
        task_id: taskId,
        list_id: listId,
        title: taskTitle,
        normalized_title_key: normalizeTitle(taskTitle),
        status: firstString(task.status, payload.status),
        first_event_id: eventId,
        last_event_id: eventId,
      };

      if (taskTitle) {
        existingTask.title = taskTitle;
        existingTask.normalized_title_key = normalizeTitle(taskTitle);
      }

      const status = firstString(
        task.status,
        payload.status,
        payload.new_status,
        payload.newStatus,
        payload.after?.status,
      );

      if (status) {
        existingTask.status = status;
      }

      if (listId) {
        existingTask.list_id = listId;
      }

      existingTask.last_event_id = eventId;
      tasks.set(key, existingTask);
    }

    const proofRelatedAction =
      action === 'task_proof_added' ||
      action === 'proof.added' ||
      action.includes('proof') ||
      Boolean(payload.proof || payload.proof_id || payload.proofId);

    if (proofRelatedAction) {
      const proofId = firstString(
        payload.proof_id,
        payload.proofId,
        payload.proof?.proof_id,
        payload.proof?.proofId,
        payload.proof?.id,
        eventId ? `legacy-proof-from-${eventId}` : '',
      );

      proofs.push({
        proof_id: proofId,
        task_id: taskId,
        list_id: listId,
        event_id: eventId,
        proof_type: firstString(
          payload.proof_type,
          payload.proofType,
          payload.proof?.proof_type,
          payload.proof?.proofType,
          'legacy_text',
        ),
      });
    }
  }

  inventory.lists = Array.from(lists.values()).sort((a, b) =>
    String(a.title || '').localeCompare(String(b.title || '')),
  );

  inventory.tasks = Array.from(tasks.values()).sort((a, b) =>
    String(a.title || '').localeCompare(String(b.title || '')),
  );

  inventory.proofs = proofs;

  const groups = new Map();

  for (const list of inventory.lists) {
    const titleKey = list.normalized_title_key || '(missing title)';
    const statusKey = list.status || 'unknown';
    const key = `${titleKey}::${statusKey}`;

    const group = groups.get(key) || [];
    group.push(list);
    groups.set(key, group);
  }

  inventory.duplicate_candidates = Array.from(groups.entries())
    .filter(([, group]) => group.length > 1)
    .map(([key, group]) => {
      const [normalized_title_key, status] = key.split('::');

      return {
        normalized_title_key,
        status,
        count: group.length,
        list_ids: group.map((g) => g.list_id),
        titles: group.map((g) => g.title),
      };
    });

  inventory.protected_lists = inventory.lists.filter(
    (list) =>
      normalizeTitle(list.title) === normalizeTitle('Vercel V2 History Test'),
  );

  inventory.protected_tasks = inventory.tasks.filter(
    (task) =>
      normalizeTitle(task.title) ===
      normalizeTitle('Confirm persistent history works without laptop'),
  );

  return inventory;
}

function renderReport({ status, reason, manifest, inventory, errors }) {
  const inv = inventory || emptyInventory();

  const duplicateRows = inv.duplicate_candidates.length
    ? inv.duplicate_candidates
        .map(
          (d) =>
            `| ${d.normalized_title_key} | ${d.status} | ${d.count} | ${d.list_ids.join(', ')} |`,
        )
        .join('\n')
    : '| None detected from available export | - | - | - |';

  const protectedListRows = inv.protected_lists.length
    ? inv.protected_lists
        .map(
          (l) =>
            `| ${l.list_id} | ${l.title || '(missing title)'} | ${l.status || 'unknown'} | ${l.event_count || 0} |`,
        )
        .join('\n')
    : '| Not verified | Vercel V2 History Test | - | - |';

  const protectedTaskRows = inv.protected_tasks.length
    ? inv.protected_tasks
        .map(
          (t) =>
            `| ${t.task_id || '(missing task id)'} | ${t.title || '(missing title)'} | ${t.status || 'unknown'} | ${t.list_id || ''} |`,
        )
        .join('\n')
    : '| Not verified | Confirm persistent history works without laptop | - | - |';

  const eventTypeRows =
    Object.entries(inv.event_type_counts)
      .sort((a, b) => b[1] - a[1])
      .map(([type, count]) => `| ${type} | ${count} |`)
      .join('\n') || '| None | 0 |';

  const blockerRows =
    status === 'OK'
      ? '| None from export utility itself | Review inventory before any migration write |'
      : `| Export not fully successful | ${reason} |`;

  const errorRows = errors.length
    ? errors
        .map(
          (e) =>
            `| ${e.pathname || e.url || '(unknown blob)'} | ${String(e.error || '').replace(/\n/g, ' ')} |`,
        )
        .join('\n')
    : '| None | - |';

  return `# PHASE_B_BLOB_INVENTORY_REPORT.md

**Project:** SharvaTask MCP V2.1 Production Room  
**Agent:** Backend State Agent + Deployment Owner  
**Artifact type:** Phase B read-only Blob inventory report  
**Status:** ${status}  
**Generated:** ${manifest.finished_at}  

## 1. Read-only guarantee

This utility only attempted to list/read Vercel Blob objects under the configured prefix and write local backup/report files.

It does not call \`put\`, \`del\`, \`copy\`, MCP mutation tools, deployment commands, active-pointer writes, or production update paths.

## 2. Export summary

| Field | Value |
|---|---|
| Script version | ${SCRIPT_VERSION} |
| Status | ${status} |
| Reason | ${reason || 'Completed'} |
| Prefix | ${manifest.prefix} |
| Blob count | ${manifest.blob_count} |
| Event count | ${manifest.event_count} |
| Export file | ${manifest.export_file} |
| Manifest file | ${manifest.manifest_file} |
| Report file | ${manifest.report_file} |
| Backup SHA-256 | ${manifest.sha256} |

## 3. Event type counts

| Event type | Count |
|---|---:|
${eventTypeRows}

## 4. List inventory summary

| Metric | Count |
|---|---:|
| Lists inferred | ${inv.lists.length} |
| Active lists inferred | ${inv.lists.filter((l) => l.status === 'active').length} |
| Archived lists inferred | ${inv.lists.filter((l) => l.status === 'archived').length} |
| Unknown-status lists inferred | ${inv.lists.filter((l) => !l.status || l.status === 'unknown').length} |

## 5. Task inventory summary

| Metric | Count |
|---|---:|
| Tasks inferred | ${inv.tasks.length} |

## 6. Proof inventory summary

| Metric | Count |
|---|---:|
| Proof records/events inferred | ${inv.proofs.length} |

## 7. Duplicate candidate report

| Normalized title | Status | Count | List IDs |
|---|---|---:|---|
${duplicateRows}

## 8. Protected list verification

| List ID | Title | Status | Event count |
|---|---|---|---:|
${protectedListRows}

## 9. Protected task verification

| Task ID | Title | Status | List ID |
|---|---|---|---|
${protectedTaskRows}

## 10. Stable ID report

| Entity | Inferred count | Missing/unknown IDs |
|---|---:|---:|
| Lists | ${inv.lists.length} | ${inv.lists.filter((l) => !l.list_id).length} |
| Tasks | ${inv.tasks.length} | ${inv.tasks.filter((t) => !t.task_id).length} |
| Proofs | ${inv.proofs.length} | ${inv.proofs.filter((p) => !p.proof_id).length} |
| Events | ${manifest.event_count} | ${inv.events_missing_id} |

## 11. Orphan/invalid event report

| Type | Count |
|---|---:|
| Read/parse errors | ${errors.length} |
| Events without event ID | ${inv.events_missing_id} |
| Events without list ID | ${inv.events_missing_list_id} |

## 12. Read/parse errors

| Blob | Error |
|---|---|
${errorRows}

## 13. Blockers before migration writes

| Blocker | Detail |
|---|---|
${blockerRows}

## 14. Decision

${
  status === 'OK'
    ? 'Read-only export completed. Migration writes remain blocked until Pablo Orchestrator accepts this inventory and the updated migration dry-run report.'
    : 'Read-only export did not fully complete. Phase B remains blocked until the export issue is reviewed and resolved.'
}

## 15. Handoff

Upload this report and the manifest JSON back to Pablo Orchestrator for Phase B review.
`;
}

async function writeArtifacts({
  status,
  reason,
  blobs = [],
  events = [],
  errors = [],
  inventory = null,
}) {
  const finishedAt = new Date().toISOString();

  const exportObject = {
    export_status: status,
    reason,
    started_at: startedAt,
    finished_at: finishedAt,
    prefix: PREFIX,
    allowed_prefix: ALLOWED_PREFIX,
    blob_count: blobs.length,
    event_count: events.length,
    blobs,
    events,
    errors,
    inventory,
  };

  const exportText = safeJson(exportObject);
  await writeFile(exportPath, exportText, 'utf8');

  const manifest = {
    manifest_version: '1.0',
    script_version: SCRIPT_VERSION,
    export_status: status,
    reason,
    started_at: startedAt,
    finished_at: finishedAt,
    prefix: PREFIX,
    allowed_prefix: ALLOWED_PREFIX,
    export_file: exportPath,
    manifest_file: manifestPath,
    report_file: reportPath,
    blob_count: blobs.length,
    event_count: events.length,
    event_type_counts: inventory?.event_type_counts || {},
    export_sha256: sha256(exportText),
    read_only_guarantee: {
      blob_writes_attempted: false,
      production_mutations_attempted: false,
      active_pointer_writes_attempted: false,
      deploy_attempted: false,
      imported_write_functions_by_name: false,
    },
    secret_handling: {
      token_env_present: Boolean(TOKEN),
      secret_values_stored: false,
      note: 'No secret value is written to this manifest, export, or report.',
    },
    operations_used: ['@vercel/blob list', '@vercel/blob get'],
    forbidden_operations_used: [],
  };

  const manifestText = safeJson(manifest);
  manifest.manifest_sha256 = sha256(manifestText);

  await writeFile(manifestPath, safeJson(manifest), 'utf8');

  const report = renderReport({
    status,
    reason,
    manifest,
    inventory,
    errors,
  });

  await writeFile(reportPath, report, 'utf8');

  console.log('');
  console.log(`Decision: ${status}`);
  console.log(`Reason:   ${reason}`);
  console.log(`Export:   ${exportPath}`);
  console.log(`Manifest: ${manifestPath}`);
  console.log(`Report:   ${reportPath}`);
  console.log('');
}

async function main() {
  await ensureDirs();

  if (PREFIX !== ALLOWED_PREFIX) {
    await writeArtifacts({
      status: 'BLOCKED',
      reason: `Refusing to read prefix "${PREFIX}". Allowed prefix is "${ALLOWED_PREFIX}".`,
    });
    process.exit(0);
  }

  if (
    !TOKEN ||
    TOKEN === 'Token' ||
    TOKEN === 'PASTE_TOKEN_HERE_ONLY_IN_POWERSHELL' ||
    TOKEN === 'PASTE_REAL_TOKEN_HERE_ONLY_IN_POWERSHELL'
  ) {
    await writeArtifacts({
      status: 'BLOCKED',
      reason:
        'Missing valid local Blob token environment variable. Expected BLOB_READ_WRITE_TOKEN, BLOB_READ_ONLY_TOKEN, or BLOB_TOKEN.',
    });
    process.exit(0);
  }

  let blobSdk;

  try {
    blobSdk = await import('@vercel/blob');
  } catch (error) {
    await writeArtifacts({
      status: 'BLOCKED',
      reason: `Missing dependency @vercel/blob: ${error.message}`,
    });
    process.exit(0);
  }

  const { list, get } = blobSdk;

  if (typeof list !== 'function') {
    await writeArtifacts({
      status: 'BLOCKED',
      reason: '@vercel/blob list() is unavailable in this environment.',
    });
    process.exit(0);
  }

  if (typeof get !== 'function') {
    await writeArtifacts({
      status: 'BLOCKED',
      reason: '@vercel/blob get() is unavailable in this installed @vercel/blob version.',
    });
    process.exit(0);
  }

  const blobs = [];
  const events = [];
  const errors = [];

  let cursor;

  do {
    const page = await list({
      prefix: PREFIX,
      limit: 1000,
      cursor,
      token: TOKEN,
    });

    const pageBlobs = page.blobs || [];

    blobs.push(
      ...pageBlobs.map((blob) => ({
        pathname: blob.pathname,
        url: blob.url,
        downloadUrl: blob.downloadUrl,
        size: blob.size,
        uploadedAt: blob.uploadedAt,
        etag: blob.etag,
      })),
    );

    cursor = page.cursor;

    if (!page.hasMore) {
      break;
    }
  } while (cursor);

  for (const blob of blobs) {
    try {
      const result = await get(blob.pathname, {
        token: TOKEN,
        access: 'private',
      });

      if (!result || result.statusCode !== 200) {
        throw new Error(`Blob get returned status ${result?.statusCode || 'null'}`);
      }

      const text = await streamToText(result.stream);
      const parsed = JSON.parse(text);

      events.push({
        ...parsed,
        __blob: {
          pathname: blob.pathname,
          size: blob.size,
          uploadedAt: blob.uploadedAt,
          etag: blob.etag,
        },
      });
    } catch (error) {
      errors.push({
        pathname: blob.pathname,
        url: blob.url,
        error: error.message,
      });
    }
  }

  events.sort((a, b) =>
    String(
      firstString(a.event_time, a.created_at, a.createdAt, a.timestamp),
    ).localeCompare(
      String(
        firstString(b.event_time, b.created_at, b.createdAt, b.timestamp),
      ),
    ),
  );

  const inventory = buildInventory(events);
  inventory.read_errors = errors.length;

  const status = errors.length ? 'PARTIAL' : 'OK';
  const reason = errors.length
    ? `${errors.length} blob(s) could not be read or parsed.`
    : 'Read-only export completed.';

  await writeArtifacts({
    status,
    reason,
    blobs,
    events,
    errors,
    inventory,
  });
}

main().catch(async (error) => {
  await ensureDirs();

  await writeArtifacts({
    status: 'BLOCKED',
    reason: error?.stack || error?.message || String(error),
  });

  process.exit(1);
});
