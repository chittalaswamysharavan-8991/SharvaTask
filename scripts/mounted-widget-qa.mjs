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
  title: 'Mounted QA task',
  notes: 'Initial',
  next_action: '',
  pablo_instruction: '',
  status: 'pending',
  priority: 'P1',
  proof: [],
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString()
};
const state = {
  view: 'list',
  mode: 'list',
  message: 'Mounted QA board',
  state_version: 1,
  state_version_after: 1,
  sync_status: 'fresh',
  list: {
    list_id: 'list-qa',
    title: 'Mounted QA list',
    project: 'QA',
    status: 'active',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    items: [task]
  },
  events: []
};
const mock = `<script>window.__calls=[];window.openai={toolOutput:${JSON.stringify(state)},notifyIntrinsicHeight(){},async callTool(name,args){window.__calls.push({name,args});if(name==='edit_task_details'){Object.assign(window.openai.toolOutput.list.items[0],args,{updated_at:new Date().toISOString()});window.openai.toolOutput.state_version=2;return {structuredContent:{...window.openai.toolOutput,task:window.openai.toolOutput.list.items[0],response_type:'mutation_result',mode_recommendation:'task_detail',success:true}};}if(name==='refresh_board_state')return {structuredContent:{...window.openai.toolOutput,response_type:'board_snapshot',mode_recommendation:'board',success:true}};if(name==='get_history')return {structuredContent:{view:'history',message:'History loaded',list:window.openai.toolOutput.list,events:[{event_id:'e1',event_time:new Date().toISOString(),list_id:'list-qa',action:'task_updated',payload:{title:'Mounted QA task'}}],state_version:2,state_version_after:2,success:true}};throw new Error('Unexpected '+name);}};</script>`;
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

const browser = await chromium.launch({ headless: true });
const results = [];
for (const viewport of [
  { name: 'desktop', width: 1280, height: 900 },
  { name: 'mobile', width: 390, height: 844 }
]) {
  const page = await browser.newPage({ viewport: { width: viewport.width, height: viewport.height } });
  const errors = [];
  page.on('console', message => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('pageerror', error => errors.push(error.message));

  await page.goto('http://127.0.0.1:4173');
  await page.waitForTimeout(300);
  const boardText = await page.locator('body').innerText();
  if (!boardText.includes('Mounted QA list')) throw new Error(`${viewport.name}: board not rendered`);
  assertCleanVisibleText(boardText, viewport.name, 'board');

  await page.locator('button[data-action="task-detail"]').click();
  await page.locator('button[data-action="edit-detail"]').click();
  const notes = page.locator('textarea[data-detail-field="notes"]');
  await notes.fill('Browser mounted edit');
  await page.locator('button[data-action="save-detail"]').click();
  await page.waitForTimeout(200);

  let calls = await page.evaluate(() => window.__calls);
  if (!calls.some(call => call.name === 'edit_task_details')) {
    throw new Error(`${viewport.name}: save tool not called`);
  }
  assertCleanVisibleText(await page.locator('body').innerText(), viewport.name, 'task detail');

  await page.locator('button[data-action="back-board"]').click();
  await page.locator('button[data-action="refresh"]').first().click();
  await page.waitForTimeout(200);
  await page.locator('button[data-action="history"]').first().click();
  await page.waitForTimeout(200);

  calls = await page.evaluate(() => window.__calls);
  for (const required of ['edit_task_details', 'refresh_board_state', 'get_history']) {
    if (!calls.some(call => call.name === required)) {
      throw new Error(`${viewport.name}: ${required} not called`);
    }
  }

  const historyText = await page.locator('body').innerText();
  if (!historyText.includes('History · Mounted QA list')) {
    throw new Error(`${viewport.name}: clean history heading not rendered`);
  }
  if (!historyText.includes('Task edited') || !historyText.includes('Mounted QA task')) {
    throw new Error(`${viewport.name}: useful history content not rendered`);
  }
  assertCleanVisibleText(historyText, viewport.name, 'history');

  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth
  );
  if (overflow) throw new Error(`${viewport.name}: horizontal overflow`);
  if (errors.length) throw new Error(`${viewport.name}: browser errors ${errors.join(' | ')}`);

  await page.screenshot({
    path: `artifacts/release-gate/widget-${viewport.name}.png`,
    fullPage: true
  });
  results.push({ viewport, calls, overflow, errors, passed: true });
  await page.close();
}

await browser.close();
server.close();
fs.writeFileSync(
  'artifacts/release-gate/mounted-widget-qa.json',
  JSON.stringify({ generated_at: new Date().toISOString(), verdict: 'PASS', results }, null, 2)
);
console.log(
  JSON.stringify(
    {
      verdict: 'PASS',
      viewports: results.length,
      calls: results.map(result => result.calls.map(call => call.name)),
      visible_technical_text: 0
    },
    null,
    2
  )
);
