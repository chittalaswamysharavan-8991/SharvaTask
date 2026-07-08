export const dynamic = 'force-dynamic';

export async function GET() {
  return Response.json({
    ok: true,
    name: 'SharvaTask MCP',
    version: '2.4.0-compact-ux',
    mcp_path: '/api/mcp',
    alias_mcp_path: '/mcp',
    widget: 'ui://widget/sharvatask-v2-4-clickdiag.html',
    storage: 'Vercel Blob event store',
    prefix: process.env.SHARVATASK_BLOB_PREFIX || 'sharvatask-v2/events',
    has_blob_store_id: Boolean(process.env.BLOB_STORE_ID),
    has_blob_read_write_token: Boolean(process.env.BLOB_READ_WRITE_TOKEN)
  });
}
