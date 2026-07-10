import type { ListSummary, Priority, SharvaTaskEvent, SharvaTaskItem, SharvaTaskList, TaskStatus } from '../types';

function asString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function asRequiredString(value: unknown, fallback = ''): string {
  return typeof value === 'string' && value.trim().length > 0 ? value : fallback;
}

function asPriority(value: unknown): Priority {
  return value === 'P0' || value === 'P1' || value === 'P2' || value === 'P3' ? value : 'P1';
}

function asTaskStatus(value: unknown): TaskStatus {
  const allowed: TaskStatus[] = ['pending', 'in_progress', 'blocked', 'done', 'verified', 'dropped'];
  return allowed.includes(value as TaskStatus) ? (value as TaskStatus) : 'pending';
}

export function materializeLists(events: SharvaTaskEvent[]): SharvaTaskList[] {
  const lists = new Map<string, SharvaTaskList>();

  for (const event of events) {
    const payload = event.payload;

    if (event.action === 'list_created') {
      const existing = lists.get(event.list_id);
      if (existing) continue;
      lists.set(event.list_id, {
        list_id: event.list_id,
        title: asRequiredString(payload.title, 'Untitled List'),
        project: asRequiredString(payload.project, 'General'),
        status: 'active',
        created_at: event.event_time,
        updated_at: event.event_time,
        items: []
      });
      continue;
    }

    const current = lists.get(event.list_id);
    if (!current) continue;
    current.updated_at = event.event_time;

    if (event.action === 'task_added') {
      const item: SharvaTaskItem = {
        item_id: asRequiredString(payload.item_id, `TASK-${current.items.length + 1}`),
        title: asRequiredString(payload.title, 'Untitled task'),
        notes: asString(payload.notes, ''),
        next_action: asString(payload.next_action, ''),
        pablo_instruction: asString(payload.pablo_instruction, ''),
        status: asTaskStatus(payload.status),
        priority: asPriority(payload.priority),
        proof: [],
        created_at: event.event_time,
        updated_at: event.event_time
      };
      current.items.push(item);
    }

    if (event.action === 'task_status_updated') {
      const item = current.items.find((candidate) => candidate.item_id === payload.item_id);
      if (item) {
        item.status = asTaskStatus(payload.status);
        if (typeof payload.notes === 'string' && payload.notes.trim()) item.notes = payload.notes;
        item.next_action = item.next_action || '';
        item.pablo_instruction = item.pablo_instruction || '';
        item.updated_at = event.event_time;
      }
    }

    if (event.action === 'task_updated') {
      const item = current.items.find((candidate) => candidate.item_id === payload.item_id || candidate.item_id === payload.task_id);
      if (item) {
        if (typeof payload.title === 'string' && payload.title.trim()) item.title = payload.title;
        if (typeof payload.notes === 'string') item.notes = payload.notes;
        if (typeof payload.next_action === 'string') item.next_action = payload.next_action;
        if (typeof payload.pablo_instruction === 'string') item.pablo_instruction = payload.pablo_instruction;
        if (payload.priority) item.priority = asPriority(payload.priority);
        if (payload.status) item.status = asTaskStatus(payload.status);
        item.next_action = item.next_action || '';
        item.pablo_instruction = item.pablo_instruction || '';
        item.updated_at = event.event_time;
      }
    }

    if (event.action === 'task_proof_added') {
      const item = current.items.find((candidate) => candidate.item_id === payload.item_id);
      if (item) {
        const proof = asRequiredString(payload.proof, 'Proof added');
        item.proof.push(proof);
        item.next_action = item.next_action || '';
        item.pablo_instruction = item.pablo_instruction || '';
        item.updated_at = event.event_time;
      }
    }

    if (event.action === 'list_archived') {
      current.status = 'archived';
    }
  }

  return [...lists.values()].sort((a, b) => b.updated_at.localeCompare(a.updated_at));
}

export function summarizeList(list: SharvaTaskList): ListSummary {
  return {
    list_id: list.list_id,
    title: list.title,
    project: list.project,
    status: list.status,
    created_at: list.created_at,
    updated_at: list.updated_at,
    pending_count: list.items.filter((item) => item.status === 'pending' || item.status === 'in_progress').length,
    done_count: list.items.filter((item) => item.status === 'done' || item.status === 'verified').length,
    blocked_count: list.items.filter((item) => item.status === 'blocked').length,
    total_count: list.items.length
  };
}

export function serializeListForBoard(list: SharvaTaskList): SharvaTaskList {
  return {
    ...list,
    items: list.items.map((item) => ({
      ...item,
      notes: item.notes ?? '',
      next_action: item.next_action ?? '',
      pablo_instruction: item.pablo_instruction ?? '',
      proof: [...item.proof]
    }))
  };
}

export function findList(lists: SharvaTaskList[], listIdOrQuery?: string): SharvaTaskList | undefined {
  if (!listIdOrQuery) return lists.find((list) => list.status === 'active') ?? lists[0];

  const needle = listIdOrQuery.toLowerCase();
  return (
    lists.find((list) => list.list_id.toLowerCase() === needle) ||
    lists.find((list) => list.title.toLowerCase().includes(needle)) ||
    lists.find((list) => list.project.toLowerCase().includes(needle))
  );
}

export function findTask(list: SharvaTaskList, itemIdOrTitle: string): SharvaTaskItem | undefined {
  const needle = itemIdOrTitle.toLowerCase();
  return (
    list.items.find((item) => item.item_id.toLowerCase() === needle) ||
    list.items.find((item) => item.title.toLowerCase().includes(needle))
  );
}
