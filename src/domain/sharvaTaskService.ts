import { createEvent, newId, readAllEvents, writeEvent } from '../storage/blobEventStore';
import { findList, findTask, materializeLists, summarizeList } from './materialize';
import type {
  ListSummary,
  Priority,
  SharvaTaskEvent,
  SharvaTaskList,
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

export async function createSharvaListData(args: { title: string; project?: string }): Promise<SharvaTaskWidgetOutput> {
  const listId = newId('LIST');
  await writeEvent(
    createEvent('list_created', listId, {
      title: args.title,
      project: args.project || 'General'
    })
  );

  const { lists } = await getLists();
  const list = findList(lists, listId);
  return {
    view: 'list',
    message: `Created SharvaTask list: ${args.title}`,
    list
  };
}

export async function addSharvaTaskData(args: {
  list_id_or_query?: string;
  title: string;
  notes?: string;
  priority?: Priority;
}): Promise<SharvaTaskWidgetOutput> {
  const { lists } = await getLists();
  const list = findList(lists, args.list_id_or_query);
  if (!list) return { view: 'message', message: 'No matching list found. Create a list first.' };
  if (list.status === 'archived') return { view: 'list', message: `List is archived: ${list.title}`, list };

  const itemId = newId('TASK');
  await writeEvent(
    createEvent('task_added', list.list_id, {
      item_id: itemId,
      title: args.title,
      notes: args.notes || '',
      priority: args.priority || 'P1'
    })
  );

  const fresh = (await getLists()).lists;
  const updatedList = findList(fresh, list.list_id);
  return {
    view: 'list',
    message: `Added task: ${args.title}`,
    list: updatedList
  };
}

export async function updateSharvaTaskStatusData(args: {
  list_id_or_query?: string;
  item_id_or_title: string;
  status: TaskStatus;
  notes?: string;
}): Promise<SharvaTaskWidgetOutput> {
  const { lists } = await getLists();
  const list = findList(lists, args.list_id_or_query);
  if (!list) return { view: 'message', message: 'No matching list found.' };

  const item = findTask(list, args.item_id_or_title);
  if (!item) return { view: 'list', message: `No matching task found in list: ${list.title}`, list };

  await writeEvent(
    createEvent('task_status_updated', list.list_id, {
      item_id: item.item_id,
      status: args.status,
      notes: args.notes || item.notes || ''
    })
  );

  const fresh = (await getLists()).lists;
  const updatedList = findList(fresh, list.list_id);
  return {
    view: 'list',
    message: `Updated task status: ${item.title} → ${args.status}`,
    list: updatedList
  };
}


export async function updateSharvaTaskData(args: {
  list_id_or_query?: string;
  item_id_or_title: string;
  title?: string;
  notes?: string;
  priority?: Priority;
}): Promise<SharvaTaskWidgetOutput> {
  const { lists } = await getLists();
  const list = findList(lists, args.list_id_or_query);
  if (!list) return { view: 'message', message: 'No matching list found.' };
  if (list.status === 'archived') return { view: 'list', message: `List is archived: ${list.title}`, list };

  const item = findTask(list, args.item_id_or_title);
  if (!item) return { view: 'list', message: `No matching task found in list: ${list.title}`, list };

  await writeEvent(
    createEvent('task_updated', list.list_id, {
      item_id: item.item_id,
      title: args.title || item.title,
      notes: typeof args.notes === 'string' ? args.notes : item.notes || '',
      priority: args.priority || item.priority
    })
  );

  const fresh = (await getLists()).lists;
  const updatedList = findList(fresh, list.list_id);
  return {
    view: 'list',
    message: `Updated task: ${args.title || item.title}`,
    list: updatedList
  };
}

export async function addProofData(args: {
  list_id_or_query?: string;
  item_id_or_title: string;
  proof: string;
}): Promise<SharvaTaskWidgetOutput> {
  const { lists } = await getLists();
  const list = findList(lists, args.list_id_or_query);
  if (!list) return { view: 'message', message: 'No matching list found.' };

  const item = findTask(list, args.item_id_or_title);
  if (!item) return { view: 'list', message: `No matching task found in list: ${list.title}`, list };

  await writeEvent(
    createEvent('task_proof_added', list.list_id, {
      item_id: item.item_id,
      proof: args.proof
    })
  );

  const fresh = (await getLists()).lists;
  const updatedList = findList(fresh, list.list_id);
  return {
    view: 'list',
    message: `Added proof to: ${item.title}`,
    list: updatedList
  };
}

export async function showSharvaListData(args: { list_id_or_query?: string }): Promise<SharvaTaskWidgetOutput> {
  const { lists } = await getLists();
  const list = findList(lists, args.list_id_or_query);
  return list
    ? { view: 'list', message: `Showing list: ${list.title}`, list }
    : { view: 'message', message: 'No matching list found.' };
}

export async function listAllSharvaListsData(args: {
  project?: string;
  status?: 'active' | 'archived' | 'all';
}): Promise<SharvaTaskWidgetOutput> {
  const { lists } = await getLists();
  const projectNeedle = args.project?.toLowerCase();
  const status = args.status || 'active';

  const summaries = lists
    .filter((list) => (status === 'all' ? true : list.status === status))
    .filter((list) => (projectNeedle ? list.project.toLowerCase().includes(projectNeedle) : true))
    .map(summarizeList);

  return {
    view: 'lists',
    message: summaries.length ? `Showing ${summaries.length} SharvaTask list(s).` : 'No lists found.',
    lists: summaries
  };
}

export async function searchSharvaListsData(args: { query: string }): Promise<SharvaTaskWidgetOutput> {
  const { lists } = await getLists();
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

  return {
    view: 'lists',
    message: summaries.length ? `Found ${summaries.length} list(s) for: ${args.query}` : `No lists found for: ${args.query}`,
    lists: summaries,
    query: args.query
  };
}

export async function continueSharvaListData(args: { project_or_query?: string }): Promise<SharvaTaskWidgetOutput> {
  const { lists } = await getLists();
  const list = findList(
    lists.filter((candidate) => candidate.status === 'active'),
    args.project_or_query
  );
  return list
    ? { view: 'list', message: `Continuing active list: ${list.title}`, list }
    : { view: 'message', message: 'No active list found to continue.' };
}

export async function showHistoryData(args: { list_id_or_query?: string }): Promise<SharvaTaskWidgetOutput> {
  const { events, lists } = await getLists();
  const list = findList(lists, args.list_id_or_query);
  if (!list) return { view: 'message', message: 'No matching list found.' };

  const matchingEvents = events.filter((event) => event.list_id === list.list_id);
  return {
    view: 'history',
    message: `Showing history for: ${list.title}`,
    list,
    events: matchingEvents
  };
}

export async function archiveSharvaListData(args: {
  list_id_or_query: string;
  reason?: string;
}): Promise<SharvaTaskWidgetOutput> {
  const { lists } = await getLists();
  const list = findList(lists, args.list_id_or_query);
  if (!list) return { view: 'message', message: 'No matching list found.' };
  if (list.status === 'archived') return { view: 'list', message: `Already archived: ${list.title}`, list };

  await writeEvent(
    createEvent('list_archived', list.list_id, {
      reason: args.reason || 'Archived from MCP tool'
    })
  );

  const fresh = (await getLists()).lists;
  const updatedList = findList(fresh, list.list_id);
  return {
    view: 'list',
    message: `Archived list: ${list.title}`,
    list: updatedList
  };
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
