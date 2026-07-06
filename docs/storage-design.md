# SharvaTask MCP V2 Storage Design

## Why not local JSON?

Vercel Functions do not provide normal persistent writable project files. Therefore V1-style local JSON storage is not reliable on Vercel.

## Why Vercel Blob?

Vercel Blob is available on all plans and can persist data separately from the function runtime.

## Event-sourced storage

Instead of overwriting a single JSON file, V2 stores one event per change.

Examples:

```text
list_created
task_added
task_status_updated
task_proof_added
list_archived
```

The current list state is rebuilt by reading events and applying them in time order.

## Benefits

- Preserves full history.
- Avoids local filesystem problem.
- Makes `show_history` natural.
- Survives redeploys.
- Avoids overwriting same blob repeatedly.

## Tradeoff

Reading lists requires listing and reading event files. This uses Blob operations. On Hobby this is okay for light personal usage, but heavy usage may hit free limits and pause Blob access until the next cycle.
