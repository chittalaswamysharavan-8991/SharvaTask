import { z } from 'zod';
import { createMcpHandler } from 'mcp-handler';
import {
  addProofData,
  addSharvaTaskData,
  archiveSharvaListData,
  browseListsData,
  continueSharvaListData,
  createSharvaListData,
  getBoardSnapshotData,
  getHistoryData,
  getTaskDetailData,
  listAllSharvaListsData,
  openTaskBoardData,
  refreshBoardStateData,
  searchBoardData,
  searchSharvaListsData,
  showHistoryData,
  showSharvaListData,
  updateSharvaTaskStatusData
} from '../../../src/domain/sharvaTaskService';
import { editTaskDetailsData } from '../../../src/domain/taskDetailsService';
import { SHARVATASK_WIDGET_URI, sharvaTaskWidgetHtml } from '../../../src/widget/sharvaTaskWidget';
import type { SharvaTaskWidgetOutput } from '../../../src/types';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const taskStatus = z.enum(['pending', 'in_progress', 'blocked', 'done', 'verified', 'dropped']);
const priority = z.enum(['P0', 'P1', 'P2', 'P3']);
const listStatus = z.enum(['active', 'archived']);
const initialMode = z.enum([
  'board',
  'list_browser',
  'search',
  'history',
  'task_detail',
  'proof_detail',
  'archive_recovery',
  'empty_onboarding',
  'ambiguity_resolution',
  'error_recovery'
]);

const taskItemSchema = z.object({
  item_id: z.string(),
  title: z.string(),
  notes: z.string().optional(),
  next_action: z.string().optional(),
  pablo_instruction: z.string().optional(),
  status: taskStatus,
  priority,
  proof: z.array(z.string()),
  created_at: z.string(),
  updated_at: z.string()
});

const listSchema = z.object({
  list_id: z.string(),
  title: z.string(),
  project: z.string(),
  status: listStatus,
  created_at: z.string(),
  updated_at: z.string(),
  items: z.array(taskItemSchema)
});

const listSummarySchema = z.object({
  list_id: z.string(),
  title: z.string(),
  project: z.string(),
  status: listStatus,
  created_at: z.string(),
  updated_at: z.string(),
  pending_count: z.number(),
  done_count: z.number(),
  blocked_count: z.number(),
  total_count: z.number()
});

const historyEventSchema = z.object({
  event_id: z.string(),
  event_time: z.string(),
  list_id: z.string(),
  action: z.enum(['list_created', 'task_added', 'task_status_updated', 'task_updated', 'task_proof_added', 'list_archived']),
  payload: z.record(z.string(), z.unknown())
});

const ambiguityCandidateSchema = z.object({
  kind: z.enum(['list', 'task']),
  list_id: z.string().optional(),
  item_id: z.string().optional(),
  title: z.string(),
  project: z.string().optional(),
  status: z.string().optional(),
  reason: z.string()
});

const structuredOutputShape = {
  response_type: z.enum([
    'board_snapshot',
    'mutation_result',
    'list_browser',
    'search_results',
    'history',
    'task_detail',
    'ambiguity',
    'error'
  ]).optional(),
  success: z.boolean().optional(),
  action: z.string().optional(),
  request_id: z.string().optional(),
  server_time: z.string().optional(),
  state_version: z.number().optional(),
  state_version_after: z.number().optional(),
  mode_recommendation: initialMode.optional(),
  sync_status: z.enum(['fresh', 'stale', 'conflict', 'error']).optional(),
  error_code: z.enum([
    'LIST_NOT_FOUND',
    'TASK_NOT_FOUND',
    'LIST_AMBIGUOUS',
    'TASK_AMBIGUOUS',
    'DUPLICATE_LIST_CANDIDATE',
    'ARCHIVED_LIST',
    'VALIDATION_ERROR'
  ]).optional(),
  recovery_actions: z.array(z.string()).optional(),
  affected: z.record(z.string(), z.unknown()).optional(),
  active_pointer: z.record(z.string(), z.unknown()).optional(),
  board_snapshot: z.record(z.string(), z.unknown()).optional(),
  ambiguity: z.object({
    error_code: z.string(),
    message: z.string(),
    candidates: z.array(ambiguityCandidateSchema)
  }).optional(),
  duplicate: z.object({
    error_code: z.string(),
    message: z.string(),
    candidates: z.array(ambiguityCandidateSchema)
  }).optional(),
  event: historyEventSchema.optional(),
  view: z.enum(['list', 'lists', 'history', 'message']),
  message: z.string(),
  list: listSchema.optional(),
  lists: z.array(listSummarySchema).optional(),
  events: z.array(historyEventSchema).optional(),
  query: z.string().optional(),
  task: taskItemSchema.optional()
};

