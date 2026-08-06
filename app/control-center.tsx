'use client';

import { FormEvent, useEffect, useMemo, useState } from 'react';
import type { ControlCenterState } from '../src/domain/controlCenterService';
import type { Priority, SharvaTaskEvent, SharvaTaskItem, TaskStatus } from '../src/types';

type Filter = 'all' | 'open' | 'blocked' | 'complete';

type MutationPayload =
  | { action: 'create_list'; title: string; project?: string }
  | { action: 'add_task'; list_id: string; title: string; notes?: string; priority?: Priority }
  | { action: 'set_status'; list_id: string; item_id: string; status: TaskStatus }
  | {
      action: 'edit_task';
      list_id: string;
      item_id: string;
      title?: string;
      notes?: string;
      next_action?: string;
      pablo_instruction?: string;
      priority?: Priority;
      status?: TaskStatus;
    }
  | { action: 'add_proof'; list_id: string; item_id: string; proof: string }
  | { action: 'archive_list'; list_id: string; reason?: string };

interface EditDraft {
  title: string;
  notes: string;
  next_action: string;
  pablo_instruction: string;
  priority: Priority;
  status: TaskStatus;
}

function Icon({ name }: { name: 'refresh' | 'search' | 'plus' | 'check' | 'clock' | 'archive' | 'list' | 'activity' | 'proof' | 'menu' }) {
  const paths: Record<string, React.ReactNode> = {
    refresh: <><path d="M20 6v5h-5"/><path d="M4 18v-5h5"/><path d="M6.1 9A7 7 0 0 1 18 6l2 5"/><path d="M17.9 15A7 7 0 0 1 6 18l-2-5"/></>,
    search: <><circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/></>,
    plus: <><path d="M12 5v14"/><path d="M5 12h14"/></>,
    check: <path d="m5 12 4 4L19 6"/>,
    clock: <><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></>,
    archive: <><path d="M4 7h16"/><path d="M6 7v12h12V7"/><path d="M8 4h8l2 3H6l2-3Z"/><path d="M10 11h4"/></>,
    list: <><path d="M9 6h11"/><path d="M9 12h11"/><path d="M9 18h11"/><path d="M4 6h.01"/><path d="M4 12h.01"/><path d="M4 18h.01"/></>,
    activity: <><path d="M3 12h4l2-7 4 14 2-7h6"/></>,
    proof: <><path d="M7 3h7l4 4v14H7z"/><path d="M14 3v5h5"/><path d="m10 14 2 2 4-4"/></>,
    menu: <><path d="M4 7h16"/><path d="M4 12h16"/><path d="M4 17h16"/></>
  };
  return <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">{paths[name]}</svg>;
}

function formatDate(value?: string) {
  if (!value) return 'Not synced';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('en-IN', {
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit'
  }).format(date);
}

function statusLabel(status: TaskStatus) {
  return ({
    pending: 'Pending',
    in_progress: 'In progress',
    blocked: 'Blocked',
    done: 'Done',
    verified: 'Verified',
    dropped: 'Dropped'
  } as Record<TaskStatus, string>)[status];
}

function eventLabel(event: SharvaTaskEvent) {
  const labels: Record<SharvaTaskEvent['action'], string> = {
    list_created: 'List created',
    task_added: 'Task added',
    task_status_updated: 'Status changed',
    task_updated: 'Task edited',
    task_proof_added: 'Proof added',
    list_archived: 'List archived'
  };
  return labels[event.action];
}

function taskFromEvent(event: SharvaTaskEvent) {
  const payload = event.payload || {};
  return String(payload.title || payload.task_title || payload.item_id || 'SharvaTask update');
}

function emptyDraft(task: SharvaTaskItem): EditDraft {
  return {
    title: task.title,
    notes: task.notes || '',
    next_action: task.next_action || '',
    pablo_instruction: task.pablo_instruction || '',
    priority: task.priority,
    status: task.status
  };
}

