import { createEvent, newId, readAllEvents, writeEvent } from '../storage/blobEventStore';
import { materializeLists, summarizeList } from './materialize';
import type {
  ListSummary,
  Priority,
  SharvaTaskAmbiguityCandidate,
  SharvaTaskEvent,
  SharvaTaskItem,
  SharvaTaskList,
  SharvaTaskModeRecommendation,
  SharvaTaskWidgetOutput,
  TaskStatus
} from '../types';

function okText(title: string, body: string): string {
  return `${title}\n\n${body}`;
}

function listMessage(list: SharvaTaskList, heading = 'SharvaTask list'): string {
  const summary = summarizeList(list);
  return [
    `${heading} ✅`,
    `Title: ${list.title}`,
    `Project: ${list.project}`,
    `Status: ${list.status}`,
    `Tasks: ${summary.pending_count} pending | ${summary.blocked_count} blocked | ${summary.done_count} done | ${summary.total_count} total`,
    `List ID: ${list.list_id}`
  ].join('\n');
}

function formatList(list: SharvaTaskList): string {
  const summary = summarizeList(list);
  const lines = [
    `List: ${list.title}`,
    `ID: ${list.list_id}`,
    `Project: ${list.project}`,
    `Status: ${list.status}`,
    `Updated: ${list.updated_at}`,
    `Tasks: ${summary.total_count} total | ${summary.pending_count} pending/in-progress | ${summary.blocked_count} blocked | ${summary.done_count} done/verified`,
    '',
    'Items:'
  ];

  if (list.items.length === 0) {
    lines.push('- No tasks yet.');
  } else {
    for (const item of list.items) {
      const proofSuffix = item.proof.length ? ` | proof: ${item.proof.length}` : '';
      lines.push(`- [${item.status}] ${item.item_id}: ${item.title} (${item.priority})${proofSuffix}`);
      if (item.notes) lines.push(`  Notes: ${item.notes}`);
    }
  }

  return lines.join('\n');
}

function formatSummaries(summaries: ListSummary[]): string {
  if (summaries.length === 0) return 'No lists found.';
  return summaries
    .map(
      (list, index) =>
        `${index + 1}. ${list.title} — ${list.project} — ${list.status} — ${list.pending_count} pending — ${list.done_count} done — ${list.list_id}`
    )
    .join('\n');
}

async function getLists(): Promise<{ events: SharvaTaskEvent[]; lists: SharvaTaskList[] }> {
  const events = await readAllEvents();
  return { events, lists: materializeLists(events) };
}

function normalizeTitle(value: string | undefined): string {
  return String(value || '')
    .trim()
    .toLowerCase()
    .normalize('NFKC')
    .replace(/\s+/g, ' ');
}

function listCandidate(list: SharvaTaskList, reason: string): SharvaTaskAmbiguityCandidate {
  return {
    kind: 'list',
    list_id: list.list_id,
    title: list.title,
    project: list.project,
    status: list.status,
    reason
  };
}

function taskCandidate(list: SharvaTaskList, task: SharvaTaskItem, reason: string): SharvaTaskAmbiguityCandidate {
  return {
    kind: 'task',
    list_id: list.list_id,
    item_id: task.item_id,
    title: task.title,
    status: task.status,
    reason
  };
}

function activePointer(lists: SharvaTaskList[], selected?: SharvaTaskList): Record<string, unknown> {
  const active = selected?.status === 'active' ? selected : lists.find((list) => list.status === 'active');
  return {
    active_list_id: active?.list_id || null,
    active_list_title_snapshot: active?.title || null,
    set_reason: active ? 'resolved_from_current_state' : 'none',
    state_version_source: 'event_count'
  };
}

function boardSnapshot(
  list: SharvaTaskList | undefined,
  lists: SharvaTaskList[],
  events: SharvaTaskEvent[],
  mode: SharvaTaskModeRecommendation
): Record<string, unknown> {
  const relatedEvents = list ? events.filter((event) => event.list_id === list.list_id) : [];
  return {
    response_type: 'board_snapshot',
    server_time: new Date().toISOString(),
    state_version: events.length,
    active_pointer: activePointer(lists, list),
    mode_recommendation: mode,
    sync_status: 'fresh',
    board: list
      ? {
          list,
          tasks: list.items,
          counts: summarizeList(list),
          proofs_by_task: Object.fromEntries(list.items.map((item) => [item.item_id, item.proof])),
          recent_events: relatedEvents.slice(-8),
          permissions: {
            can_add_task: list.status === 'active',
            can_update_status: list.status === 'active',
            can_add_proof: list.status === 'active',
            can_archive: list.status === 'active'
          },
          archive_state: { status: list.status },
          snapshot_created_at: new Date().toISOString(),
          state_version: events.length
        }
      : undefined,
    lists: lists.map(summarizeList)
  };
}

