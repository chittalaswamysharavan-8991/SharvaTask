import { createEvent, readAllEvents, writeEvent } from '../storage/blobEventStore';
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

export interface EditTaskDetailsArgs {
  list_id_or_query?: string;
  item_id_or_title: string;
  title?: string;
  notes?: string;
  next_action?: string;
  pablo_instruction?: string;
  priority?: Priority;
  status?: TaskStatus;
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

function summariesForCandidates(lists: SharvaTaskList[], candidates: SharvaTaskAmbiguityCandidate[] = []): ListSummary[] {
  return candidates
    .map((candidate) => lists.find((list) => list.list_id === candidate.list_id))
    .filter((list): list is SharvaTaskList => Boolean(list))
    .map(summarizeList);
}

function resolveList(
  lists: SharvaTaskList[],
  listIdOrQuery?: string
): { list?: SharvaTaskList; error_code?: 'LIST_NOT_FOUND' | 'LIST_AMBIGUOUS'; candidates?: SharvaTaskAmbiguityCandidate[] } {
  if (!listIdOrQuery) {
    const active = lists.find((list) => list.status === 'active');
    return { list: active || lists[0] };
  }

  const needle = normalizeTitle(listIdOrQuery);
  const exactId = lists.find((list) => list.list_id.toLowerCase() === needle);
  if (exactId) return { list: exactId };

  const scope = lists.filter((list) => list.status === 'active');
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

function providedEditableFields(args: EditTaskDetailsArgs): Array<keyof Pick<EditTaskDetailsArgs, 'title' | 'notes' | 'next_action' | 'pablo_instruction' | 'priority' | 'status'>> {
  const fields: Array<keyof Pick<EditTaskDetailsArgs, 'title' | 'notes' | 'next_action' | 'pablo_instruction' | 'priority' | 'status'>> = [
    'title',
    'notes',
    'next_action',
    'pablo_instruction',
    'priority',
    'status'
  ];
  return fields.filter((field) => typeof args[field] !== 'undefined');
}

export async function editTaskDetailsData(args: EditTaskDetailsArgs): Promise<SharvaTaskWidgetOutput> {
  const before = await getLists();
  const changedFields = providedEditableFields(args);

  if (!args.item_id_or_title || !args.item_id_or_title.trim()) {
    return withEnvelope(
      { view: 'message', message: 'Task ID or title is required.' },
      {
        events: before.events,
        lists: before.lists,
        response_type: 'error',
        error_code: 'VALIDATION_ERROR',
        mode_recommendation: 'task_detail',
        success: false,
        recovery_actions: ['edit_task_details']
      }
    );
  }

  if (changedFields.length === 0) {
    return withEnvelope(
      { view: 'message', message: 'At least one editable task detail field is required.' },
      {
        events: before.events,
        lists: before.lists,
        response_type: 'error',
        error_code: 'VALIDATION_ERROR',
        mode_recommendation: 'task_detail',
        success: false,
        recovery_actions: ['edit_task_details']
      }
    );
  }

  if (typeof args.title === 'string' && args.title.trim().length === 0) {
    return withEnvelope(
      { view: 'message', message: 'Task title cannot be empty.' },
      {
        events: before.events,
        lists: before.lists,
        response_type: 'error',
        error_code: 'VALIDATION_ERROR',
        mode_recommendation: 'task_detail',
        success: false,
        recovery_actions: ['edit_task_details']
      }
    );
  }

  const resolved = resolveList(before.lists, args.list_id_or_query);
  if (resolved.error_code === 'LIST_AMBIGUOUS') {
    return withEnvelope(
      {
        view: 'lists',
        message: 'Multiple matching lists found. Choose a list before editing task details.',
        lists: summariesForCandidates(before.lists, resolved.candidates)
      },
      {
        events: before.events,
        lists: before.lists,
        response_type: 'ambiguity',
        error_code: 'LIST_AMBIGUOUS',
        candidates: resolved.candidates,
        mode_recommendation: 'ambiguity_resolution',
        success: false
      }
    );
  }

  if (!resolved.list) {
    return withEnvelope(
      { view: 'message', message: 'No matching list found.' },
      {
        events: before.events,
        lists: before.lists,
        response_type: 'error',
        error_code: 'LIST_NOT_FOUND',
        candidates: [],
        mode_recommendation: 'error_recovery',
        success: false
      }
    );
  }

  if (resolved.list.status === 'archived') {
    return withEnvelope(
      { view: 'list', message: `List is archived: ${resolved.list.title}`, list: resolved.list },
      {
        events: before.events,
        lists: before.lists,
        response_type: 'error',
        error_code: 'ARCHIVED_LIST',
        mode_recommendation: 'archive_recovery',
        success: false
      }
    );
  }

  const task = resolveTask(resolved.list, args.item_id_or_title);
  if (task.error_code === 'TASK_AMBIGUOUS') {
    return withEnvelope(
      { view: 'list', message: 'Multiple matching tasks found. Choose a task before editing details.', list: resolved.list },
      {
        events: before.events,
        lists: before.lists,
        response_type: 'ambiguity',
        error_code: 'TASK_AMBIGUOUS',
        candidates: task.candidates,
        mode_recommendation: 'ambiguity_resolution',
        success: false
      }
    );
  }

  if (!task.task) {
    return withEnvelope(
      { view: 'list', message: `No matching task found in list: ${resolved.list.title}`, list: resolved.list },
      {
        events: before.events,
        lists: before.lists,
        response_type: 'error',
        error_code: 'TASK_NOT_FOUND',
        candidates: [],
        mode_recommendation: 'error_recovery',
        success: false
      }
    );
  }

  const current = task.task;
  const nextTask = {
    item_id: current.item_id,
    task_id: current.item_id,
    title: typeof args.title === 'string' ? args.title.trim() : current.title,
    notes: typeof args.notes === 'string' ? args.notes : current.notes || '',
    next_action: typeof args.next_action === 'string' ? args.next_action : current.next_action || '',
    pablo_instruction: typeof args.pablo_instruction === 'string' ? args.pablo_instruction : current.pablo_instruction || '',
    priority: args.priority || current.priority,
    status: args.status || current.status
  };

  const previous = {
    title: current.title,
    notes: current.notes || '',
    next_action: current.next_action || '',
    pablo_instruction: current.pablo_instruction || '',
    priority: current.priority,
    status: current.status
  };

  const event = createEvent('task_updated', resolved.list.list_id, {
    ...nextTask,
    changed_fields: changedFields,
    previous
  });
  await writeEvent(event);

  const { events, lists } = await getLists();
  const updatedList = resolveList(lists, resolved.list.list_id).list;
  const updatedTask = updatedList?.items.find((item) => item.item_id === current.item_id);

  return withEnvelope(
    {
      view: 'list',
      message: `Task details saved: ${nextTask.title}`,
      list: updatedList,
      task: updatedTask
    },
    {
      events,
      lists,
      response_type: 'mutation_result',
      action: 'task.updated',
      mode_recommendation: 'task_detail',
      affected: {
        list_id: resolved.list.list_id,
        task_id: current.item_id,
        changed_fields: changedFields
      },
      event
    }
  );
}
