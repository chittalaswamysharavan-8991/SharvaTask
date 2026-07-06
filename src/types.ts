export type ListStatus = 'active' | 'archived';
export type TaskStatus = 'pending' | 'in_progress' | 'blocked' | 'done' | 'verified' | 'dropped';
export type Priority = 'P0' | 'P1' | 'P2' | 'P3';
export type SharvaTaskView = 'list' | 'lists' | 'history' | 'message';

export type SharvaTaskResponseType =
  | 'board_snapshot'
  | 'mutation_result'
  | 'list_browser'
  | 'search_results'
  | 'history'
  | 'task_detail'
  | 'ambiguity'
  | 'error';

export type SharvaTaskModeRecommendation =
  | 'board'
  | 'list_browser'
  | 'search'
  | 'history'
  | 'task_detail'
  | 'proof_detail'
  | 'archive_recovery'
  | 'empty_onboarding'
  | 'ambiguity_resolution'
  | 'error_recovery';

export type SharvaTaskSyncStatus = 'fresh' | 'stale' | 'conflict' | 'error';

export type SharvaTaskErrorCode =
  | 'LIST_NOT_FOUND'
  | 'TASK_NOT_FOUND'
  | 'LIST_AMBIGUOUS'
  | 'TASK_AMBIGUOUS'
  | 'DUPLICATE_LIST_CANDIDATE'
  | 'ARCHIVED_LIST'
  | 'VALIDATION_ERROR';

export interface SharvaTaskItem {
  item_id: string;
  title: string;
  notes?: string;
  status: TaskStatus;
  priority: Priority;
  proof: string[];
  created_at: string;
  updated_at: string;
}

export interface SharvaTaskList {
  list_id: string;
  title: string;
  project: string;
  status: ListStatus;
  created_at: string;
  updated_at: string;
  items: SharvaTaskItem[];
}

export type HistoryAction =
  | 'list_created'
  | 'task_added'
  | 'task_status_updated'
  | 'task_updated'
  | 'task_proof_added'
  | 'list_archived';

export interface SharvaTaskEvent {
  event_id: string;
  event_time: string;
  list_id: string;
  action: HistoryAction;
  payload: Record<string, unknown>;
}

export interface ListSummary {
  list_id: string;
  title: string;
  project: string;
  status: ListStatus;
  created_at: string;
  updated_at: string;
  pending_count: number;
  done_count: number;
  blocked_count: number;
  total_count: number;
}

export interface SharvaTaskAmbiguityCandidate {
  kind: 'list' | 'task';
  list_id?: string;
  item_id?: string;
  title: string;
  project?: string;
  status?: string;
  reason: string;
}

export interface SharvaTaskAmbiguityState {
  error_code: SharvaTaskErrorCode;
  message: string;
  candidates: SharvaTaskAmbiguityCandidate[];
}

export interface SharvaTaskWidgetOutput {
  response_type?: SharvaTaskResponseType;
  success?: boolean;
  action?: string;
  request_id?: string;
  server_time?: string;
  state_version?: number;
  state_version_after?: number;
  mode_recommendation?: SharvaTaskModeRecommendation;
  sync_status?: SharvaTaskSyncStatus;
  error_code?: SharvaTaskErrorCode;
  recovery_actions?: string[];
  affected?: Record<string, unknown>;
  active_pointer?: Record<string, unknown>;
  board_snapshot?: Record<string, unknown>;
  ambiguity?: SharvaTaskAmbiguityState;
  duplicate?: SharvaTaskAmbiguityState;
  event?: SharvaTaskEvent;
  view: SharvaTaskView;
  message: string;
  list?: SharvaTaskList;
  lists?: ListSummary[];
  events?: SharvaTaskEvent[];
  query?: string;
  task?: SharvaTaskItem;
}