function withEnvelope(
  base: Omit<SharvaTaskWidgetOutput, 'response_type' | 'success' | 'server_time' | 'state_version' | 'mode_recommendation' | 'sync_status'>,
  context: {
    events: SharvaTaskEvent[];
    lists: SharvaTaskList[];
    response_type: NonNullable<SharvaTaskWidgetOutput['response_type']>;
    success?: boolean;
    action?: string;
    mode_recommendation: SharvaTaskModeRecommendation;
    sync_status?: NonNullable<SharvaTaskWidgetOutput['sync_status']>;
    error_code?: NonNullable<SharvaTaskWidgetOutput['error_code']>;
    candidates?: SharvaTaskAmbiguityCandidate[];
    affected?: Record<string, unknown>;
    event?: SharvaTaskEvent;
    recovery_actions?: string[];
  }
): SharvaTaskWidgetOutput {
  const ambiguity = context.error_code && context.candidates
    ? {
        error_code: context.error_code,
        message: base.message,
        candidates: context.candidates
      }
    : undefined;

  return {
    ...base,
    response_type: context.response_type,
    success: context.success ?? !context.error_code,
    action: context.action,
    server_time: new Date().toISOString(),
    state_version: context.events.length,
    state_version_after: context.events.length,
    mode_recommendation: context.mode_recommendation,
    sync_status: context.sync_status || (context.error_code ? 'error' : 'fresh'),
    error_code: context.error_code,
    recovery_actions: context.recovery_actions || (context.error_code ? ['choose_candidate', 'refresh_board_state'] : undefined),
    affected: context.affected,
    active_pointer: activePointer(context.lists, base.list),
    board_snapshot: boardSnapshot(base.list, context.lists, context.events, context.mode_recommendation),
    ambiguity,
    duplicate: context.error_code === 'DUPLICATE_LIST_CANDIDATE' ? ambiguity : undefined,
    event: context.event
  };
}

function resolveList(
  lists: SharvaTaskList[],
  listIdOrQuery?: string,
  options: { includeArchived?: boolean } = {}
): { list?: SharvaTaskList; error_code?: 'LIST_NOT_FOUND' | 'LIST_AMBIGUOUS'; candidates?: SharvaTaskAmbiguityCandidate[] } {
  if (!listIdOrQuery) {
    const active = lists.find((list) => list.status === 'active');
    return { list: active || lists[0] };
  }

  const needle = normalizeTitle(listIdOrQuery);
  const exactId = lists.find((list) => list.list_id.toLowerCase() === needle);
  if (exactId) return { list: exactId };

  const scope = options.includeArchived ? lists : lists.filter((list) => list.status === 'active');
  const exactTitle = scope.filter((list) => normalizeTitle(list.title) === needle || normalizeTitle(list.project) === needle);
  if (exactTitle.length === 1) return { list: exactTitle[0] };
  if (exactTitle.length > 1) {
    return { error_code: 'LIST_AMBIGUOUS', candidates: exactTitle.map((list) => listCandidate(list, 'exact_normalized_match')) };
  }

  const fuzzy = scope.filter(
    (list) => normalizeTitle(list.title).includes(needle) || normalizeTitle(list.project).includes(needle)
  );
  if (fuzzy.length === 1) return { list: fuzzy[0] };
  if (fuzzy.length > 1) {
    return { error_code: 'LIST_AMBIGUOUS', candidates: fuzzy.map((list) => listCandidate(list, 'fuzzy_match')) };
  }

  return { error_code: 'LIST_NOT_FOUND', candidates: [] };
}

