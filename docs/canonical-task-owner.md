# SharvaTask canonical ownership contract

SharvaTask is the single canonical owner of SharvaOS lists, tasks, and task history. `SharvaOS-Pulse` owns the daily experience and `sharvaos-app` owns universal capture; both are clients of SharvaTask rather than independent task stores.

The machine-readable boundary is [`contracts/sharvaos-task-owner.v1.json`](../contracts/sharvaos-task-owner.v1.json). Consumers must use the SharvaTask MCP surface, then read the authoritative result back before presenting a mutation as durable. Focused views and offline queues are allowed, but a consumer must not establish a competing task/list source of truth.

## Persistence invariants

This foundation does not migrate or rewrite production data. Existing behavior remains:

- events are stored as private JSON objects in Vercel Blob;
- the default prefix remains `sharvatask-v2/events` (or the existing `SHARVATASK_BLOB_PREFIX` override);
- history is append-only and materialized from the existing event actions;
- the MCP routes remain `/api/mcp` and `/mcp`.

Run `npm run verify:foundation` to detect ownership, tool-surface, persistence, route, package-script, or exact-main-HEAD workflow drift. `npm run verify` includes this check.

## Merge evidence

Every push to `main` runs the read-only `SharvaTask Exact Main HEAD Gate`. It checks out `${{ github.sha }}`, proves that the checkout matches `GITHUB_SHA`, runs the full locked verification suite, and uploads `main-head-evidence.json`. The workflow does not deploy, publish, mutate Blob data, change repository settings, or create a release.
