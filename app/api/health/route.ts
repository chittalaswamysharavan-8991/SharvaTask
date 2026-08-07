export const dynamic = 'force-dynamic';

export async function GET() {
  return Response.json({
    ok: true,
    name: 'SharvaTask MCP',
    version: '2.6.0-phase-f-edit-task-details',
    mcp_path: '/api/mcp',
    alias_mcp_path: '/mcp',
    widget: 'ui://widget/sharvatask-v2-4-clean.html',
    storage: 'Vercel Blob event store',
    prefix: process.env.SHARVATASK_BLOB_PREFIX || 'sharvatask-v2/events',
    has_blob_store_id: Boolean(process.env.BLOB_STORE_ID),
    has_blob_read_write_token: Boolean(process.env.BLOB_READ_WRITE_TOKEN)
  });
}