function resolveTask(
  list: SharvaTaskList,
  itemIdOrTitle: string
): { task?: SharvaTaskItem; error_code?: 'TASK_NOT_FOUND' | 'TASK_AMBIGUOUS'; candidates?: SharvaTaskAmbiguityCandidate[] } {
  const needle = normalizeTitle(itemIdOrTitle);
  const exactId = list.items.find((item) => item.item_id.toLowerCase() === needle);
  if (exactId) return { task: exactId };

  const exactTitle = list.items.filter((item) => normalizeTitle(item.title) === needle);
  if (exactTitle.length === 1) return { task: exactTitle[0] };
  if (exactTitle.length > 1) {
    return { error_code: 'TASK_AMBIGUOUS', candidates: exactTitle.map((task) => taskCandidate(list, task, 'exact_normalized_match')) };
  }

  const fuzzy = list.items.filter((item) => normalizeTitle(item.title).includes(needle));
  if (fuzzy.length === 1) return { task: fuzzy[0] };
  if (fuzzy.length > 1) {
    return { error_code: 'TASK_AMBIGUOUS', candidates: fuzzy.map((task) => taskCandidate(list, task, 'fuzzy_match')) };
  }

  return { error_code: 'TASK_NOT_FOUND', candidates: [] };
}

function duplicateListCandidates(lists: SharvaTaskList[], title: string, project?: string): SharvaTaskList[] {
  const titleKey = normalizeTitle(title);
  const projectKey = normalizeTitle(project || 'General');
  return lists.filter(
    (list) =>
      list.status === 'active' &&
      normalizeTitle(list.title) === titleKey &&
      normalizeTitle(list.project || 'General') === projectKey
  );
}

function summariesForCandidates(lists: SharvaTaskList[], candidates: SharvaTaskAmbiguityCandidate[] = []): ListSummary[] {
  return candidates
    .map((candidate) => lists.find((list) => list.list_id === candidate.list_id))
    .filter((list): list is SharvaTaskList => Boolean(list))
    .map(summarizeList);
}

export async function openTaskBoardData(args: {
  initial_mode?: SharvaTaskModeRecommendation;
  list_id?: string;
  list_query?: string;
  task_id?: string;
  search_query?: string;
  include_archived?: boolean;
  restore_strategy?: string;
}): Promise<SharvaTaskWidgetOutput> {
  const { events, lists } = await getLists();
  const initialMode = args.initial_mode || 'board';

  if (initialMode === 'list_browser') return browseListsData({ status: args.include_archived ? 'all' : 'active' });
  if (initialMode === 'search' && args.search_query) return searchBoardData({ query: args.search_query });

  const query = args.list_id || args.list_query;
  const resolved = resolveList(lists, query, { includeArchived: args.include_archived });

  if (resolved.error_code === 'LIST_AMBIGUOUS') {
    return withEnvelope(
      {
        view: 'lists',
        message: 'Multiple matching lists found. Choose one to continue.',
        lists: summariesForCandidates(lists, resolved.candidates)
      },
      {
        events,
        lists,
        response_type: 'ambiguity',
        error_code: 'LIST_AMBIGUOUS',
        candidates: resolved.candidates,
        mode_recommendation: 'ambiguity_resolution'
      }
    );
  }

  if (!resolved.list && lists.length === 0) {
    return withEnvelope(
      { view: 'message', message: 'No SharvaTask lists found yet.' },
      { events, lists, response_type: 'board_snapshot', mode_recommendation: 'empty_onboarding' }
    );
  }

  if (!resolved.list) {
    return withEnvelope(
      { view: 'lists', message: 'No matching list found. Showing available active lists.', lists: lists.filter((list) => list.status === 'active').map(summarizeList) },
      { events, lists, response_type: 'error', error_code: 'LIST_NOT_FOUND', candidates: [], mode_recommendation: 'list_browser' }
    );
  }

  if (initialMode === 'history') return getHistoryData({ list_id_or_query: resolved.list.list_id });

  return withEnvelope(
    { view: 'list', message: `Opened SharvaTask board: ${resolved.list.title}`, list: resolved.list },
    { events, lists, response_type: 'board_snapshot', mode_recommendation: 'board' }
  );
}

