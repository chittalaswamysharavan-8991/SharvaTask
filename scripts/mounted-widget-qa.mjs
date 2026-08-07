import fs from 'node:fs';
import http from 'node:http';
import { chromium } from 'playwright';

fs.mkdirSync('artifacts/release-gate', { recursive: true });

const rawWidget = fs.readFileSync('src/widget/sharvaTaskWidget.html', 'utf8');
const presentation = JSON.parse(fs.readFileSync('src/widget/userFacingWidget.json', 'utf8'));
let widget = rawWidget.replace('</style>', `${presentation.style}\n</style>`);
for (const [technicalCopy, userCopy] of presentation.replacements) {
  widget = widget.split(technicalCopy).join(userCopy);
}

const task = {
  item_id: 'task-qa',
  title: 'Verify add task updates same widget',
  notes: 'Mounted routing QA',
  next_action: 'Confirm the selected task remains focused',
  pablo_instruction: 'Use this fixture only for non-mutating browser QA.',
  status: 'pending',
  priority: 'P1',
  proof: ['proof-route-evidence'],
  created_at: '2026-08-07T00:00:00.000Z',
  updated_at: '2026-08-07T00:01:00.000Z'
};

const activeList = {
  list_id: 'list-qa',
  title: 'Mounted QA list',
  project: 'QA',
  status: 'active',
  created_at: '2026-08-07T00:00:00.000Z',
  updated_at: '2026-08-07T00:01:00.000Z',
  items: [task]
};

const archivedList = {
  ...activeList,
  list_id: 'list-archived',
  title: 'Archived mounted QA list',
  status: 'archived'
};

const routeStates = {
  board: {
    response_type: 'board_snapshot',
    view: 'list',
    mode_recommendation: 'board',
    message: 'Mounted QA board',
    state_version: 1,
    state_version_after: 1,
    sync_status: 'fresh',
    list: activeList,
    events: []
  },
  search: {
    response_type: 'search_results',
    view: 'search',
    mode_recommendation: 'search',
    message: 'Found 1 task',
    state_version: 1,
    state_version_after: 1,
    sync_status: 'fresh',
    query: 'Verify add task',
    task_results: [{
      list_id: activeList.list_id,
      list_title: activeList.title,
      project: activeList.project,
      task
    }],
    lists: []
  },
  task_detail: {
    response_type: 'task_detail',
    view: 'task_detail',
    mode_recommendation: 'task_detail',
    message: 'Task detail ready',
    state_version: 1,
    state_version_after: 1,
    sync_status: 'fresh',
    list: activeList,
    task,
    focused_task_id: task.item_id
  },
  proof_detail: {
    response_type: 'proof_detail',
    view: 'proof_detail',
    mode_recommendation: 'proof_detail',
    message: 'Proof detail ready',
    state_version: 1,
    state_version_after: 1,
    sync_status: 'fresh',
    list: activeList,
    task,
    focused_task_id: task.item_id,
    proofs: task.proof,
    selected_proof: task.proof[0]
  },
  archive_recovery: {
    response_type: 'archive_recovery',
    view: 'archive_recovery',
    mode_recommendation: 'archive_recovery',
    message: 'Archived list ready for recovery review',
    state_version: 1,
    state_version_after: 1,
    sync_status: 'fresh',
    list: archivedList,
    affected: { list_id: archivedList.list_id, archive_status: 'archived' }
  }
};

