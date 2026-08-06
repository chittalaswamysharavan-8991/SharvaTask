import type {
  SharvaTaskAmbiguityCandidate,
  SharvaTaskEvent,
  SharvaTaskItem,
  SharvaTaskList,
  SharvaTaskModeRecommendation,
  SharvaTaskProofDetail,
  SharvaTaskSearchTaskMatch
} from '../types';

export interface OpenTaskBoardArgs {
  initial_mode?: SharvaTaskModeRecommendation;
  list_id?: string;
  list_query?: string;
  task_id?: string;
  proof_id?: string;
  search_query?: string;
  include_archived?: boolean;
  restore_strategy?: 'active_pointer' | 'latest_business_mutation' | 'explicit_only';
}

export type RouteIntent =
  | { mode: 'board'; restore_strategy: NonNullable<OpenTaskBoardArgs['restore_strategy']> }
  | { mode: 'list_browser'; include_archived: boolean }
  | { mode: 'search'; query: string; list_target?: string; include_archived: boolean }
  | { mode: 'history'; list_target?: string; include_archived: boolean }
  | { mode: 'task_detail'; task_id?: string; list_target?: string; include_archived: boolean }
  | { mode: 'proof_detail'; task_id?: string; proof_id?: string; list_target?: string; include_archived: boolean }
  | { mode: 'archive_recovery'; list_target?: string }
  | { mode: 'empty_onboarding' }
  | { mode: 'ambiguity_resolution' }
  | { mode: 'error_recovery' };

export function normalizeRouteKey(value: string | undefined): string {
  return String(value || '')
    .trim()
    .toLowerCase()
    .normalize('NFKC')
    .replace(/\s+/g, ' ');
}

export function normalizeRouteIntent(args: OpenTaskBoardArgs): RouteIntent {
  const mode = args.initial_mode || 'board';
  const listTarget = args.list_id || args.list_query;
  const includeArchived = Boolean(args.include_archived);
  if (mode === 'list_browser') return { mode, include_archived: includeArchived };
  if (mode === 'search') return { mode, query: String(args.search_query || '').trim(), list_target: listTarget, include_archived: includeArchived };
  if (mode === 'history') return { mode, list_target: listTarget, include_archived: includeArchived };
  if (mode === 'task_detail') return { mode, task_id: args.task_id, list_target: listTarget, include_archived: includeArchived };
  if (mode === 'proof_detail') return { mode, task_id: args.task_id, proof_id: args.proof_id, list_target: listTarget, include_archived: includeArchived };
  if (mode === 'archive_recovery') return { mode, list_target: listTarget };
  if (mode === 'empty_onboarding' || mode === 'ambiguity_resolution' || mode === 'error_recovery') return { mode };
  return { mode: 'board', restore_strategy: args.restore_strategy || 'active_pointer' };
}

export function listCandidate(list: SharvaTaskList, reason: string): SharvaTaskAmbiguityCandidate {
  return { kind: 'list', list_id: list.list_id, title: list.title, project: list.project, status: list.status, reason };
}

export function taskCandidate(list: SharvaTaskList, task: SharvaTaskItem, reason: string): SharvaTaskAmbiguityCandidate {
  return { kind: 'task', list_id: list.list_id, item_id: task.item_id, title: task.title, project: list.project, status: task.status, reason };
}

export function resolveListTarget(lists: SharvaTaskList[], listIdOrQuery?: string, options: { includeArchived?: boolean } = {}): { list?: SharvaTaskList; error_code?: 'LIST_NOT_FOUND' | 'LIST_AMBIGUOUS'; candidates?: SharvaTaskAmbiguityCandidate[] } {
  if (!listIdOrQuery) return {};
  const needle = normalizeRouteKey(listIdOrQuery);
  const exactId = lists.find((list) => list.list_id.toLowerCase() === needle);
  if (exactId) return { list: exactId };
  const scope = options.includeArchived ? lists : lists.filter((list) => list.status === 'active');
  const exactTitle = scope.filter((list) => normalizeRouteKey(list.title) === needle || normalizeRouteKey(list.project) === needle);
  if (exactTitle.length === 1) return { list: exactTitle[0] };
  if (exactTitle.length > 1) return { error_code: 'LIST_AMBIGUOUS', candidates: exactTitle.map((list) => listCandidate(list, 'exact_normalized_match')) };
  const fuzzy = scope.filter((list) => normalizeRouteKey(list.title).includes(needle) || normalizeRouteKey(list.project).includes(needle));
  if (fuzzy.length === 1) return { list: fuzzy[0] };
  if (fuzzy.length > 1) return { error_code: 'LIST_AMBIGUOUS', candidates: fuzzy.map((list) => listCandidate(list, 'fuzzy_match')) };
  return { error_code: 'LIST_NOT_FOUND', candidates: [] };
}

