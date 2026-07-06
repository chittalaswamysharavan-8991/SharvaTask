export type ListStatus = 'active' | 'archived';
export type TaskStatus = 'pending' | 'in_progress' | 'blocked' | 'done' | 'verified' | 'dropped';
export type Priority = 'P0' | 'P1' | 'P2' | 'P3';
export type SharvaTaskView = 'list' | 'lists' | 'history' | 'message';

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

export interface SharvaTaskWidgetOutput {
  view: SharvaTaskView;
  message: string;
  list?: SharvaTaskList;
  lists?: ListSummary[];
  events?: SharvaTaskEvent[];
  query?: string;
}