const mock = `<script>
const __fixtures=${JSON.stringify({ activeList, archivedList, routeStates })};
const __mode=new URLSearchParams(location.search).get('mode')||'board';
const __clone=value=>JSON.parse(JSON.stringify(value));
const __liveList=__clone(__fixtures.activeList);
window.__calls=[];
window.openai={
  toolOutput:__clone(__fixtures.routeStates[__mode]||__fixtures.routeStates.board),
  notifyIntrinsicHeight(){},
  async callTool(name,args){
    window.__calls.push({name,args});
    if(name==='edit_task_details'){
      const selected=__liveList.items.find(item=>item.item_id===args.item_id_or_title);
      if(!selected) throw new Error('Task fixture not found');
      for(const field of ['title','notes','next_action','pablo_instruction','priority','status']){
        if(Object.prototype.hasOwnProperty.call(args,field)) selected[field]=args[field];
      }
      selected.updated_at='2026-08-07T00:02:00.000Z';
      return {structuredContent:{
        response_type:'mutation_result',view:'task_detail',mode_recommendation:'task_detail',success:true,
        message:'Task details saved',state_version:2,state_version_after:2,sync_status:'fresh',
        list:__clone(__liveList),task:__clone(selected),focused_task_id:selected.item_id
      }};
    }
    if(name==='refresh_board_state'){
      return {structuredContent:{
        response_type:'board_snapshot',view:'list',mode_recommendation:'board',success:true,
        message:'Board refreshed',state_version:2,state_version_after:2,sync_status:'fresh',list:__clone(__liveList)
      }};
    }
    if(name==='get_history'){
      return {structuredContent:{
        response_type:'history',view:'history',mode_recommendation:'history',success:true,
        message:'History loaded',state_version:2,state_version_after:2,sync_status:'fresh',list:__clone(__liveList),
        events:[{event_id:'event-qa',event_time:'2026-08-07T00:02:00.000Z',list_id:__liveList.list_id,
          action:'task_updated',payload:{title:__liveList.items[0].title}}]
      }};
    }
    if(name==='get_task_detail'){
      const selected=__liveList.items.find(item=>item.item_id===args.item_id_or_title);
      if(!selected) throw new Error('Task fixture not found');
      return {structuredContent:{
        response_type:'task_detail',view:'task_detail',mode_recommendation:'task_detail',success:true,
        message:'Task detail ready',state_version:2,state_version_after:2,sync_status:'fresh',
        list:__clone(__liveList),task:__clone(selected),focused_task_id:selected.item_id
      }};
    }
    if(name==='browse_lists'){
      return {structuredContent:{
        response_type:'list_browser',view:'lists',mode_recommendation:'list_browser',success:true,
        message:'Lists ready',state_version:2,state_version_after:2,sync_status:'fresh',
        lists:[{list_id:__liveList.list_id,title:__liveList.title,project:__liveList.project,status:__liveList.status,
          created_at:__liveList.created_at,updated_at:__liveList.updated_at,pending_count:1,done_count:0,blocked_count:0,total_count:1}]
      }};
    }
    throw new Error('Unexpected '+name);
  }
};
</script>`;

const html = widget.replace('<script>', mock + '<script>');
const server = http.createServer((req, res) => {
  res.writeHead(200, { 'content-type': 'text/html' });
  res.end(html);
});
await new Promise(resolve => server.listen(4173, resolve));

const forbiddenVisibleText = [
  'diag:',
  'result received',
  'click handler fired',
  'DOM click captured',
  'Raw event',
  'Debug task identity',
  'no structuredContent',
  'backend returned',
  'events field'
];

function assertCleanVisibleText(text, viewport, stage) {
  for (const forbidden of forbiddenVisibleText) {
    if (text.includes(forbidden)) {
      throw new Error(`${viewport}: technical text leaked during ${stage}: ${forbidden}`);
    }
  }
}

async function assertPageHealth(page, viewport, stage, errors) {
  const text = await page.locator('body').innerText();
  assertCleanVisibleText(text, viewport, stage);
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth
  );
  if (overflow) throw new Error(`${viewport}: horizontal overflow during ${stage}`);
  if (errors.length) throw new Error(`${viewport}: browser errors during ${stage}: ${errors.join(' | ')}`);
  return text;
}