export async function createSharvaListData(args: { title: string; project?: string }): Promise<SharvaTaskWidgetOutput> {
  const before = await getLists();
  const duplicates = duplicateListCandidates(before.lists, args.title, args.project);
  if (duplicates.length > 0) {
    const candidates = duplicates.map((list) => listCandidate(list, 'duplicate_active_title_project'));
    return withEnvelope(
      {
        view: 'lists',
        message: 'A matching active list already exists. Choose the existing list or revise the title.',
        lists: duplicates.map(summarizeList)
      },
      {
        events: before.events,
        lists: before.lists,
        response_type: 'ambiguity',
        error_code: 'DUPLICATE_LIST_CANDIDATE',
        candidates,
        mode_recommendation: 'ambiguity_resolution'
      }
    );
  }

  const listId = newId('LIST');
  const event = createEvent('list_created', listId, {
    title: args.title,
    project: args.project || 'General'
  });
  await writeEvent(event);

  const { events, lists } = await getLists();
  const list = resolveList(lists, listId).list;
  return withEnvelope(
    {
      view: 'list',
      message: `Created SharvaTask list: ${args.title}`,
      list
    },
    {
      events,
      lists,
      response_type: 'mutation_result',
      action: 'list.created',
      mode_recommendation: 'board',
      affected: { list_id: listId },
      event
    }
  );
}

export async function addSharvaTaskData(args: {
  list_id_or_query?: string;
  title: string;
  notes?: string;
  priority?: Priority;
}): Promise<SharvaTaskWidgetOutput> {
  const before = await getLists();
  const resolved = resolveList(before.lists, args.list_id_or_query);
  if (resolved.error_code === 'LIST_AMBIGUOUS') {
    return withEnvelope(
      { view: 'lists', message: 'Multiple matching lists found. Choose a list before adding a task.', lists: summariesForCandidates(before.lists, resolved.candidates) },
      { events: before.events, lists: before.lists, response_type: 'ambiguity', error_code: 'LIST_AMBIGUOUS', candidates: resolved.candidates, mode_recommendation: 'ambiguity_resolution' }
    );
  }
  if (!resolved.list) return withEnvelope({ view: 'message', message: 'No matching list found. Create a list first.' }, { events: before.events, lists: before.lists, response_type: 'error', error_code: 'LIST_NOT_FOUND', candidates: [], mode_recommendation: 'error_recovery' });
  if (resolved.list.status === 'archived') return withEnvelope({ view: 'list', message: `List is archived: ${resolved.list.title}`, list: resolved.list }, { events: before.events, lists: before.lists, response_type: 'error', error_code: 'ARCHIVED_LIST', mode_recommendation: 'archive_recovery' });

  const itemId = newId('TASK');
  const event = createEvent('task_added', resolved.list.list_id, {
    item_id: itemId,
    task_id: itemId,
    title: args.title,
    notes: args.notes || '',
    priority: args.priority || 'P1'
  });
  await writeEvent(event);

  const { events, lists } = await getLists();
  const updatedList = resolveList(lists, resolved.list.list_id).list;
  return withEnvelope(
    { view: 'list', message: `Added task: ${args.title}`, list: updatedList },
    { events, lists, response_type: 'mutation_result', action: 'task.created', mode_recommendation: 'board', affected: { list_id: resolved.list.list_id, task_id: itemId }, event }
  );
}

export async function updateSharvaTaskStatusData(args: {
  list_id_or_query?: string;
  item_id_or_title: string;
  status: TaskStatus;
  notes?: string;
}): Promise<SharvaTaskWidgetOutput> {
  const before = await getLists();
  const resolved = resolveList(before.lists, args.list_id_or_query);
  if (resolved.error_code === 'LIST_AMBIGUOUS') return withEnvelope({ view: 'lists', message: 'Multiple matching lists found. Choose a list before updating task status.', lists: summariesForCandidates(before.lists, resolved.candidates) }, { events: before.events, lists: before.lists, response_type: 'ambiguity', error_code: 'LIST_AMBIGUOUS', candidates: resolved.candidates, mode_recommendation: 'ambiguity_resolution' });
  if (!resolved.list) return withEnvelope({ view: 'message', message: 'No matching list found.' }, { events: before.events, lists: before.lists, response_type: 'error', error_code: 'LIST_NOT_FOUND', candidates: [], mode_recommendation: 'error_recovery' });

  const task = resolveTask(resolved.list, args.item_id_or_title);
  if (task.error_code === 'TASK_AMBIGUOUS') return withEnvelope({ view: 'list', message: 'Multiple matching tasks found. Choose a task before updating status.', list: resolved.list }, { events: before.events, lists: before.lists, response_type: 'ambiguity', error_code: 'TASK_AMBIGUOUS', candidates: task.candidates, mode_recommendation: 'ambiguity_resolution' });
  if (!task.task) return withEnvelope({ view: 'list', message: `No matching task found in list: ${resolved.list.title}`, list: resolved.list }, { events: before.events, lists: before.lists, response_type: 'error', error_code: 'TASK_NOT_FOUND', candidates: [], mode_recommendation: 'error_recovery' });

  const event = createEvent('task_status_updated', resolved.list.list_id, {
    item_id: task.task.item_id,
    task_id: task.task.item_id,
    status: args.status,
    notes: args.notes || task.task.notes || ''
  });
  await writeEvent(event);

  const { events, lists } = await getLists();
  const updatedList = resolveList(lists, resolved.list.list_id).list;
  return withEnvelope(
    { view: 'list', message: `Updated task status: ${task.task.title} → ${args.status}`, list: updatedList },
    { events, lists, response_type: 'mutation_result', action: 'task.status_changed', mode_recommendation: 'board', affected: { list_id: resolved.list.list_id, task_id: task.task.item_id, status: args.status }, event }
  );
}