const boardShellToolMeta = {
  ui: {
    resourceUri: SHARVATASK_WIDGET_URI,
    visibility: ['model', 'app']
  },
  'openai/outputTemplate': SHARVATASK_WIDGET_URI,
  'openai/widgetAccessible': true,
  'openai/toolInvocation/invoking': 'Opening SharvaTask board…',
  'openai/toolInvocation/invoked': 'SharvaTask board ready'
};

const mutationDataToolMeta = {
  ui: {
    visibility: ['model', 'app']
  },
  'openai/widgetAccessible': true,
  'openai/toolInvocation/invoking': 'Updating SharvaTask state…',
  'openai/toolInvocation/invoked': 'SharvaTask state ready'
};

const internalDataToolMeta = {
  ui: {
    visibility: ['app']
  },
  'openai/widgetAccessible': true,
  'openai/toolInvocation/invoking': 'Loading SharvaTask state…',
  'openai/toolInvocation/invoked': 'SharvaTask state loaded'
};

function widgetResult(result: SharvaTaskWidgetOutput) {
  return {
    structuredContent: result as unknown as Record<string, unknown>,
    content: [{ type: 'text' as const, text: result.message || 'SharvaTask state ready' }]
  };
}

const handler = createMcpHandler(
  (server) => {
    server.registerResource(
      'sharvatask_widget',
      SHARVATASK_WIDGET_URI,
      {
        title: 'SharvaTask board shell',
        description: 'Single SharvaTask board shell with internal modes for board, lists, search, history, task detail, archive, ambiguity, and recovery.',
        mimeType: 'text/html',
        _meta: {
          ui: {
            prefersBorder: true,
            csp: {
              connectDomains: [],
              resourceDomains: []
            }
          },
          'openai/widgetDescription': 'Single live SharvaTask board shell. It updates from structured backend state and keeps lists, search, history, details, archive, and recovery inside one widget.',
          'openai/widgetPrefersBorder': true,
          'openai/widgetCSP': {
            connect_domains: [],
            resource_domains: []
          }
        }
      },
      async (uri) => ({
        contents: [
          {
            uri: uri.toString(),
            mimeType: 'text/html',
            text: sharvaTaskWidgetHtml,
            _meta: {
              ui: {
                prefersBorder: true,
                csp: {
                  connectDomains: [],
                  resourceDomains: []
                }
              },
              'openai/widgetDescription': 'Single live SharvaTask board shell. It updates from structured backend state and keeps lists, search, history, details, archive, and recovery inside one widget.',
              'openai/widgetPrefersBorder': true,
              'openai/widgetCSP': {
                connect_domains: [],
                resource_domains: []
              }
            }
          }
        ]
      })
    );

    server.registerTool(
      'open_task_board',
      {
        title: 'Open SharvaTask board',
        description: 'Opens the single SharvaTask board shell. Use this to mount SharvaTask once for board, lists, search, history, proof/detail, archive, recovery, ambiguity, error, or fresh-chat restore views. This is the only widget-opening tool and it does not create lists or write business history.',
        inputSchema: {
          initial_mode: initialMode.optional().describe('Initial internal board-shell mode.'),
          list_id: z.string().optional().describe('Stable list ID to open if known.'),
          list_query: z.string().optional().describe('List title, project, or query to resolve.'),
          task_id: z.string().optional().describe('Optional stable task ID to focus.'),
          search_query: z.string().optional().describe('Initial search query for search mode.'),
          include_archived: z.boolean().optional().describe('Whether archived lists can be resolved.'),
          restore_strategy: z.enum(['active_pointer', 'latest_business_mutation', 'explicit_only']).optional().describe('Fresh-chat restore strategy.')
        },
        outputSchema: structuredOutputShape,
        annotations: { readOnlyHint: true },
        _meta: boardShellToolMeta
      },
      async (args) => widgetResult(await openTaskBoardData(args))
    );

    server.registerTool(
      'create_list',
      {
        title: 'Create SharvaTask list',
        description: 'Creates a SharvaTask list only after duplicate checks and returns structured create/existing/candidate state for the existing board shell. Does not render, open, mount, or re-render a widget.',
        inputSchema: {
          title: z.string().min(1).describe('List title'),
          project: z.string().optional().describe('Project name, for example SharvaOS, AI Video, Daily Logs')
        },
        outputSchema: structuredOutputShape,
        _meta: mutationDataToolMeta
      },
      async (args) => widgetResult(await createSharvaListData(args))
    );

    server.registerTool(
      'add_task',
      {
        title: 'Add SharvaTask task',
        description: 'Adds a task to a resolved SharvaTask list and returns a structured mutation result plus backend-confirmed board snapshot. Does not render, open, mount, or re-render a widget. Prefer stable list IDs.',
        inputSchema: {
          list_id_or_query: z.string().optional().describe('List ID, title, or project. Omit to use latest active list.'),
          title: z.string().min(1).describe('Task title'),
          notes: z.string().optional().describe('Optional task notes'),
          priority: priority.optional().describe('Priority: P0, P1, P2, or P3')
        },
        outputSchema: structuredOutputShape,
        _meta: mutationDataToolMeta
      },
      async (args) => widgetResult(await addSharvaTaskData(args))
    );

    server.registerTool(
      'update_task_status',
      {
        title: 'Update SharvaTask task status',
        description: 'Updates a task status by stable task ID when possible and returns a structured mutation result plus board snapshot. If title/query is ambiguous, returns structured candidates instead of guessing. Does not render, open, mount, or re-render a widget.',
        inputSchema: {
          list_id_or_query: z.string().optional().describe('List ID, title, or project. Omit to use latest active list.'),
          item_id_or_title: z.string().min(1).describe('Task ID or task title search text'),
          status: taskStatus.describe('New task status'),
          notes: z.string().optional().describe('Optional status note')
        },
        outputSchema: structuredOutputShape,
        _meta: mutationDataToolMeta
      },
      async (args) => widgetResult(await updateSharvaTaskStatusData(args))
    );

    server.registerTool(
      'edit_task_details',
      {
        title: 'Edit SharvaTask task details',
        description: 'Updates editable task details such as title, notes, next action, Pablo instruction, priority, or status and returns structured data for the existing board shell. Does not render, open, mount, or re-render a widget. Prefer stable task IDs. If title/query is ambiguous, returns structured candidates instead of guessing.',
        inputSchema: {
          list_id_or_query: z.string().optional().describe('List ID, title, or project. Omit to use latest active list.'),
          item_id_or_title: z.string().min(1).describe('Required task ID or task title search text. Stable task ID is preferred.'),
          title: z.string().optional().describe('New task title. Empty title is rejected.'),
          notes: z.string().optional().describe('Task notes. Empty string clears notes.'),
          next_action: z.string().optional().describe('Next action. Empty string clears next action.'),
          pablo_instruction: z.string().optional().describe('Instruction/context for Pablo. Empty string clears it.'),
          priority: priority.optional().describe('Priority: P0, P1, P2, or P3'),
          status: taskStatus.optional().describe('Optional task status update')
        },
        outputSchema: structuredOutputShape,
        _meta: mutationDataToolMeta
      },
      async (args) => widgetResult(await editTaskDetailsData(args))
    );

    server.registerTool(
      'update_task',
      {
        title: 'Edit SharvaTask task (internal)',
        description: 'Internal/app-only compatibility edit action for the mounted SharvaTask board shell. Routes to the same backend path as edit_task_details and returns structured state. Does not render, open, mount, or re-render a widget.',
        inputSchema: {
          list_id_or_query: z.string().optional().describe('List ID, title, or project. Omit to use latest active list.'),
          item_id_or_title: z.string().min(1).describe('Task ID or task title search text'),
          title: z.string().optional().describe('New task title'),
          notes: z.string().optional().describe('New task notes'),
          next_action: z.string().optional().describe('Next action'),
          pablo_instruction: z.string().optional().describe('Instruction/context for Pablo'),
          priority: priority.optional().describe('Priority: P0, P1, P2, or P3'),
          status: taskStatus.optional().describe('Optional task status update')
        },
        outputSchema: structuredOutputShape,
        _meta: internalDataToolMeta
      },
      async (args) => widgetResult(await editTaskDetailsData(args))
    );

    server.registerTool(
      'add_proof',
      {
        title: 'Add SharvaTask proof',
        description: 'Attaches proof to a stable task and returns structured proof result plus board/proof-detail state. Does not show, render, open, mount, or re-render a widget.',
        inputSchema: {
          list_id_or_query: z.string().optional().describe('List ID, title, or project. Omit to use latest active list.'),
          item_id_or_title: z.string().min(1).describe('Task ID or task title search text'),
          proof: z.string().min(1).describe('Proof note, link, screenshot description, or test result')
        },
        outputSchema: structuredOutputShape,
        _meta: mutationDataToolMeta
      },
      async (args) => widgetResult(await addProofData(args))
    );

    server.registerTool(
      'archive_list',
      {
        title: 'Archive SharvaTask list',
        description: 'Archives a list, preserves business history, and returns structured archive recovery/browser state. Requires confirmation in UX. Does not render, open, mount, or re-render a widget.',
        inputSchema: {
          list_id_or_query: z.string().min(1).describe('List ID, title, or project'),
          reason: z.string().optional().describe('Optional archive reason')
        },
        outputSchema: structuredOutputShape,
        annotations: { destructiveHint: false },
        _meta: mutationDataToolMeta
      },
      async (args) => widgetResult(await archiveSharvaListData(args))
    );

    server.registerTool(
      'get_board_snapshot',
      {
        title: 'Get SharvaTask board snapshot',
        description: 'App/internal data tool for the mounted SharvaTask board shell. Returns a canonical board snapshot for a resolved list/context. Does not render, open, mount, or re-render a widget. Does not write business history.',
        inputSchema: {
          list_id_or_query: z.string().optional().describe('List ID, title, or project. Omit to use latest active list.'),
          include_archived: z.boolean().optional().describe('Whether archived lists can be resolved.')
        },
        outputSchema: structuredOutputShape,
        annotations: { readOnlyHint: true },
        _meta: internalDataToolMeta
      },
      async (args) => widgetResult(await getBoardSnapshotData(args))
    );

    server.registerTool(
      'browse_lists',
      {
        title: 'Browse SharvaTask lists',
        description: 'App/internal data tool for the mounted SharvaTask board shell List Browser mode. Returns active/archived list summaries. Does not render, open, mount, or re-render a widget. Does not write business history.',
        inputSchema: {
          project: z.string().optional().describe('Optional project filter'),
          status: z.enum(['active', 'archived', 'all']).optional().describe('List status filter')
        },
        outputSchema: structuredOutputShape,
        annotations: { readOnlyHint: true },
        _meta: internalDataToolMeta
      },
      async (args) => widgetResult(await browseListsData(args))
    );

    server.registerTool(
      'search_board',
      {
        title: 'Search SharvaTask board',
        description: 'App/internal data tool for the mounted SharvaTask board shell Search mode. Returns grouped search results across lists, tasks, notes, and history. Does not render, open, mount, or re-render a widget. Does not write business history.',
        inputSchema: {
          query: z.string().min(1).describe('Search keyword')
        },
        outputSchema: structuredOutputShape,
        annotations: { readOnlyHint: true },
        _meta: internalDataToolMeta
      },
      async (args) => widgetResult(await searchBoardData(args))
    );

    server.registerTool(
      'get_history',
      {
        title: 'Get SharvaTask history',
        description: 'App/internal data tool for the mounted SharvaTask board shell History mode. Returns business history entries only. Does not render, open, mount, or re-render a widget. Does not create view-history events.',
        inputSchema: {
          list_id_or_query: z.string().optional().describe('List ID, title, or project. Omit to use latest active list.')
        },
        outputSchema: structuredOutputShape,
        annotations: { readOnlyHint: true },
        _meta: internalDataToolMeta
      },
      async (args) => widgetResult(await getHistoryData(args))
    );

    server.registerTool(
      'get_task_detail',
      {
        title: 'Get SharvaTask task detail',
        description: 'App/internal data tool for the mounted SharvaTask board shell detail/proof mode. Returns task, proof, and related event detail. Does not render, open, mount, or re-render a widget.',
        inputSchema: {
          list_id_or_query: z.string().optional().describe('List ID, title, or project. Omit to use latest active list.'),
          item_id_or_title: z.string().min(1).describe('Task ID or task title search text')
        },
        outputSchema: structuredOutputShape,
        annotations: { readOnlyHint: true },
        _meta: internalDataToolMeta
      },
      async (args) => widgetResult(await getTaskDetailData(args))
    );

    server.registerTool(
      'refresh_board_state',
      {
        title: 'Refresh SharvaTask board state',
        description: 'App/internal data tool for the mounted SharvaTask board shell. Returns latest backend-confirmed state for the current shell context. Does not render, open, mount, or re-render a widget. Does not write refresh events to business history.',
        inputSchema: {
          list_id_or_query: z.string().optional().describe('List ID, title, or project. Omit to use latest active list.')
        },
        outputSchema: structuredOutputShape,
        annotations: { readOnlyHint: true },
        _meta: internalDataToolMeta
      },
      async (args) => widgetResult(await refreshBoardStateData(args))
    );

    server.registerTool(
      'show_list',
      {
        title: 'Show SharvaTask list (compatibility)',
        description: 'Compatibility alias for the mounted board shell. Prefer open_task_board for user-facing display or get_board_snapshot for app data. No output template and no widget mount.',
        inputSchema: {
          list_id_or_query: z.string().optional().describe('List ID, title, or project. Omit to show latest active list.')
        },
        outputSchema: structuredOutputShape,
        annotations: { readOnlyHint: true },
        _meta: internalDataToolMeta
      },
      async (args) => widgetResult(await showSharvaListData(args))
    );

    server.registerTool(
      'list_all',
      {
        title: 'List all SharvaTask lists (compatibility)',
        description: 'Compatibility alias for the mounted board shell List Browser mode. Prefer open_task_board(initial_mode=list_browser) for model intent or browse_lists for app data. No output template and no widget mount.',
        inputSchema: {
          project: z.string().optional().describe('Optional project filter'),
          status: z.enum(['active', 'archived', 'all']).optional().describe('List status filter')
        },
        outputSchema: structuredOutputShape,
        annotations: { readOnlyHint: true },
        _meta: internalDataToolMeta
      },
      async (args) => widgetResult(await listAllSharvaListsData(args))
    );

    server.registerTool(
      'search_lists',
      {
        title: 'Search SharvaTask lists (compatibility)',
        description: 'Compatibility alias for the mounted board shell Search mode. Prefer open_task_board(initial_mode=search) for model intent or search_board for app data. No output template and no widget mount.',
        inputSchema: {
          query: z.string().min(1).describe('Search keyword')
        },
        outputSchema: structuredOutputShape,
        annotations: { readOnlyHint: true },
        _meta: internalDataToolMeta
      },
      async (args) => widgetResult(await searchSharvaListsData(args))
    );

    server.registerTool(
      'continue_list',
      {
        title: 'Continue SharvaTask list (compatibility)',
        description: 'Compatibility alias for restore/continue behavior inside the mounted board shell. Prefer open_task_board(initial_mode=board, restore_strategy=active_pointer). No output template and no widget mount.',
        inputSchema: {
          project_or_query: z.string().optional().describe('Optional project, title, or keyword')
        },
        outputSchema: structuredOutputShape,
        annotations: { readOnlyHint: true },
        _meta: internalDataToolMeta
      },
      async (args) => widgetResult(await continueSharvaListData(args))
    );

    server.registerTool(
      'show_history',
      {
        title: 'Show SharvaTask history (compatibility)',
        description: 'Compatibility alias for History mode inside the mounted board shell. Prefer open_task_board(initial_mode=history) for model intent or get_history for app data. No output template and no widget mount.',
        inputSchema: {
          list_id_or_query: z.string().optional().describe('List ID, title, or project. Omit to use latest active list.')
        },
        outputSchema: structuredOutputShape,
        annotations: { readOnlyHint: true },
        _meta: internalDataToolMeta
      },
      async (args) => widgetResult(await showHistoryData(args))
    );
  },
  {
    serverInfo: {
      name: 'SharvaTask MCP',
      version: '2.6.0-phase-f-edit-task-details'
    }
  },
  { basePath: '/api' }
);

export { handler as GET, handler as POST, handler as DELETE };
