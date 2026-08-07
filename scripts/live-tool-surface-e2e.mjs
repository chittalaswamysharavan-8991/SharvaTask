import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const endpoint='https://sharvatask.vercel.app/api/mcp';
const runId=process.env.GITHUB_RUN_ID||String(Date.now());
const tag=`SURFACE-${runId}-${Date.now()}`;
const listTitle=`Disposable ${tag}`;
const project=`Release Surface ${tag}`;
const taskTitle=`Task ${tag}`;
const proofText=`Proof ${tag}`;
const evidence={endpoint,run_id:runId,tag,started_at:new Date().toISOString(),steps:[]};
const client=new Client({name:'sharvatask-tool-surface-audit',version:'1.0.0'});
const transport=new StreamableHTTPClientTransport(new URL(endpoint));

function structured(result){
  if(result?.structuredContent&&typeof result.structuredContent==='object')return result.structuredContent;
  for(const item of result?.content||[]){
    if(item?.structuredContent&&typeof item.structuredContent==='object')return item.structuredContent;
    if(item?.type==='text'&&typeof item.text==='string'){try{const parsed=JSON.parse(item.text);if(parsed&&typeof parsed==='object')return parsed}catch{}}
  }
  throw new Error(`Missing structuredContent: ${JSON.stringify(result).slice(0,800)}`);
}
async function call(name,args){const output=structured(await client.callTool({name,arguments:args}));evidence.steps.push({name,success:output.success,response_type:output.response_type,view:output.view,action:output.action,error_code:output.error_code});return output}
function hasList(o,id){return o?.list?.list_id===id||(o?.lists||[]).some(x=>x.list_id===id)}
function hasTaskResult(o,id){return (o?.task_results||[]).some(x=>(x.task?.item_id||x.task?.task_id)===id)}

try{
  await client.connect(transport);
  evidence.server_version=client.getServerVersion?.();
  const tools=await client.listTools(); evidence.tool_names=(tools.tools||[]).map(t=>t.name);
  const expected=['open_task_board','create_list','add_task','update_task_status','edit_task_details','update_task','add_proof','archive_list','get_board_snapshot','browse_lists','search_board','get_history','get_task_detail','refresh_board_state','show_list','list_all','search_lists','continue_list','show_history'];
  for(const name of expected)assert.ok(evidence.tool_names.includes(name),`Missing tool ${name}`);

  const created=await call('create_list',{title:listTitle,project}); assert.equal(created.success,true); const listId=created.list?.list_id||created.affected?.list_id; assert.ok(listId); evidence.list_id=listId;
  const added=await call('add_task',{list_id_or_query:listId,title:taskTitle,notes:'Surface audit',priority:'P1'}); assert.equal(added.success,true); const taskId=added.affected?.task_id; assert.ok(taskId); evidence.task_id=taskId;

  for(const [name,args] of [
    ['get_board_snapshot',{list_id_or_query:listId}],
    ['show_list',{list_id_or_query:listId}],
    ['browse_lists',{project,status:'active'}],
    ['list_all',{project,status:'active'}],
    ['continue_list',{project_or_query:listTitle}]
  ]){const o=await call(name,args);assert.equal(o.success,true,`${name} failed`);assert.ok(hasList(o,listId),`${name} did not resolve audit list`)}

  const search=await call('search_board',{query:taskTitle}); assert.equal(search.success,true,'search_board failed'); assert.equal(search.response_type,'search_results'); assert.ok(hasTaskResult(search,taskId),'search_board did not return matching task_results');
  const searchCompat=await call('search_lists',{query:listTitle}); assert.equal(searchCompat.success,true,'search_lists failed'); assert.ok(hasList(searchCompat,listId),'search_lists did not return list');

  const detail=await call('get_task_detail',{list_id_or_query:listId,item_id_or_title:taskId}); assert.equal(detail.task?.item_id,taskId,'get_task_detail wrong task');
  const board=await call('open_task_board',{initial_mode:'board',list_id:listId,restore_strategy:'explicit_only'}); assert.ok(hasList(board,listId),'open_task_board board failed');
  const routedSearch=await call('open_task_board',{initial_mode:'search',list_id:listId,search_query:taskTitle,restore_strategy:'explicit_only'}); assert.ok(hasTaskResult(routedSearch,taskId),'open_task_board search did not return task');
  const routedDetail=await call('open_task_board',{initial_mode:'task_detail',list_id:listId,task_id:taskId,restore_strategy:'explicit_only'}); assert.equal(routedDetail.task?.item_id,taskId,'open_task_board task_detail failed');

  const compatEdit=await call('update_task',{list_id_or_query:listId,item_id_or_title:taskId,notes:'Compatibility edit verified',priority:'P0'}); assert.equal(compatEdit.success,true,'update_task compatibility failed');
  const proof=await call('add_proof',{list_id_or_query:listId,item_id_or_title:taskId,proof:proofText}); assert.equal(proof.success,true);
  const proofDetail=await call('open_task_board',{initial_mode:'proof_detail',list_id:listId,task_id:taskId,proof_index:0,restore_strategy:'explicit_only'}); assert.equal(proofDetail.selected_proof,proofText,'proof_detail route failed');
  const status=await call('update_task_status',{list_id_or_query:listId,item_id_or_title:taskId,status:'done'}); assert.equal(status.success,true);
  const refreshed=await call('refresh_board_state',{list_id_or_query:listId}); assert.equal(refreshed.list?.items?.find(x=>x.item_id===taskId)?.status,'done','refresh state failed');
  const history=await call('get_history',{list_id_or_query:listId}); assert.ok((history.events||[]).length>=5,'get_history missing events');
  const historyCompat=await call('show_history',{list_id_or_query:listId}); assert.ok((historyCompat.events||[]).length>=5,'show_history missing events');

  const archived=await call('archive_list',{list_id_or_query:listId,reason:`Surface audit ${tag}`}); assert.equal(archived.list?.status,'archived');
  const archiveView=await call('open_task_board',{initial_mode:'archive_recovery',list_id:listId,include_archived:true,restore_strategy:'explicit_only'}); assert.equal(archiveView.list?.status,'archived');
  const archivedBrowse=await call('browse_lists',{project,status:'archived'}); assert.ok(hasList(archivedBrowse,listId),'browse_lists archived did not return list');
  evidence.verdict='PASS'; evidence.completed_at=new Date().toISOString();
}catch(error){evidence.verdict='FAIL';evidence.completed_at=new Date().toISOString();evidence.error={message:String(error?.message||error),stack:error?.stack};throw error}
finally{await mkdir('artifacts/release-gate',{recursive:true});await writeFile('artifacts/release-gate/live-tool-surface-e2e.json',JSON.stringify(evidence,null,2));try{await transport.terminateSession?.()}catch{}try{await client.close()}catch{}}