export async function updateSharvaTaskData(args: {
  list_id_or_query?: string;
  item_id_or_title: string;
  title?: string;
  notes?: string;
  priority?: Priority;
}): Promise<SharvaTaskWidgetOutput> {
  const before = await getLists();
  const resolved = resolveList(before.lists, args.list_id_or_query);
  if (!resolved.list) return withEnvelope({ view: 'message', message: 'No matching list found.' }, { events: before.events, lists: before.lists, response_type: 'error', error_code: resolved.error_code || 'LIST_NOT_FOUND', candidates: resolved.candidates, mode_recommendation: 'error_recovery' });
  if (resolved.list.status === 'archived') return withEnvelope({ view: 'list', message: `List is archived: ${resolved.list.title}`, list: resolved.list }, { events: before.events, lists: before.lists, response_type: 'error', error_code: 'ARCHIVED_LIST', mode_recommendation: 'archive_recovery' });

  const task = resolveTask(resolved.list, args.item_id_or_title);
  if (task.error_code === 'TASK_AMBIGUOUS') return withEnvelope({ view: 'list', message: 'Multiple matching tasks found. Choose a task before editing.', list: resolved.list }, { events: before.events, lists: before.lists, response_type: 'ambiguity', error_code: 'TASK_AMBIGUOUS', candidates: task.candidates, mode_recommendation: 'ambiguity_resolution' });
  if (!task.task) return withEnvelope({ view: 'list', message: `No matching task found in list: ${resolved.list.title}`, list: resolved.list }, { events: before.events, lists: before.lists, response_type: 'error', error_code: 'TASK_NOT_FOUND', candidates: [], mode_recommendation: 'error_recovery' });

  const event = createEvent('task_updated', resolved.list.list_id, {
    item_id: task.task.item_id,
    task_id: task.task.item_id,
    title: args.title || task.task.title,
    notes: typeof args.notes === 'string' ? args.notes : task.task.notes || '',
    priority: args.priority || task.task.priority
  });
  await writeEvent(event);

  const { events, lists } = await getLists();
  const updatedList = resolveList(lists, resolved.list.list_id).list;
  return withEnvelope(
    { view: 'list', message: `Updated task: ${args.title || task.task.title}`, list: updatedList },
    { events, lists, response_type: 'mutation_result', action: 'task.updated', mode_recommendation: 'board', affected: { list_id: resolved.list.list_id, task_id: task.task.item_id }, event }
  );
}

