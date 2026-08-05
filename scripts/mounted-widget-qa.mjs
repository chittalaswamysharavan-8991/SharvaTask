import fs from 'node:fs';
import http from 'node:http';
import { chromium } from 'playwright';

fs.mkdirSync('artifacts/release-gate', { recursive: true });
const widget = fs.readFileSync('src/widget/sharvaTaskWidget.html', 'utf8');
const task = { item_id:'task-qa', title:'Mounted QA task', notes:'Initial', next_action:'', pablo_instruction:'', status:'pending', priority:'P1', proof:[], created_at:new Date().toISOString(), updated_at:new Date().toISOString() };
const state = { view:'list', mode:'list', message:'Mounted QA board', state_version:1, state_version_after:1, sync_status:'fresh', list:{ list_id:'list-qa', title:'Mounted QA list', project:'QA', status:'active', created_at:new Date().toISOString(), updated_at:new Date().toISOString(), items:[task] }, events:[] };
const mock = `<script>window.__calls=[];window.openai={toolOutput:${JSON.stringify(state)},notifyIntrinsicHeight(){},async callTool(name,args){window.__calls.push({name,args});if(name==='edit_task_details'){Object.assign(window.openai.toolOutput.list.items[0],args,{updated_at:new Date().toISOString()});window.openai.toolOutput.state_version=2;return {structuredContent:{...window.openai.toolOutput,task:window.openai.toolOutput.list.items[0],response_type:'mutation_result',mode_recommendation:'task_detail',success:true}};}if(name==='refresh_board_state')return {structuredContent:{...window.openai.toolOutput,response_type:'board_snapshot',mode_recommendation:'board',success:true}};if(name==='get_history')return {structuredContent:{view:'history',message:'History loaded',events:[{event_id:'e1',event_time:new Date().toISOString(),list_id:'list-qa',action:'task_updated',payload:{}}],state_version:2,state_version_after:2,success:true}};throw new Error('Unexpected '+name);}};</script>`;
const html = widget.replace('<script>', mock+'<script>');
const server = http.createServer((req,res)=>{res.writeHead(200,{'content-type':'text/html'});res.end(html);});
await new Promise(r=>server.listen(4173,r));
const browser = await chromium.launch({headless:true});
const results=[];
for (const viewport of [{name:'desktop',width:1280,height:900},{name:'mobile',width:390,height:844}]) {
 const page=await browser.newPage({viewport:{width:viewport.width,height:viewport.height}}); const errors=[]; page.on('console',m=>{if(m.type()==='error')errors.push(m.text())}); page.on('pageerror',e=>errors.push(e.message));
 await page.goto('http://127.0.0.1:4173'); await page.waitForTimeout(300);
 const text=await page.locator('body').innerText(); if(!text.includes('Mounted QA list')) throw new Error(`${viewport.name}: board not rendered`);
 const taskButton=page.getByText('Mounted QA task',{exact:false}).first(); await taskButton.click();
 await page.getByText('Edit',{exact:true}).click();
 const notes=page.locator('textarea').first(); await notes.fill('Browser mounted edit');
 await page.getByText('Save',{exact:true}).click(); await page.waitForTimeout(200);
 const calls=await page.evaluate(()=>window.__calls); if(!calls.some(c=>c.name==='edit_task_details')) throw new Error(`${viewport.name}: save tool not called`);
 const refresh=page.getByText('Refresh',{exact:false}).first(); await refresh.click(); await page.waitForTimeout(200);
 const history=page.getByText('History',{exact:false}).first(); await history.click(); await page.waitForTimeout(200);
 const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>document.documentElement.clientWidth);
 if(overflow) throw new Error(`${viewport.name}: horizontal overflow`); if(errors.length) throw new Error(`${viewport.name}: browser errors ${errors.join(' | ')}`);
 await page.screenshot({path:`artifacts/release-gate/widget-${viewport.name}.png`,fullPage:true}); results.push({viewport,calls,overflow,errors,passed:true}); await page.close();
}
await browser.close(); server.close(); fs.writeFileSync('artifacts/release-gate/mounted-widget-qa.json',JSON.stringify({generated_at:new Date().toISOString(),verdict:'PASS',results},null,2)); console.log(JSON.stringify({verdict:'PASS',viewports:results.length,calls:results.map(r=>r.calls.map(c=>c.name))},null,2));
