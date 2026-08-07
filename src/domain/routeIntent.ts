import type {
  SharvaTaskAmbiguityCandidate,
  SharvaTaskEvent,
  SharvaTaskItem,
  SharvaTaskList,
  SharvaTaskModeRecommendation,
  SharvaTaskTaskSearchResult
} from '../types';

export type OpenTaskBoardRestoreStrategy = 'active_pointer' | 'latest_business_mutation' | 'explicit_only';

export interface OpenTaskBoardArgs {
  initial_mode?: SharvaTaskModeRecommendation;
  list_id?: string;
  list_query?: string;
  task_id?: string;
  search_query?: string;
  proof_index?: number;
  include_archived?: boolean;
  restore_strategy?: OpenTaskBoardRestoreStrategy;
}

export interface OpenTaskBoardIntent {
  mode: SharvaTaskModeRecommendation;
  list_id?: string;
  list_query?: string;
  task_id?: string;
  search_query?: string;
  proof_index?: number;
  include_archived: boolean;
  restore_strategy: OpenTaskBoardRestoreStrategy;
  has_explicit_list_target: boolean;
}

export interface RouteResolution<T> {
  value?: T;
  list?: SharvaTaskList;
  error_code?: 'LIST_NOT_FOUND' | 'LIST_AMBIGUOUS' | 'TASK_NOT_FOUND' | 'TASK_AMBIGUOUS';
  candidates?: SharvaTaskAmbiguityCandidate[];
}

function normalized(value: string | undefined): string {
  return String(value || '')
    .trim()
    .toLowerCase()
    .normalize('NFKC')
    .replace(/\s+/g, ' ');
}

function visibleLists(lists: SharvaTaskList[], includeArchived: boolean): SharvaTaskList[] {
  return includeArchived ? lists : lists.filter((list) => list.status === 'active');
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
    project: list.project,
    status: task.status,
    reason
  };
}

export function normalizeOpenTaskBoardIntent(args: OpenTaskBoardArgs): OpenTaskBoardIntent {
  const listId = args.list_id?.trim() || undefined;
  const listQuery = args.list_query?.trim() || undefined;
  return {
    mode: args.initial_mode || 'board',
    list_id: listId,
    list_query: listQuery,
    task_id: args.task_id?.trim() || undefined,
    search_query: args.search_query?.trim() || undefined,
    proof_index: Number.isInteger(args.proof_index) ? args.proof_index : undefined,
    include_archived: args.include_archived === true,
    restore_strategy: args.restore_strategy || 'active_pointer',
    has_explicit_list_target: Boolean(listId || listQuery)
  };
}

export function resolveRouteList(
  lists: SharvaTaskList[],
  events: SharvaTaskEvent[],
  intent: OpenTaskBoardIntent
): RouteResolution<SharvaTaskList> {
  const explicit = intent.list_id || intent.list_query;
  if (explicit) {
    const needle = normalized(explicit);
    const exactId = lists.find((list) => normalized(list.list_id) === needle);
    if (exactId) return { value: exactId, list: exactId };

    const scope = visibleLists(lists, intent.include_archived);
    const exact = scope.filter(
      (list) => normalized(list.title) === needle || normalized(list.project) === needle
    );
    if (exact.length === 1) return { value: exact[0], list: exact[0] };
    if (exact.length > 1) {
      return {
        error_code: 'LIST_AMBIGUOUS',
        candidates: exact.map((list) => listCandidate(list, 'exact_normalized_match'))
      };
    }

    const fuzzy = scope.filter(
      (list) => normalized(list.title).includes(needle) || normalized(list.project).includes(needle)
    );
    if (fuzzy.length === 1) return { value: fuzzy[0], list: fuzzy[0] };
    if (fuzzy.length > 1) {
      return {
        error_code: 'LIST_AMBIGUOUS',
        candidates: fuzzy.map((list) => listCandidate(list, 'fuzzy_match'))
      };
    }
    return { error_code: 'LIST_NOT_FOUND', candidates: [] };
  }

  if (intent.restore_strategy === 'explicit_only') return {};
  const scope = visibleLists(lists, intent.include_archived);
  if (intent.restore_strategy === 'latest_business_mutation') {
    for (const event of [...events].reverse()) {
      const matching = scope.find((list) => list.list_id === event.list_id);
      if (matching) return { value: matching, list: matching };
    }
  }
  const active = scope.find((list) => list.status === 'active') || scope[0];
  return active ? { value: active, list: active } : {};
}

export function resolveRouteTask(
  lists: SharvaTaskList[],
  taskIdOrTitle: string,
  options: { list?: SharvaTaskList; includeArchived?: boolean } = {}
): RouteResolution<SharvaTaskItem> {
  const needle = normalized(taskIdOrTitle);
  const scope = options.list ? [options.list] : visibleLists(lists, options.includeArchived === true);
  const exactIds = scope.flatMap((list) =>
    list.items
      .filter((task) => normalized(task.item_id) === needle)
      .map((task) => ({ list, task }))
  );
  if (exactIds.length === 1) return { value: exactIds[0].task, list: exactIds[0].list };
  if (exactIds.length > 1) {
    return {
      error_code: 'TASK_AMBIGUOUS',
      candidates: exactIds.map(({ list, task }) => taskCandidate(list, task, 'duplicate_stable_id'))
    };
  }

  const exactTitles = scope.flatMap((list) =>
    list.items
      .filter((task) => normalized(task.title) === needle)
      .map((task) => ({ list, task }))
  );
  if (exactTitles.length === 1) return { value: exactTitles[0].task, list: exactTitles[0].list };
  if (exactTitles.length > 1) {
    return {
      error_code: 'TASK_AMBIGUOUS',
      candidates: exactTitles.map(({ list, task }) => taskCandidate(list, task, 'exact_normalized_match'))
    };
  }

  const fuzzy = scope.flatMap((list) =>
    list.items
      .filter((task) => normalized(task.title).includes(needle))
      .map((task) => ({ list, task }))
  );
  if (fuzzy.length === 1) return { value: fuzzy[0].task, list: fuzzy[0].list };
  if (fuzzy.length > 1) {
    return {
      error_code: 'TASK_AMBIGUOUS',
      candidates: fuzzy.map(({ list, task }) => taskCandidate(list, task, 'fuzzy_match'))
    };
  }
  return { error_code: 'TASK_NOT_FOUND', candidates: [] };
}

export function searchRouteTargets(
  lists: SharvaTaskList[],
  query: string,
  options: { list?: SharvaTaskList; includeArchived?: boolean } = {}
): { lists: SharvaTaskList[]; tasks: SharvaTaskTaskSearchResult[] } {
  const needle = normalized(query);
  const scope = options.list ? [options.list] : visibleLists(lists, options.includeArchived === true);
  if (!needle) return { lists: options.list ? [options.list] : scope, tasks: [] };

  const matchingLists = options.list
    ? []
    : scope.filter(
        (list) =>
          normalized(list.title).includes(needle) ||
          normalized(list.project).includes(needle) ||
          normalized(list.list_id).includes(needle)
      );
  const tasks = scope.flatMap((list) =>
    list.items
      .filter(
        (task) =>
          normalized(task.title).includes(needle) ||
          normalized(task.notes).includes(needle) ||
          normalized(task.next_action).includes(needle) ||
          normalized(task.pablo_instruction).includes(needle) ||
          normalized(task.item_id).includes(needle)
      )
      .map((task) => ({
        list_id: list.list_id,
        list_title: list.title,
        project: list.project,
        task
      }))
  );
  return { lists: matchingLists, tasks };
}