export async function addProofData(args: {
  list_id_or_query?: string;
  item_id_or_title: string;
  proof: string;
}): Promise<SharvaTaskWidgetOutput> {
  const before = await getLists();
  const resolved = resolveList(before.lists, args.list_id_or_query);
  if (!resolved.list) return withEnvelope({ view: 'message', message: 'No matching list found.' }, { events: before.events, lists: before.lists, response_type: 'error', error_code: resolved.error_code || 'LIST_NOT_FOUND', candidates: resolved.candidates, mode_recommendation: 'error_recovery' });

  const task = resolveTask(resolved.list, args.item_id_or_title);
  if (task.error_code === 'TASK_AMBIGUOUS') return withEnvelope({ view: 'list', message: 'Multiple matching tasks found. Choose a task before saving proof.', list: resolved.list }, { events: before.events, lists: before.lists, response_type: 'ambiguity', error_code: 'TASK_AMBIGUOUS', candidates: task.candidates, mode_recommendation: 'ambiguity_resolution' });
  if (!task.task) return withEnvelope({ view: 'list', message: `No matching task found in list: ${resolved.list.title}`, list: resolved.list }, { events: before.events, lists: before.lists, response_type: 'error', error_code: 'TASK_NOT_FOUND', candidates: [], mode_recommendation: 'error_recovery' });

  const proofId = newId('PROOF');
  const event = createEvent('task_proof_added', resolved.list.list_id, {
    item_id: task.task.item_id,
    task_id: task.task.item_id,
    proof_id: proofId,
    proof: args.proof,
    proof_type: args.proof.startsWith('http') ? 'link' : 'text'
  });
  await writeEvent(event);

  const { events, lists } = await getLists();
  const updatedList = resolveList(lists, resolved.list.list_id).list;
  return withEnvelope(
    { view: 'list', message: `Added proof to: ${task.task.title}`, list: updatedList },
    { events, lists, response_type: 'mutation_result', action: 'proof.added', mode_recommendation: 'proof_detail', affected: { list_id: resolved.list.list_id, task_id: task.task.item_id, proof_id: proofId }, event }
  );
}

export async function getBoardSnapshotData(args: { list_id_or_query?: string; include_archived?: boolean }): Promise<SharvaTaskWidgetOutput> {
  const { events, lists } = await getLists();
  const resolved = resolveList(lists, args.list_id_or_query, { includeArchived: args.include_archived });
  if (resolved.error_code === 'LIST_AMBIGUOUS') return withEnvelope({ view: 'lists', message: 'Multiple matching lists found.', lists: summariesForCandidates(lists, resolved.candidates) }, { events, lists, response_type: 'ambiguity', error_code: 'LIST_AMBIGUOUS', candidates: resolved.candidates, mode_recommendation: 'ambiguity_resolution' });
  if (!resolved.list) return withEnvelope({ view: 'message', message: 'No matching list found.' }, { events, lists, response_type: 'error', error_code: 'LIST_NOT_FOUND', candidates: [], mode_recommendation: 'error_recovery' });
  return withEnvelope({ view: 'list', message: `Board snapshot ready: ${resolved.list.title}`, list: resolved.list }, { events, lists, response_type: 'board_snapshot', mode_recommendation: 'board' });
}

export async function showSharvaListData(args: { list_id_or_query?: string }): Promise<SharvaTaskWidgetOutput> {
  return getBoardSnapshotData(args);
}

export async function browseListsData(args: {
  project?: string;
  status?: 'active' | 'archived' | 'all';
}): Promise<SharvaTaskWidgetOutput> {
  const { events, lists } = await getLists();
  const projectNeedle = args.project?.toLowerCase();
  const status = args.status || 'active';

  const summaries = lists
    .filter((list) => (status === 'all' ? true : list.status === status))
    .filter((list) => (projectNeedle ? list.project.toLowerCase().includes(projectNeedle) : true))
    .map(summarizeList);

  return withEnvelope(
    {
      view: 'lists',
      message: summaries.length ? `Showing ${summaries.length} SharvaTask list(s).` : 'No lists found.',
      lists: summaries
    },
    { events, lists, response_type: 'list_browser', mode_recommendation: 'list_browser' }
  );
}

export async function listAllSharvaListsData(args: {
  project?: string;
  status?: 'active' | 'archived' | 'all';
}): Promise<SharvaTaskWidgetOutput> {
  return browseListsData(args);
}

export async function searchBoardData(args: { query: string }): Promise<SharvaTaskWidgetOutput> {
  const { events, lists } = await getLists();
  const needle = args.query.toLowerCase();
  const summaries = lists
    .filter((list) => {
      return (
        list.title.toLowerCase().includes(needle) ||
        list.project.toLowerCase().includes(needle) ||
        list.list_id.toLowerCase().includes(needle) ||
        list.items.some((item) => item.title.toLowerCase().includes(needle) || item.notes?.toLowerCase().includes(needle))
      );
    })
    .map(summarizeList);

  return withEnvelope(
    {
      view: 'lists',
      message: summaries.length ? `Found ${summaries.length} list(s) for: ${args.query}` : `No lists found for: ${args.query}`,
      lists: summaries,
      query: args.query
    },
    { events, lists, response_type: 'search_results', mode_recommendation: 'search' }
  );
}

export async function searchSharvaListsData(args: { query: string }): Promise<SharvaTaskWidgetOutput> {
  return searchBoardData(args);
}