export function resolveTaskTarget(list: SharvaTaskList, itemIdOrTitle: string): { task?: SharvaTaskItem; error_code?: 'TASK_NOT_FOUND' | 'TASK_AMBIGUOUS'; candidates?: SharvaTaskAmbiguityCandidate[] } {
  const needle = normalizeRouteKey(itemIdOrTitle);
  const exactId = list.items.find((item) => item.item_id.toLowerCase() === needle);
  if (exactId) return { task: exactId };
  const exactTitle = list.items.filter((item) => normalizeRouteKey(item.title) === needle);
  if (exactTitle.length === 1) return { task: exactTitle[0] };
  if (exactTitle.length > 1) return { error_code: 'TASK_AMBIGUOUS', candidates: exactTitle.map((task) => taskCandidate(list, task, 'exact_normalized_match')) };
  const fuzzy = list.items.filter((item) => normalizeRouteKey(item.title).includes(needle));
  if (fuzzy.length === 1) return { task: fuzzy[0] };
  if (fuzzy.length > 1) return { error_code: 'TASK_AMBIGUOUS', candidates: fuzzy.map((task) => taskCandidate(list, task, 'fuzzy_match')) };
  return { error_code: 'TASK_NOT_FOUND', candidates: [] };
}

export function resolveTaskAcrossLists(lists: SharvaTaskList[], itemIdOrTitle: string, options: { includeArchived?: boolean } = {}): { list?: SharvaTaskList; task?: SharvaTaskItem; error_code?: 'TASK_NOT_FOUND' | 'TASK_AMBIGUOUS'; candidates?: SharvaTaskAmbiguityCandidate[] } {
  const scope = options.includeArchived ? lists : lists.filter((list) => list.status === 'active');
  const needle = normalizeRouteKey(itemIdOrTitle);
  const collect = (predicate: (task: SharvaTaskItem) => boolean, reason: string) => scope.flatMap((list) => list.items.filter(predicate).map((task) => ({ list, task, candidate: taskCandidate(list, task, reason) })));
  const exactIds = collect((task) => task.item_id.toLowerCase() === needle, 'exact_id_match');
  if (exactIds.length === 1) return { list: exactIds[0].list, task: exactIds[0].task };
  if (exactIds.length > 1) return { error_code: 'TASK_AMBIGUOUS', candidates: exactIds.map((match) => match.candidate) };
  const exactTitles = collect((task) => normalizeRouteKey(task.title) === needle, 'exact_normalized_match');
  if (exactTitles.length === 1) return { list: exactTitles[0].list, task: exactTitles[0].task };
  if (exactTitles.length > 1) return { error_code: 'TASK_AMBIGUOUS', candidates: exactTitles.map((match) => match.candidate) };
  const fuzzy = collect((task) => normalizeRouteKey(task.title).includes(needle), 'fuzzy_match');
  if (fuzzy.length === 1) return { list: fuzzy[0].list, task: fuzzy[0].task };
  if (fuzzy.length > 1) return { error_code: 'TASK_AMBIGUOUS', candidates: fuzzy.map((match) => match.candidate) };
  return { error_code: 'TASK_NOT_FOUND', candidates: [] };
}

function taskMatchesQuery(task: SharvaTaskItem, query: string): boolean {
  const needle = normalizeRouteKey(query);
  return [task.item_id, task.title, task.notes, task.next_action, task.pablo_instruction, task.status, task.priority].some((value) => normalizeRouteKey(String(value || '')).includes(needle));
}

export function searchTasksInList(list: SharvaTaskList, query: string): SharvaTaskList {
  return { ...list, items: list.items.filter((task) => taskMatchesQuery(task, query)) };
}

export function searchAllTasks(lists: SharvaTaskList[], query: string, options: { includeArchived?: boolean } = {}): SharvaTaskSearchTaskMatch[] {
  const scope = options.includeArchived ? lists : lists.filter((list) => list.status === 'active');
  return scope.flatMap((list) => list.items.filter((task) => taskMatchesQuery(task, query)).map((task) => ({ list_id: list.list_id, list_title: list.title, project: list.project, task })));
}

export function selectRestoreList(lists: SharvaTaskList[], events: SharvaTaskEvent[], strategy: NonNullable<OpenTaskBoardArgs['restore_strategy']>, includeArchived = false): SharvaTaskList | undefined {
  if (strategy === 'explicit_only') return undefined;
  const scope = includeArchived ? lists : lists.filter((list) => list.status === 'active');
  if (strategy === 'latest_business_mutation') {
    for (let index = events.length - 1; index >= 0; index -= 1) {
      const list = scope.find((candidate) => candidate.list_id === events[index].list_id);
      if (list) return list;
    }
  }
  return scope[0];
}

export function resolveProofTarget(events: SharvaTaskEvent[], list: SharvaTaskList, task: SharvaTaskItem, proofId?: string): SharvaTaskProofDetail | undefined {
  const matchingEvents = events.filter((event) => event.action === 'task_proof_added' && event.list_id === list.list_id && (event.payload?.item_id === task.item_id || event.payload?.task_id === task.item_id));
  const selected = proofId ? matchingEvents.find((event) => event.payload?.proof_id === proofId) : matchingEvents[matchingEvents.length - 1];
  if (selected) return { proof_id: typeof selected.payload.proof_id === 'string' ? selected.payload.proof_id : undefined, content: typeof selected.payload.proof === 'string' ? selected.payload.proof : 'Proof added', proof_type: typeof selected.payload.proof_type === 'string' ? selected.payload.proof_type : undefined, event_id: selected.event_id, event_time: selected.event_time };
  const fallback = task.proof[task.proof.length - 1];
  return fallback ? { content: fallback } : undefined;
}
