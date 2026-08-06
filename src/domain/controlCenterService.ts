import {
  browseListsData,
  getHistoryData,
  openTaskBoardData
} from './sharvaTaskService';
import type {
  ListSummary,
  SharvaTaskEvent,
  SharvaTaskList,
  SharvaTaskSyncStatus
} from '../types';

export interface ControlCenterState {
  ok: boolean;
  message: string;
  server_time: string;
  state_version: number;
  sync_status: SharvaTaskSyncStatus;
  list?: SharvaTaskList;
  lists: ListSummary[];
  events: SharvaTaskEvent[];
  system: {
    mcp_endpoint: string;
    storage: string;
    storage_ready: boolean;
    source_of_truth: string;
  };
}

export async function getControlCenterState(listId?: string): Promise<ControlCenterState> {
  try {
    const [board, browser] = await Promise.all([
      openTaskBoardData({
        initial_mode: 'board',
        list_id: listId,
        include_archived: true,
        restore_strategy: 'active_pointer'
      }),
      browseListsData({ status: 'all' })
    ]);

    const list = board.list;
    const history = list
      ? await getHistoryData({ list_id_or_query: list.list_id })
      : undefined;

    return {
      ok: board.success !== false,
      message: board.message,
      server_time: board.server_time || new Date().toISOString(),
      state_version: board.state_version || 0,
      sync_status: board.sync_status || 'fresh',
      list,
      lists: browser.lists || [],
      events: history?.events || [],
      system: {
        mcp_endpoint: '/api/mcp',
        storage: 'Vercel Blob event store',
        storage_ready: Boolean(process.env.BLOB_READ_WRITE_TOKEN),
        source_of_truth: 'sharvatask-v2/events'
      }
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to load SharvaTask state.';
    return {
      ok: false,
      message,
      server_time: new Date().toISOString(),
      state_version: 0,
      sync_status: 'error',
      lists: [],
      events: [],
      system: {
        mcp_endpoint: '/api/mcp',
        storage: 'Vercel Blob event store',
        storage_ready: Boolean(process.env.BLOB_READ_WRITE_TOKEN),
        source_of_truth: 'sharvatask-v2/events'
      }
    };
  }
}