export async function continueSharvaListData(args: { project_or_query?: string }): Promise<SharvaTaskWidgetOutput> {
  const { events, lists } = await getLists();
  const resolved = resolveList(lists.filter((candidate) => candidate.status === 'active'), args.project_or_query);
  if (resolved.error_code === 'LIST_AMBIGUOUS') return withEnvelope({ view: 'lists', message: 'Multiple active lists match. Choose one to continue.', lists: summariesForCandidates(lists, resolved.candidates) }, { events, lists, response_type: 'ambiguity', error_code: 'LIST_AMBIGUOUS', candidates: resolved.candidates, mode_recommendation: 'ambiguity_resolution' });
  return resolved.list
    ? withEnvelope({ view: 'list', message: `Continuing active list: ${resolved.list.title}`, list: resolved.list }, { events, lists, response_type: 'board_snapshot', mode_recommendation: 'board' })
    : withEnvelope({ view: 'message', message: 'No active list found to continue.' }, { events, lists, response_type: 'error', error_code: 'LIST_NOT_FOUND', candidates: [], mode_recommendation: 'list_browser' });
}

export async function getHistoryData(args: { list_id_or_query?: string }): Promise<SharvaTaskWidgetOutput> {
  const { events, lists } = await getLists();
  const resolved = resolveList(lists, args.list_id_or_query);
  if (!resolved.list) return withEnvelope({ view: 'message', message: 'No matching list found.' }, { events, lists, response_type: 'error', error_code: resolved.error_code || 'LIST_NOT_FOUND', candidates: resolved.candidates, mode_recommendation: 'error_recovery' });

  const matchingEvents = events.filter((event) => event.list_id === resolved.list!.list_id);
  return withEnvelope(
    {
      view: 'history',
      message: `Showing history for: ${resolved.list.title}`,
      list: resolved.list,
      events: matchingEvents
    },
    { events, lists, response_type: 'history', mode_recommendation: 'history' }
  );
}

export async function showHistoryData(args: { list_id_or_query?: string }): Promise<SharvaTaskWidgetOutput> {
  return getHistoryData(args);
}

export async function getTaskDetailData(args: { list_id_or_query?: string; item_id_or_title: string }): Promise<SharvaTaskWidgetOutput> {
  const before = await getLists();
  const resolved = resolveList(before.lists, args.list_id_or_query);
  if (!resolved.list) return withEnvelope({ view: 'message', message: 'No matching list found.' }, { events: before.events, lists: before.lists, response_type: 'error', error_code: resolved.error_code || 'LIST_NOT_FOUND', candidates: resolved.candidates, mode_recommendation: 'error_recovery' });
  const task = resolveTask(resolved.list, args.item_id_or_title);
  if (task.error_code === 'TASK_AMBIGUOUS') return withEnvelope({ view: 'list', message: 'Multiple matching tasks found. Choose a task.', list: resolved.list }, { events: before.events, lists: before.lists, response_type: 'ambiguity', error_code: 'TASK_AMBIGUOUS', candidates: task.candidates, mode_recommendation: 'ambiguity_resolution' });
  if (!task.task) return withEnvelope({ view: 'list', message: `No matching task found in list: ${resolved.list.title}`, list: resolved.list }, { events: before.events, lists: before.lists, response_type: 'error', error_code: 'TASK_NOT_FOUND', candidates: [], mode_recommendation: 'error_recovery' });
  return withEnvelope({ view: 'list', message: `Task detail ready: ${task.task.title}`, list: resolved.list, task: task.task }, { events: before.events, lists: before.lists, response_type: 'task_detail', mode_recommendation: 'task_detail', affected: { list_id: resolved.list.list_id, task_id: task.task.item_id } });
}

export async function refreshBoardStateData(args: { list_id_or_query?: string }): Promise<SharvaTaskWidgetOutput> {
  return getBoardSnapshotData(args);
}

