import { z } from 'zod';
import { createMcpHandler } from 'mcp-handler';
import {
  addProofData,
  addSharvaTaskData,
  archiveSharvaListData,
  continueSharvaListData,
  createSharvaListData,
  listAllSharvaListsData,
  searchSharvaListsData,
  showHistoryData,
  showSharvaListData,
  updateSharvaTaskStatusData,
  updateSharvaTaskData
} from '../../../src/domain/sharvaTaskService';
import { SHARVATASK_WIDGET_URI, sharvaTaskWidgetHtml } from '../../../src/widget/sharvaTaskWidget';
import type { SharvaTaskWidgetOutput } from '../../../src/types';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const taskStatus = z.enum(['pending', 'in_progress', 'blocked', 'done', 'verified', 'dropped']);
const priority = z.enum(['P0', 'P1', 'P2', 'P3']);
const listStatus = z.enum(['active', 'archived']);

const taskItemSchema = z.object({
  item_id: z.string(),
  title: z.string(),
  notes: z.string().optional(),
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
  action: z.enum(['list_created', 'task_added', 'task_status_updated', 'task_proof_added', 'list_archived']),
  payload: z.record(z.string(), z.unknown())
});

const widgetOutputShape = {
  view: z.enum(['list', 'lists', 'history', 'message']),
  message: z.string(),
  list: listSchema.optional(),
  lists: z.array(listSummarySchema).optional(),
  events: z.array(historyEventSchema).optional(),
  query: z.string().optional()
};

const widgetToolMeta = {
  ui: {
    resourceUri: SHARVATASK_WIDGET_URI,
    visibility: ['model', 'app']
  },
  'openai/outputTemplate': SHARVATASK_WIDGET_URI,
  'openai/widgetAccessible': true,
  'openai/toolInvocation/invoking': 'Updating SharvaTask…',
  'openai/toolInvocation/invoked': 'SharvaTask updated'
};

function widgetResult(result: SharvaTaskWidgetOutput) {
  const conciseText = result.view === 'lists'
    ? 'Lists updated ✅'
    : result.view === 'history'
      ? 'History updated ✅'
      : result.view === 'list'
        ? 'List updated ✅'
        : result.message;

  return {
    structuredContent: result as unknown as Record<string, unknown>,
    content: [{ type: 'text' as const, text: conciseText }]
  };
}

