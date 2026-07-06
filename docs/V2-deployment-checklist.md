# SharvaTask MCP V2 Deployment Checklist

## Pre-deploy

- [ ] Confirm Vercel account is Hobby/free.
- [ ] Do not start Pro trial.
- [ ] Do not add paid VPS.
- [ ] Confirm project name: `SharvaTask-MCP-Vercel-V2`.

## Vercel project

- [ ] Import project into Vercel.
- [ ] Deploy once.
- [ ] Open `/api/health`.

## Blob storage

- [ ] Project → Storage.
- [ ] Create Database → Blob.
- [ ] Select Private storage.
- [ ] Connect Blob store to this project.
- [ ] Redeploy if needed.
- [ ] Confirm `/api/health` shows `has_blob_store_id: true` or `has_blob_read_write_token: true`.

## ChatGPT connector

- [ ] Developer mode ON.
- [ ] Create connector.
- [ ] Name: `SharvaTask MCP V2`.
- [ ] URL: `https://your-project.vercel.app/api/mcp`.
- [ ] Save/connect.

## Success test

- [ ] Create list from ChatGPT.
- [ ] Add task.
- [ ] Show list.
- [ ] Open new chat.
- [ ] Continue last list.
- [ ] Show history.
