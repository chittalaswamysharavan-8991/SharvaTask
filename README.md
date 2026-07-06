# SharvaTask MCP V2.2 — Milky White Widget Edition

SharvaTask MCP is a Vercel-hosted MCP connector for ChatGPT that stores persistent list/task history in Vercel Blob and renders saved lists as an interactive ChatGPT widget.

V2.2 keeps the working V2.1 backend as-is and focuses on UI/UX polish.

## What V2.2 improves

- Milky white widget theme for better visibility inside ChatGPT dark mode.
- Cleaner widget shell, spacing, borders, shadows, and typography.
- Better header hierarchy with project/status/updated metadata.
- Summary counters for Pending, Blocked, and Done tasks.
- Cleaner task composer with Enter-to-add and disabled Add when empty.
- More readable task rows with larger titles and hidden technical task IDs.
- Sectioned task layout: Pending, Blocked, Done.
- Cleaner Your Lists grid with stats and Open/Continue actions.
- Better empty states, loading/success/error feedback, and mobile responsiveness.
- Shorter tool text output so the widget does the main visual work.

## Endpoints

- Home: `/`
- Health: `/api/health`
- MCP: `/api/mcp`
- MCP alias: `/mcp`

Use this ChatGPT connector URL:

```txt
https://your-project.vercel.app/api/mcp
```

For Sharva's current deployment:

```txt
https://sharvatask.vercel.app/api/mcp
```

## Required environment variables

Vercel Blob must be connected to the project.

Required:

```txt
BLOB_READ_WRITE_TOKEN
```

Optional:

```txt
BLOB_STORE_ID
SHARVATASK_BLOB_PREFIX=sharvatask-v2/events
```

## Install and test locally

```bash
npm install
npm run build
npm run dev
```

Health test:

```txt
http://localhost:3000/api/health
```

Expected version:

```json
"version": "2.4.0-compact-ux"
```

## Deploy

```bash
npx vercel --prod
```

Then reconnect or refresh the ChatGPT connector.

## ChatGPT test prompts

```txt
Show my lists using SharvaTask MCP.
```

```txt
Continue my last list using SharvaTask MCP.
```

```txt
Show the Vercel V2 History Test list using SharvaTask MCP.
```

Expected result: ChatGPT should render a polished milky-white widget card/list, with less duplicate plain text below it.
