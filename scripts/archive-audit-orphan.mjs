import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const endpoint='https://sharvatask.vercel.app/api/mcp';
const listId='LIST-MSINV3J7-LRZ2851A';
const evidence={endpoint,list_id:listId,started_at:new Date().toISOString()};
const client=new Client({name:'sharvatask-audit-cleanup',version:'1.0.0'});
const transport=new StreamableHTTPClientTransport(new URL(endpoint));
function structured(r){if(r?.structuredContent)return r.structuredContent;for(const i of r?.content||[]){if(i?.structuredContent)return i.structuredContent;if(i?.type==='text'){try{return JSON.parse(i.text)}catch{}}}throw new Error(`No structured content: ${JSON.stringify(r).slice(0,800)}`)}
try{
  await client.connect(transport);
  const before=structured(await client.callTool({name:'open_task_board',arguments:{initial_mode:'archive_recovery',list_id:listId,include_archived:true,restore_strategy:'explicit_only'}}));
  evidence.before_status=before?.list?.status;
  if(before?.list?.status!=='archived'){
    const archived=structured(await client.callTool({name:'archive_list',arguments:{list_id_or_query:listId,reason:'Cleanup of disposable release-audit list after intentional surface-test failure'}}));
    assert.equal(archived?.list?.status,'archived','Archive did not return archived state');
    evidence.archive_action=archived.action;
  }else evidence.archive_action='already_archived';
  const after=structured(await client.callTool({name:'open_task_board',arguments:{initial_mode:'archive_recovery',list_id:listId,include_archived:true,restore_strategy:'explicit_only'}}));
  assert.equal(after?.list?.status,'archived','Final cleanup read-back is not archived');
  const history=structured(await client.callTool({name:'get_history',arguments:{list_id_or_query:listId}}));
  evidence.after_status=after.list.status;
  evidence.history_actions=(history.events||[]).map(e=>e.action);
  assert.ok(evidence.history_actions.includes('list_archived'),'Cleanup history missing list_archived');
  evidence.verdict='PASS'; evidence.completed_at=new Date().toISOString();
}catch(error){evidence.verdict='FAIL';evidence.error=String(error?.message||error);evidence.completed_at=new Date().toISOString();throw error}
finally{await mkdir('artifacts/release-gate',{recursive:true});await writeFile('artifacts/release-gate/audit-cleanup.json',JSON.stringify(evidence,null,2));try{await transport.terminateSession?.()}catch{}try{await client.close()}catch{}}
