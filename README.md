# TaskState MCP

**Persistent work-state infrastructure for AI assistants.**

TaskState MCP is a Vercel-hosted MCP connector that gives AI assistants a durable task system instead of relying on chat memory. It stores lists, tasks, proof, status changes, and append-only history in Vercel Blob, then exposes that state through MCP tools and an interactive ChatGPT widget.

It began as a real internal operations system and is designed around a broader business problem: AI assistants need a reliable, authoritative work-state layer that survives across conversations and can be read back after every mutation.

## Business use cases

- Internal AI copilots that need persistent task state
- Operations and project execution queues
- Support and escalation workflows
- Client-delivery tracking
- Human-in-the-loop automation with proof and audit history
- AI agents that must verify durable state after writes

## Core capabilities

- Create and manage persistent lists and tasks
- Update status, priority, notes, next action, and operator instructions
- Attach proof or verification notes to tasks
- Preserve append-only business history
- Search, browse, restore, and inspect task state
- Render the same backend state in a ChatGPT widget and protected web control center
- Read back authoritative state after mutations instead of treating a request as proof of persistence

## Architecture

```text
AI assistant / ChatGPT
        |
        v
   TaskState MCP
   /api/mcp  +  /mcp
        |
        +---- MCP tools
        +---- interactive widget
        +---- protected web control center
        |
        v
   Vercel Blob
   append-only event history
```

### Persistence

Production task history is stored as private JSON event objects in Vercel Blob and materialized into current list/task state. The event model preserves list creation, task creation, status changes, edits, proof additions, and archival history.

### Compatibility note

The public product name is **TaskState MCP**. Some internal identifiers, environment variables, widget URIs, storage prefixes, and the current GitHub repository slug still use the legacy `SharvaTask` / `sharvatask` identifier. They are intentionally retained where changing them could break persisted data, cached widget descriptors, integrations, or deployment compatibility.

## Endpoints

- Web control center: `/`
- Health: `/api/health`
- MCP: `/api/mcp`
- MCP alias: `/mcp`

Current deployment:

```txt
https://sharvatask.vercel.app
```

Current MCP endpoint:

```txt
https://sharvatask.vercel.app/api/mcp
```

The deployment hostname is a legacy infrastructure identifier; the product-facing brand is TaskState MCP.

## Required environment variables

Vercel Blob must be connected to the project.

Required:

```txt
BLOB_READ_WRITE_TOKEN
```

Optional legacy-compatible variables:

```txt
BLOB_STORE_ID
SHARVATASK_BLOB_PREFIX=sharvatask-v2/events
```

Do not rename the production Blob prefix merely for branding. Existing event history must remain readable.

## Install and verify locally

```bash
npm install
npm run verify
npm run build
npm run dev
```

Health test:

```txt
http://localhost:3000/api/health
```

## Verification philosophy

A successful request is not treated as durable proof by itself. TaskState MCP is designed around authoritative read-back: after a mutation, the system returns backend-confirmed state so the caller can verify what actually persisted.

The repository includes descriptor, typecheck, build, test, widget, foundation-contract, and exact-main-HEAD verification gates.

## Internal ownership

Within SharvaOS, this repository remains the canonical owner of lists, tasks, and task history. SharvaOS-Pulse and `sharvaos-app` may provide focused views or capture flows, but they must read and write through this service rather than establish competing task stores. See [`docs/canonical-task-owner.md`](docs/canonical-task-owner.md).

That internal ownership contract is implementation context. The portfolio-facing product story is broader: **TaskState MCP is a persistent work-state connector for AI-assisted operations.**