export function ControlCenter({ initialState }: { initialState: ControlCenterState }) {
  const [state, setState] = useState(initialState);
  const [selectedListId, setSelectedListId] = useState(initialState.list?.list_id || '');
  const [selectedTaskId, setSelectedTaskId] = useState<string>('');
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [noticeKind, setNoticeKind] = useState<'ok' | 'error'>('ok');
  const [quickTitle, setQuickTitle] = useState('');
  const [quickPriority, setQuickPriority] = useState<Priority>('P0');
  const [showNewList, setShowNewList] = useState(false);
  const [newListTitle, setNewListTitle] = useState('');
  const [newListProject, setNewListProject] = useState('SharvaOS');
  const [proofText, setProofText] = useState('');
  const [editDraft, setEditDraft] = useState<EditDraft | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const list = state.list;
  const tasks = list?.items || [];
  const selectedTask = tasks.find((task) => task.item_id === selectedTaskId);

  useEffect(() => {
    if (selectedTask) setEditDraft(emptyDraft(selectedTask));
    else setEditDraft(null);
  }, [selectedTaskId, selectedTask?.updated_at]);

  useEffect(() => {
    if (list && selectedListId !== list.list_id) setSelectedListId(list.list_id);
  }, [list?.list_id]);

  const counts = useMemo(() => {
    return tasks.reduce(
      (acc, task) => {
        acc.total += 1;
        if (task.status === 'blocked') acc.blocked += 1;
        if (task.status === 'done' || task.status === 'verified') acc.done += 1;
        if (task.status === 'pending' || task.status === 'in_progress') acc.open += 1;
        return acc;
      },
      { total: 0, open: 0, blocked: 0, done: 0 }
    );
  }, [tasks]);

  const visibleTasks = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return tasks.filter((task) => {
      const matchesQuery = !needle || [task.title, task.notes, task.next_action, task.pablo_instruction, task.priority, task.status]
        .some((value) => String(value || '').toLowerCase().includes(needle));
      const matchesFilter = filter === 'all'
        || (filter === 'open' && (task.status === 'pending' || task.status === 'in_progress'))
        || (filter === 'blocked' && task.status === 'blocked')
        || (filter === 'complete' && (task.status === 'done' || task.status === 'verified'));
      return matchesQuery && matchesFilter;
    });
  }, [tasks, query, filter]);

  const progress = counts.total ? Math.round((counts.done / counts.total) * 100) : 0;
  const activeLists = state.lists.filter((item) => item.status === 'active');
  const archivedLists = state.lists.filter((item) => item.status === 'archived');

  async function reload(listId = selectedListId) {
    setBusy(true);
    setNotice('');
    try {
      const suffix = listId ? `?list_id=${encodeURIComponent(listId)}` : '';
      const response = await fetch(`/api/control-center${suffix}`, { cache: 'no-store' });
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.message || 'Unable to refresh SharvaTask.');
      setState(data);
      setSelectedTaskId('');
      setNotice('Control center refreshed.');
      setNoticeKind('ok');
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Refresh failed.');
      setNoticeKind('error');
    } finally {
      setBusy(false);
    }
  }

  async function mutate(payload: MutationPayload, successMessage: string) {
    setBusy(true);
    setNotice('');
    try {
      const response = await fetch('/api/control-center', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await response.json();
      if (data.state) setState(data.state);
      if (!response.ok) throw new Error(data.mutation?.message || data.error || 'Operation failed.');
      setNotice(successMessage);
      setNoticeKind('ok');
      return data;
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Operation failed.');
      setNoticeKind('error');
      throw error;
    } finally {
      setBusy(false);
    }
  }

  async function chooseList(listId: string) {
    setSelectedListId(listId);
    setSidebarOpen(false);
    await reload(listId);
  }

  async function addTask(event: FormEvent) {
    event.preventDefault();
    if (!list || !quickTitle.trim()) return;
    try {
      await mutate({
        action: 'add_task',
        list_id: list.list_id,
        title: quickTitle.trim(),
        priority: quickPriority
      }, 'Task captured.');
      setQuickTitle('');
    } catch {}
  }

  async function createList(event: FormEvent) {
    event.preventDefault();
    if (!newListTitle.trim()) return;
    try {
      const data = await mutate({
        action: 'create_list',
        title: newListTitle.trim(),
        project: newListProject.trim() || 'General'
      }, 'List created.');
      const createdId = data.mutation?.list?.list_id;
      if (createdId) setSelectedListId(createdId);
      setNewListTitle('');
      setShowNewList(false);
    } catch {}
  }

  async function changeStatus(task: SharvaTaskItem, status: TaskStatus) {
    if (!list || task.status === status) return;
    try {
      await mutate({ action: 'set_status', list_id: list.list_id, item_id: task.item_id, status }, `${task.title} → ${statusLabel(status)}.`);
    } catch {}
  }

  async function saveTask(event: FormEvent) {
    event.preventDefault();
    if (!list || !selectedTask || !editDraft) return;
    try {
      await mutate({
        action: 'edit_task',
        list_id: list.list_id,
        item_id: selectedTask.item_id,
        ...editDraft
      }, 'Task details saved.');
    } catch {}
  }

  async function addProof(event: FormEvent) {
    event.preventDefault();
    if (!list || !selectedTask || !proofText.trim()) return;
    try {
      await mutate({
        action: 'add_proof',
        list_id: list.list_id,
        item_id: selectedTask.item_id,
        proof: proofText.trim()
      }, 'Proof attached.');
      setProofText('');
    } catch {}
  }

  async function archiveList() {
    if (!list || list.status === 'archived') return;
    if (!window.confirm(`Archive “${list.title}”? The history remains preserved.`)) return;
    try {
      await mutate({ action: 'archive_list', list_id: list.list_id, reason: 'Archived from SharvaTask Control Center' }, 'List archived.');
    } catch {}
  }

  return (
    <main className="control-shell">
      <aside className={`sidebar ${sidebarOpen ? 'sidebar-open' : ''}`}>
        <div className="brand-row">
          <div className="brand-mark">S</div>
          <div>
            <div className="brand-name">SharvaTask</div>
            <div className="brand-subtitle">Control Center</div>
          </div>
          <button className="icon-button mobile-only" onClick={() => setSidebarOpen(false)} aria-label="Close navigation">×</button>
        </div>

        <button className="new-list-button" onClick={() => setShowNewList((value) => !value)}>
          <Icon name="plus" /> New list
        </button>

        {showNewList && (
          <form className="new-list-form" onSubmit={createList}>
            <input value={newListTitle} onChange={(event) => setNewListTitle(event.target.value)} placeholder="List name" autoFocus />
            <input value={newListProject} onChange={(event) => setNewListProject(event.target.value)} placeholder="Project" />
            <button className="primary-button" disabled={busy || !newListTitle.trim()}>Create list</button>
          </form>
        )}

        <nav className="list-nav" aria-label="SharvaTask lists">
          <div className="nav-heading">Active lists</div>
          {activeLists.length === 0 && <p className="nav-empty">No active lists</p>}
          {activeLists.map((item) => (
            <button key={item.list_id} className={`list-nav-item ${item.list_id === list?.list_id ? 'active' : ''}`} onClick={() => chooseList(item.list_id)}>
              <span className="list-nav-icon"><Icon name="list" /></span>
              <span className="list-nav-copy">
                <strong>{item.title}</strong>
                <small>{item.pending_count} open · {item.done_count} done</small>
              </span>
              {item.blocked_count > 0 && <span className="blocked-count">{item.blocked_count}</span>}
            </button>
          ))}

          {archivedLists.length > 0 && <div className="nav-heading archived-heading">Archived</div>}
          {archivedLists.slice(0, 8).map((item) => (
            <button key={item.list_id} className={`list-nav-item archived ${item.list_id === list?.list_id ? 'active' : ''}`} onClick={() => chooseList(item.list_id)}>
              <span className="list-nav-icon"><Icon name="archive" /></span>
              <span className="list-nav-copy"><strong>{item.title}</strong><small>{item.total_count} tasks preserved</small></span>
            </button>
          ))}
        </nav>

        <div className="system-card">
          <div className="system-line"><span className={`status-dot ${state.ok && state.system.storage_ready ? 'online' : 'offline'}`} />Canonical backend</div>
          <strong>{state.system.storage}</strong>
          <small>{state.system.source_of_truth}</small>
          <div className="system-meta"><span>MCP connected</span><span>v{state.state_version}</span></div>
        </div>
      </aside>

      {sidebarOpen && <button className="sidebar-backdrop" onClick={() => setSidebarOpen(false)} aria-label="Close navigation" />}

      <section className="workspace">
        <header className="topbar">
          <div className="topbar-title">
            <button className="icon-button mobile-only" onClick={() => setSidebarOpen(true)} aria-label="Open navigation"><Icon name="menu" /></button>
            <div>
              <h1>Control Center</h1>
              <p>{new Intl.DateTimeFormat('en-IN', { weekday: 'long', day: 'numeric', month: 'long' }).format(new Date())}</p>
            </div>
          </div>
          <div className="topbar-actions">
            <div className="search-field">
              <Icon name="search" />
              <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search this list" aria-label="Search tasks" />
            </div>
            <button className="icon-button" onClick={() => reload()} disabled={busy} aria-label="Refresh control center"><Icon name="refresh" /></button>
          </div>
        </header>

        <div className="workspace-body">
          {!state.ok && (
            <section className="error-state">
              <h2>SharvaTask could not load</h2>
              <p>{state.message}</p>
              <button className="primary-button" onClick={() => reload()} disabled={busy}>Try again</button>
            </section>
          )}

          {state.ok && !list && (
            <section className="empty-state-large">
              <div className="empty-icon"><Icon name="list" /></div>
              <h2>Create your first SharvaTask list</h2>
              <p>The control center will use the same MCP service and Vercel Blob event history.</p>
              <button className="primary-button" onClick={() => setShowNewList(true)}>Create list</button>
            </section>
          )}

          {state.ok && list && (
            <>
              <section className="list-hero">
                <div className="list-heading">
                  <div>
                    <div className="list-kicker">{list.project}</div>
                    <h2>{list.title}</h2>
                    <p>{list.status === 'archived' ? 'Archived record — preserved as read only' : `${counts.open} tasks need attention`}</p>
                  </div>
                  <div className="list-actions">
                    <span className={`sync-chip ${state.sync_status}`}>● {state.sync_status === 'fresh' ? 'Live' : state.sync_status}</span>
                    {list.status === 'active' && <button className="ghost-button danger" onClick={archiveList} disabled={busy}><Icon name="archive" /> Archive</button>}
                  </div>
                </div>

                <div className="progress-row">
                  <div className="progress-copy"><strong>{progress}% complete</strong><span>{counts.done} of {counts.total} tasks</span></div>
                  <div className="progress-track"><span style={{ width: `${progress}%` }} /></div>
                </div>

                <div className="metrics">
                  <button className={`metric ${filter === 'open' ? 'selected' : ''}`} onClick={() => setFilter(filter === 'open' ? 'all' : 'open')}>
                    <span className="metric-icon violet"><Icon name="clock" /></span><span><strong>{counts.open}</strong><small>Open</small></span>
                  </button>
                  <button className={`metric ${filter === 'blocked' ? 'selected' : ''}`} onClick={() => setFilter(filter === 'blocked' ? 'all' : 'blocked')}>
                    <span className="metric-icon amber">!</span><span><strong>{counts.blocked}</strong><small>Blocked</small></span>
                  </button>
                  <button className={`metric ${filter === 'complete' ? 'selected' : ''}`} onClick={() => setFilter(filter === 'complete' ? 'all' : 'complete')}>
                    <span className="metric-icon green"><Icon name="check" /></span><span><strong>{counts.done}</strong><small>Complete</small></span>
                  </button>
                  <div className="metric static"><span className="metric-icon neutral"><Icon name="activity" /></span><span><strong>{state.events.length}</strong><small>Events</small></span></div>
                </div>
              </section>

              {list.status === 'active' && (
                <form className="quick-capture" onSubmit={addTask}>
                  <span className="capture-plus"><Icon name="plus" /></span>
                  <input value={quickTitle} onChange={(event) => setQuickTitle(event.target.value)} placeholder="Capture the next task…" aria-label="New task title" />
                  <select value={quickPriority} onChange={(event) => setQuickPriority(event.target.value as Priority)} aria-label="Task priority">
                    <option>P0</option><option>P1</option><option>P2</option><option>P3</option>
                  </select>
                  <button className="primary-button" disabled={busy || !quickTitle.trim()}>Add task</button>
                </form>
              )}

              <div className="content-grid">
                <section className="task-panel">
                  <div className="panel-heading">
                    <div><h3>Tasks</h3><p>{visibleTasks.length} shown · updated {formatDate(list.updated_at)}</p></div>
                    <div className="filter-tabs" role="tablist" aria-label="Task filters">
                      {(['all', 'open', 'blocked', 'complete'] as Filter[]).map((value) => (
                        <button key={value} className={filter === value ? 'active' : ''} onClick={() => setFilter(value)}>{value[0].toUpperCase() + value.slice(1)}</button>
                      ))}
                    </div>
                  </div>

                  <div className="task-list">
                    {visibleTasks.length === 0 && <div className="task-empty">No tasks match this view.</div>}
                    {visibleTasks.map((task) => (
                      <article key={task.item_id} className={`task-row ${selectedTaskId === task.item_id ? 'selected' : ''}`} onClick={() => setSelectedTaskId(task.item_id)}>
                        <div className={`priority-badge ${task.priority.toLowerCase()}`}>{task.priority}</div>
                        <div className="task-main">
                          <div className="task-title-line"><h4>{task.title}</h4><span className={`status-badge ${task.status}`}>{statusLabel(task.status)}</span></div>
                          <p>{task.next_action || task.notes || 'No next action captured yet.'}</p>
                          <div className="task-meta"><span>{task.proof.length} proof</span><span>Updated {formatDate(task.updated_at)}</span></div>
                        </div>
                        {list.status === 'active' && (
                          <div className="task-commands" onClick={(event) => event.stopPropagation()}>
                            {(task.status === 'pending' || task.status === 'blocked') && <button onClick={() => changeStatus(task, 'in_progress')} disabled={busy}>Start</button>}
                            {task.status !== 'blocked' && task.status !== 'done' && task.status !== 'verified' && <button onClick={() => changeStatus(task, 'blocked')} disabled={busy}>Block</button>}
                            {task.status !== 'done' && task.status !== 'verified' && <button className="done-command" onClick={() => changeStatus(task, 'done')} disabled={busy}>Done</button>}
                          </div>
                        )}
                      </article>
                    ))}
                  </div>
                </section>

                <aside className="inspector">
                  {selectedTask && editDraft ? (
                    <>
                      <div className="inspector-heading">
                        <div><span className={`status-badge ${selectedTask.status}`}>{statusLabel(selectedTask.status)}</span><h3>Task details</h3></div>
                        <button className="close-inspector" onClick={() => setSelectedTaskId('')} aria-label="Close task details">×</button>
                      </div>
                      <form className="detail-form" onSubmit={saveTask}>
                        <label>Title<input value={editDraft.title} onChange={(event) => setEditDraft({ ...editDraft, title: event.target.value })} disabled={list.status === 'archived'} /></label>
                        <div className="form-pair">
                          <label>Priority<select value={editDraft.priority} onChange={(event) => setEditDraft({ ...editDraft, priority: event.target.value as Priority })} disabled={list.status === 'archived'}><option>P0</option><option>P1</option><option>P2</option><option>P3</option></select></label>
                          <label>Status<select value={editDraft.status} onChange={(event) => setEditDraft({ ...editDraft, status: event.target.value as TaskStatus })} disabled={list.status === 'archived'}><option value="pending">Pending</option><option value="in_progress">In progress</option><option value="blocked">Blocked</option><option value="done">Done</option><option value="verified">Verified</option><option value="dropped">Dropped</option></select></label>
                        </div>
                        <label>Next exact action<textarea value={editDraft.next_action} onChange={(event) => setEditDraft({ ...editDraft, next_action: event.target.value })} disabled={list.status === 'archived'} /></label>
                        <label>Notes<textarea value={editDraft.notes} onChange={(event) => setEditDraft({ ...editDraft, notes: event.target.value })} disabled={list.status === 'archived'} /></label>
                        <label>Pablo instruction<textarea value={editDraft.pablo_instruction} onChange={(event) => setEditDraft({ ...editDraft, pablo_instruction: event.target.value })} disabled={list.status === 'archived'} /></label>
                        {list.status === 'active' && <button className="primary-button save-button" disabled={busy || !editDraft.title.trim()}>Save changes</button>}
                      </form>

                      <div className="proof-section">
                        <div className="proof-heading"><span><Icon name="proof" /></span><div><h4>Proof</h4><p>{selectedTask.proof.length} attached</p></div></div>
                        {selectedTask.proof.length > 0 && <ul>{selectedTask.proof.map((proof, index) => <li key={`${proof}-${index}`}>{proof}</li>)}</ul>}
                        {list.status === 'active' && <form onSubmit={addProof}><textarea value={proofText} onChange={(event) => setProofText(event.target.value)} placeholder="Paste evidence, link, ID, or verification note" /><button className="ghost-button" disabled={busy || !proofText.trim()}>Attach proof</button></form>}
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="inspector-heading"><div><span className="section-icon"><Icon name="activity" /></span><h3>Recent activity</h3></div></div>
                      <div className="activity-list">
                        {state.events.length === 0 && <div className="activity-empty">No activity recorded yet.</div>}
                        {[...state.events].reverse().slice(0, 12).map((event) => (
                          <article className="activity-item" key={event.event_id}>
                            <span className="activity-dot" />
                            <div><strong>{eventLabel(event)}</strong><p>{taskFromEvent(event)}</p><small>{formatDate(event.event_time)}</small></div>
                          </article>
                        ))}
                      </div>
                    </>
                  )}
                </aside>
              </div>
            </>
          )}
        </div>

        <footer className="status-footer">
          <span><span className={`status-dot ${state.ok ? 'online' : 'offline'}`} />{state.ok ? 'Canonical state connected' : 'Connection issue'}</span>
          <span>Last sync {formatDate(state.server_time)}</span>
          {notice && <span className={`notice ${noticeKind}`}>{notice}</span>}
        </footer>
      </section>
    </main>
  );
}