async function openRoute(browser, viewport, mode) {
  const page = await browser.newPage({ viewport: { width: viewport.width, height: viewport.height } });
  const errors = [];
  page.on('console', message => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(`http://127.0.0.1:4173/?mode=${mode}`);
  await page.waitForTimeout(150);
  return { page, errors };
}

const browser = await chromium.launch({ headless: true });
const results = [];

for (const viewport of [
  { name: 'desktop', width: 1280, height: 900 },
  { name: 'mobile', width: 390, height: 844 }
]) {
  {
    const { page, errors } = await openRoute(browser, viewport, 'board');
    let text = await assertPageHealth(page, viewport.name, 'board', errors);
    if (!text.includes('Mounted QA list')) throw new Error(`${viewport.name}: board not rendered`);

    await page.locator('button[data-action="task-detail"]').click();
    await page.locator('button[data-action="edit-detail"]').click();
    await page.locator('textarea[data-detail-field="notes"]').fill('Browser mounted edit');
    await page.locator('button[data-action="save-detail"]').click();
    await page.waitForTimeout(100);

    let calls = await page.evaluate(() => window.__calls);
    if (!calls.some(call => call.name === 'edit_task_details')) {
      throw new Error(`${viewport.name}: save tool not called`);
    }
    await assertPageHealth(page, viewport.name, 'task edit', errors);

    await page.locator('button[data-action="back-board"]').click();
    await page.locator('button[data-action="refresh"]').first().click();
    await page.waitForTimeout(100);
    await page.locator('button[data-action="history"]').first().click();
    await page.waitForTimeout(100);

    calls = await page.evaluate(() => window.__calls);
    for (const required of ['edit_task_details', 'refresh_board_state', 'get_history']) {
      if (!calls.some(call => call.name === required)) {
        throw new Error(`${viewport.name}: ${required} not called`);
      }
    }

    text = await assertPageHealth(page, viewport.name, 'history', errors);
    if (!text.includes('History · Mounted QA list')) {
      throw new Error(`${viewport.name}: clean history heading not rendered`);
    }
    if (!text.includes('Task edited') || !text.includes('Verify add task updates same widget')) {
      throw new Error(`${viewport.name}: useful history content not rendered`);
    }

    await page.screenshot({path:`artifacts/release-gate/widget-${viewport.name}-board-history.png`,fullPage:true});
    results.push({ viewport: viewport.name, route: 'board-history', calls, passed: true });
    await page.close();
  }

  {
    const { page, errors } = await openRoute(browser, viewport, 'search');
    let text = await assertPageHealth(page, viewport.name, 'search', errors);
    if (!text.includes('Search results') || !text.includes('Verify add task updates same widget')) {
      throw new Error(`${viewport.name}: task search results not rendered`);
    }
    await page.locator('button[data-action="search-task-detail"]').click();
    await page.waitForTimeout(100);
    const calls = await page.evaluate(() => window.__calls);
    const detailCall = calls.find(call => call.name === 'get_task_detail');
    if (!detailCall || detailCall.args.item_id_or_title !== 'task-qa' || detailCall.args.list_id_or_query !== 'list-qa') {
      throw new Error(`${viewport.name}: search did not route through stable task detail IDs`);
    }
    text = await assertPageHealth(page, viewport.name, 'search-to-task-detail', errors);
    if (!text.includes('Task detail') || !text.includes('Confirm the selected task remains focused')) {
      throw new Error(`${viewport.name}: search selection did not render task detail`);
    }
    await page.screenshot({path:`artifacts/release-gate/widget-${viewport.name}-search-task-detail.png`,fullPage:true});
    results.push({ viewport: viewport.name, route: 'search-task-detail', calls, passed: true });
    await page.close();
  }

  {
    const { page, errors } = await openRoute(browser, viewport, 'task_detail');
    let text = await assertPageHealth(page, viewport.name, 'initial-task-detail', errors);
    if (!text.includes('Task detail') || !text.includes('Verify add task updates same widget')) {
      throw new Error(`${viewport.name}: initial task detail route collapsed`);
    }
    await page.locator('.body button[data-action="refresh"]').click();
    await page.waitForTimeout(100);
    text = await assertPageHealth(page, viewport.name, 'task-detail-refresh', errors);
    if (!text.includes('Task detail') || !text.includes('Verify add task updates same widget')) {
      throw new Error(`${viewport.name}: task detail mode was lost after refresh`);
    }
    const calls = await page.evaluate(() => window.__calls);
    if (!calls.some(call => call.name === 'refresh_board_state')) {
      throw new Error(`${viewport.name}: task detail refresh did not call backend`);
    }
    results.push({ viewport: viewport.name, route: 'task-detail-refresh', calls, passed: true });
    await page.close();
  }

  {
    const { page, errors } = await openRoute(browser, viewport, 'proof_detail');
    let text = await assertPageHealth(page, viewport.name, 'initial-proof-detail', errors);
    if (!text.includes('Selected proof') || !text.includes('proof-route-evidence')) {
      throw new Error(`${viewport.name}: proof detail route collapsed`);
    }
    await page.locator('.body button[data-action="refresh"]').click();
    await page.waitForTimeout(100);
    text = await assertPageHealth(page, viewport.name, 'proof-detail-refresh', errors);
    if (!text.includes('Selected proof') || !text.includes('proof-route-evidence')) {
      throw new Error(`${viewport.name}: proof detail mode was lost after refresh`);
    }
    const calls = await page.evaluate(() => window.__calls);
    results.push({ viewport: viewport.name, route: 'proof-detail-refresh', calls, passed: true });
    await page.close();
  }

  {
    const { page, errors } = await openRoute(browser, viewport, 'archive_recovery');
    const text = await assertPageHealth(page, viewport.name, 'archive-recovery', errors);
    if (!text.includes('Archive review') || !text.includes('Archived list')) {
      throw new Error(`${viewport.name}: archive recovery route collapsed`);
    }
    const calls = await page.evaluate(() => window.__calls);
    if (calls.some(call => ['archive_list', 'create_list', 'add_task', 'update_task_status', 'add_proof'].includes(call.name))) {
      throw new Error(`${viewport.name}: archive recovery navigation caused a business mutation`);
    }
    await page.screenshot({path:`artifacts/release-gate/widget-${viewport.name}-archive-recovery.png`,fullPage:true});
    results.push({ viewport: viewport.name, route: 'archive-recovery', calls, passed: true });
    await page.close();
  }
}

await browser.close();
server.close();

const coveredRoutes = [...new Set(results.map(result => result.route))];
fs.writeFileSync(
  'artifacts/release-gate/mounted-widget-qa.json',
  JSON.stringify({generated_at:new Date().toISOString(),verdict:'PASS',viewports:['desktop','mobile'],covered_routes:coveredRoutes,results}, null, 2)
);

console.log(JSON.stringify({
  verdict:'PASS',
  viewports:2,
  route_checks:results.length,
  covered_routes:coveredRoutes,
  visible_technical_text:0,
  real_backend_mutations:0
}, null, 2));