const handler = createMcpHandler(
  (server) => {
    server.registerResource(
      'sharvatask_widget',
      SHARVATASK_WIDGET_URI,
      {
        title: 'SharvaTask interactive list widget',
        description: 'Interactive SharvaTask list UI with add, done, block, archive, refresh, and history actions.',
        mimeType: 'text/html',
        _meta: {
          ui: {
            prefersBorder: true,
            csp: {
              connectDomains: [],
              resourceDomains: []
            }
          },
          'openai/widgetDescription': 'Interactive SharvaTask list and task-history widget. Use it to manage saved lists directly inside ChatGPT.',
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
              'openai/widgetDescription': 'Interactive SharvaTask list and task-history widget. Use it to manage saved lists directly inside ChatGPT.',
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
      'create_list',
      {
        title: 'Create SharvaTask list',
        description: 'Create a persistent SharvaTask list with history across ChatGPT chats and render it as an interactive widget.',
        inputSchema: {
          title: z.string().min(1).describe('List title'),
          project: z.string().optional().describe('Project name, for example SharvaOS, AI Video, Daily Logs')
        },
        outputSchema: widgetOutputShape,
        _meta: widgetToolMeta
      },
      async (args) => widgetResult(await createSharvaListData(args))
    );

    server.registerTool(
      'add_task',
      {
        title: 'Add SharvaTask task',
        description: 'Add a task to a matching list. If list_id_or_query is omitted, the latest active list is used.',
        inputSchema: {
          list_id_or_query: z.string().optional().describe('List ID, title, or project. Omit to use latest active list.'),
          title: z.string().min(1).describe('Task title'),
          notes: z.string().optional().describe('Optional task notes'),
          priority: priority.optional().describe('Priority: P0, P1, P2, or P3')
        },
        outputSchema: widgetOutputShape,
        _meta: widgetToolMeta
      },
      async (args) => widgetResult(await addSharvaTaskData(args))
    );

    server.registerTool(
      'update_task_status',
      {
        title: 'Update SharvaTask task status',
        description: 'Update a task status using task ID or task title search, then re-render the interactive list widget.',
        inputSchema: {
          list_id_or_query: z.string().optional().describe('List ID, title, or project. Omit to use latest active list.'),
          item_id_or_title: z.string().min(1).describe('Task ID or task title search text'),
          status: taskStatus.describe('New task status'),
          notes: z.string().optional().describe('Optional status note')
        },
        outputSchema: widgetOutputShape,
        _meta: widgetToolMeta
      },
      async (args) => widgetResult(await updateSharvaTaskStatusData(args))
    );


    server.registerTool(
      'update_task',
      {
        title: 'Edit SharvaTask task',
        description: 'Edit a task title, notes, or priority from the SharvaTask widget, then re-render the updated list.',
        inputSchema: {
          list_id_or_query: z.string().optional().describe('List ID, title, or project. Omit to use latest active list.'),
          item_id_or_title: z.string().min(1).describe('Task ID or task title search text'),
          title: z.string().optional().describe('New task title'),
          notes: z.string().optional().describe('New task notes'),
          priority: priority.optional().describe('Priority: P0, P1, P2, or P3')
        },
        outputSchema: widgetOutputShape,
        _meta: widgetToolMeta
      },
      async (args) => widgetResult(await updateSharvaTaskData(args))
    );

    server.registerTool(
      'add_proof',
      {
        title: 'Add SharvaTask proof',
        description: 'Attach proof text/link/screenshot note to a task, then show the updated list widget.',
        inputSchema: {
          list_id_or_query: z.string().optional().describe('List ID, title, or project. Omit to use latest active list.'),
          item_id_or_title: z.string().min(1).describe('Task ID or task title search text'),
          proof: z.string().min(1).describe('Proof note, link, screenshot description, or test result')
        },
        outputSchema: widgetOutputShape,
        _meta: widgetToolMeta
      },
      async (args) => widgetResult(await addProofData(args))
    );

    server.registerTool(
      'show_list',
      {
        title: 'Show SharvaTask list',
        description: 'Show one list with all tasks, status, proof counts, metadata, and the interactive widget UI.',
        inputSchema: {
          list_id_or_query: z.string().optional().describe('List ID, title, or project. Omit to show latest active list.')
        },
        outputSchema: widgetOutputShape,
        annotations: { readOnlyHint: true },
        _meta: widgetToolMeta
      },
      async (args) => widgetResult(await showSharvaListData(args))
    );

    server.registerTool(
      'list_all',
      {
        title: 'List all SharvaTask lists',
        description: 'Show summaries of SharvaTask lists, optionally filtered by project and status, in an interactive list browser widget.',
        inputSchema: {
          project: z.string().optional().describe('Optional project filter'),
          status: z.enum(['active', 'archived', 'all']).optional().describe('List status filter')
        },
        outputSchema: widgetOutputShape,
        annotations: { readOnlyHint: true },
        _meta: widgetToolMeta
      },
      async (args) => widgetResult(await listAllSharvaListsData(args))
    );

    server.registerTool(
      'search_lists',
      {
        title: 'Search SharvaTask lists',
        description: 'Search list titles, projects, list IDs, task titles, and notes. Results render as an interactive list browser widget.',
        inputSchema: {
          query: z.string().min(1).describe('Search keyword')
        },
        outputSchema: widgetOutputShape,
        annotations: { readOnlyHint: true },
        _meta: widgetToolMeta
      },
      async (args) => widgetResult(await searchSharvaListsData(args))
    );

    server.registerTool(
      'continue_list',
      {
        title: 'Continue SharvaTask list',
        description: 'Continue the latest active list, optionally narrowed by project or keyword, and render it as an interactive widget.',
        inputSchema: {
          project_or_query: z.string().optional().describe('Optional project, title, or keyword')
        },
        outputSchema: widgetOutputShape,
        _meta: widgetToolMeta
      },
      async (args) => widgetResult(await continueSharvaListData(args))
    );

    server.registerTool(
      'show_history',
      {
        title: 'Show SharvaTask history',
        description: 'Show full event history/change log for a list in the interactive history widget.',
        inputSchema: {
          list_id_or_query: z.string().optional().describe('List ID, title, or project. Omit to use latest active list.')
        },
        outputSchema: widgetOutputShape,
        annotations: { readOnlyHint: true },
        _meta: widgetToolMeta
      },
      async (args) => widgetResult(await showHistoryData(args))
    );

    server.registerTool(
      'archive_list',
      {
        title: 'Archive SharvaTask list',
        description: 'Archive a list while preserving its history, then render the archived list widget.',
        inputSchema: {
          list_id_or_query: z.string().min(1).describe('List ID, title, or project'),
          reason: z.string().optional().describe('Optional archive reason')
        },
        outputSchema: widgetOutputShape,
        annotations: { destructiveHint: false },
        _meta: widgetToolMeta
      },
      async (args) => widgetResult(await archiveSharvaListData(args))
    );
  },
  {
    serverInfo: {
      name: 'SharvaTask MCP',
      version: '2.4.0-compact-ux'
    }
  },
  { basePath: '/api' }
);

export { handler as GET, handler as POST, handler as DELETE };