export async function archiveSharvaListData(args: {
  list_id_or_query: string;
  reason?: string;
}): Promise<SharvaTaskWidgetOutput> {
  const before = await getLists();
  const resolved = resolveList(before.lists, args.list_id_or_query, { includeArchived: true });
  if (!resolved.list) return withEnvelope({ view: 'message', message: 'No matching list found.' }, { events: before.events, lists: before.lists, response_type: 'error', error_code: resolved.error_code || 'LIST_NOT_FOUND', candidates: resolved.candidates, mode_recommendation: 'error_recovery' });
  if (resolved.list.status === 'archived') return withEnvelope({ view: 'list', message: `Already archived: ${resolved.list.title}`, list: resolved.list }, { events: before.events, lists: before.lists, response_type: 'mutation_result', action: 'list.archived.noop', mode_recommendation: 'archive_recovery', affected: { list_id: resolved.list.list_id } });

  const event = createEvent('list_archived', resolved.list.list_id, {
    reason: args.reason || 'Archived from MCP tool'
  });
  await writeEvent(event);

  const { events, lists } = await getLists();
  const updatedList = resolveList(lists, resolved.list.list_id, { includeArchived: true }).list;
  return withEnvelope(
    { view: 'list', message: `Archived list: ${resolved.list.title}`, list: updatedList },
    { events, lists, response_type: 'mutation_result', action: 'list.archived', mode_recommendation: 'archive_recovery', affected: { list_id: resolved.list.list_id }, event }
  );
}

// Text wrappers retained so older connector behavior remains readable if a client ignores structuredContent/widgets.
export async function createSharvaList(args: { title: string; project?: string }): Promise<string> {
  const result = await createSharvaListData(args);
  return result.list ? listMessage(result.list, 'Created SharvaTask list') : result.message;
}

export async function addSharvaTask(args: { list_id_or_query?: string; title: string; notes?: string; priority?: Priority }): Promise<string> {
  const result = await addSharvaTaskData(args);
  return result.list ? okText('Task added ✅', `List: ${result.list.title}\nTask: ${args.title}`) : result.message;
}

export async function updateSharvaTaskStatus(args: {
  list_id_or_query?: string;
  item_id_or_title: string;
  status: TaskStatus;
  notes?: string;
}): Promise<string> {
  const result = await updateSharvaTaskStatusData(args);
  return result.list ? okText('Task status updated ✅', `List: ${result.list.title}\nNew status: ${args.status}`) : result.message;
}

export async function updateSharvaTask(args: {
  list_id_or_query?: string;
  item_id_or_title: string;
  title?: string;
  notes?: string;
  priority?: Priority;
}): Promise<string> {
  const result = await updateSharvaTaskData(args);
  return result.list ? okText('Task updated ✅', `List: ${result.list.title}\nTask: ${args.title || args.item_id_or_title}`) : result.message;
}

export async function addProof(args: { list_id_or_query?: string; item_id_or_title: string; proof: string }): Promise<string> {
  const result = await addProofData(args);
  return result.list ? okText('Proof added ✅', `List: ${result.list.title}\nProof: ${args.proof}`) : result.message;
}

export async function showSharvaList(args: { list_id_or_query?: string }): Promise<string> {
  const result = await showSharvaListData(args);
  return result.list ? formatList(result.list) : result.message;
}

export async function listAllSharvaLists(args: { project?: string; status?: 'active' | 'archived' | 'all' }): Promise<string> {
  const result = await listAllSharvaListsData(args);
  return okText('SharvaTask lists', formatSummaries(result.lists || []));
}

export async function searchSharvaLists(args: { query: string }): Promise<string> {
  const result = await searchSharvaListsData(args);
  return okText(`Search results for: ${args.query}`, formatSummaries(result.lists || []));
}

export async function continueSharvaList(args: { project_or_query?: string }): Promise<string> {
  const result = await continueSharvaListData(args);
  return result.list ? okText('Continuing last matching active list 🔁', formatList(result.list)) : result.message;
}

export async function showHistory(args: { list_id_or_query?: string }): Promise<string> {
  const result = await showHistoryData(args);
  if (!result.list) return result.message;
  const lines = (result.events || []).map((event) => {
    const payload = event.payload || {};
    const title = typeof payload.title === 'string' ? payload.title : typeof payload.item_id === 'string' ? payload.item_id : '';
    return `${event.event_time} — ${event.action.replaceAll('_', ' ')}${title ? ` — ${title}` : ''}`;
  });
  return okText(`History for ${result.list.title}`, lines.length ? lines.join('\n') : 'No history found.');
}

export async function archiveSharvaList(args: { list_id_or_query: string; reason?: string }): Promise<string> {
  const result = await archiveSharvaListData(args);
  return result.list ? okText('List archived ✅', `List: ${result.list.title}\nReason: ${args.reason || 'Archived from MCP tool'}`) : result.message;
}
