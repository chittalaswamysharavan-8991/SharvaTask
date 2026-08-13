import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const REQUIRED_MUTATION_TOOLS = [
  'create_list',
  'add_task',
  'update_task_status',
  'edit_task_details',
  'update_task',
  'add_proof',
  'archive_list'
];
const REQUIRED_READ_TOOLS = [
  'open_task_board',
  'get_board_snapshot',
  'browse_lists',
  'search_board',
  'get_history',
  'get_task_detail',
  'refresh_board_state',
  'show_list',
  'list_all',
  'search_lists',
  'continue_list',
  'show_history'
];
const REQUIRED_EVENT_ACTIONS = [
  'list_created',
  'task_added',
  'task_status_updated',
  'task_updated',
  'task_proof_added',
  'list_archived'
];

function invariant(condition, message) {
  if (!condition) throw new Error(message);
}

function read(root, path) {
  return readFileSync(resolve(root, path), 'utf8');
}

function readJson(root, path) {
  return JSON.parse(read(root, path));
}

function sameMembers(actual, expected, label) {
  invariant(Array.isArray(actual), `${label} must be an array`);
  const actualSorted = [...actual].sort();
  const expectedSorted = [...expected].sort();
  invariant(
    JSON.stringify(actualSorted) === JSON.stringify(expectedSorted),
    `${label} drifted: expected ${expectedSorted.join(', ')}; received ${actualSorted.join(', ')}`
  );
}

function registeredTools(route) {
  return [...route.matchAll(/server\.registerTool\(\s*['"]([^'"]+)['"]/g)].map((match) => match[1]);
}

function historyActions(types) {
  const declaration = /export type HistoryAction\s*=([\s\S]*?);/.exec(types)?.[1] || '';
  return [...declaration.matchAll(/['"]([^'"]+)['"]/g)].map((match) => match[1]);
}

export function verifyFoundation(root) {
  const contract = readJson(root, 'contracts/sharvaos-task-owner.v1.json');
  const packageJson = readJson(root, 'package.json');
  const workflow = read(root, '.github/workflows/main-head-gate.yml');
  const route = read(root, 'app/api/mcp/route.ts');
  const types = read(root, 'src/types.ts');
  const store = read(root, 'src/storage/blobEventStore.ts');
  const vercel = readJson(root, 'vercel.json');

  invariant(contract.schema_version === 1, 'schema_version must remain 1');
  invariant(contract.contract_id === 'sharvaos.task-list-owner', 'contract_id must identify the SharvaOS task/list owner');
  invariant(contract.repository === 'chittalaswamysharavan-8991/SharvaTask', 'repository must remain chittalaswamysharavan-8991/SharvaTask');
  invariant(contract.role === 'canonical_task_list_owner', 'role must remain canonical_task_list_owner');
  sameMembers(contract.domains, ['lists', 'tasks', 'task_history'], 'domains');

  const consumers = new Map((contract.consumers || []).map((consumer) => [consumer.repository, consumer]));
  for (const repository of [
    'chittalaswamysharavan-8991/SharvaOS-Pulse',
    'chittalaswamysharavan-8991/sharvaos-app'
  ]) {
    const consumer = consumers.get(repository);
    invariant(consumer, `${repository} must remain a declared SharvaTask consumer`);
    invariant(consumer.access === 'read_write_through_sharvatask', `${repository} must read/write through SharvaTask`);
    invariant(consumer.authoritative_read_back_required === true, `${repository} must require authoritative read-back`);
  }
  invariant(contract.ownership_policy?.competing_task_stores_allowed === false, 'competing task stores must remain disallowed');
  invariant(contract.ownership_policy?.consumer_repositories_are_views_or_clients === true, 'consumers must remain views or clients');

  invariant(contract.interface?.transport === 'mcp', 'canonical transport must remain MCP');
  invariant(contract.interface?.primary_path === '/api/mcp', 'primary MCP path must remain /api/mcp');
  invariant(contract.interface?.alias_path === '/mcp', 'MCP alias must remain /mcp');
  sameMembers(contract.interface?.mutation_tools, REQUIRED_MUTATION_TOOLS, 'interface.mutation_tools');
  sameMembers(contract.interface?.read_tools, REQUIRED_READ_TOOLS, 'interface.read_tools');
  sameMembers(registeredTools(route), [...REQUIRED_MUTATION_TOOLS, ...REQUIRED_READ_TOOLS], 'registered MCP tools');
  invariant(
    vercel.rewrites?.some((rewrite) => rewrite.source === '/mcp' && rewrite.destination === '/api/mcp'),
    'vercel.json must route /mcp to /api/mcp'
  );

  invariant(contract.persistence?.provider === 'vercel_blob', 'persistence.provider must remain vercel_blob');
  invariant(contract.persistence?.access === 'private', 'persistence.access must remain private');
  invariant(contract.persistence?.model === 'append_only_event_history', 'persistence.model must remain append_only_event_history');
  invariant(contract.persistence?.default_prefix === 'sharvatask-v2/events', 'persistence.default_prefix must remain sharvatask-v2/events');
  sameMembers(contract.persistence?.event_actions, REQUIRED_EVENT_ACTIONS, 'persistence.event_actions');
  sameMembers(historyActions(types), REQUIRED_EVENT_ACTIONS, 'HistoryAction');
  invariant(/DEFAULT_PREFIX\s*=\s*['"]sharvatask-v2\/events['"]/.test(store), 'Blob DEFAULT_PREFIX must remain sharvatask-v2/events');
  invariant(/\bput\([\s\S]*?access:\s*['"]private['"][\s\S]*?addRandomSuffix:\s*false/.test(store), 'event writes must remain private and retain deterministic append-only path names');
  invariant(!/\bdel\s*\(/.test(store), 'event history must remain append-only; delete calls are not allowed in blobEventStore');

  invariant(/\n\s*push:\s*\n\s*branches:\s*\[main\]/.test(workflow), 'exact-HEAD gate must run on pushes to main');
  invariant(/permissions:\s*\n\s*contents:\s*read/.test(workflow), 'exact-HEAD gate permissions must remain read-only');
  invariant(/ref:\s*\$\{\{\s*github\.sha\s*\}\}/.test(workflow), 'checkout must pin the exact github.sha');
  invariant(/git rev-parse HEAD[\s\S]*GITHUB_SHA/.test(workflow), 'gate must compare checked-out HEAD with GITHUB_SHA');
  invariant(/npm ci/.test(workflow) && /npm run verify/.test(workflow), 'gate must install from lockfile and run the full verification suite');
  invariant(/actions\/upload-artifact@v4/.test(workflow), 'gate must upload exact-main-HEAD evidence');
  invariant(/artifacts\/main-head-evidence\.json/.test(workflow), 'gate must write and upload main-head-evidence.json');

  invariant(packageJson.scripts?.['verify:foundation'] === 'node scripts/verify-foundation.mjs', 'package scripts must expose verify:foundation');
  invariant(packageJson.scripts?.verify?.includes('npm run verify:foundation'), 'npm run verify must include the foundation drift gate');
  invariant(packageJson.scripts?.test?.includes('foundation-contract.test.mjs') || packageJson.scripts?.test?.includes('tests/*.test.mjs'), 'npm test must include foundation contract tests');
}

function argument(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
}

try {
  verifyFoundation(resolve(argument('--root') || new URL('..', import.meta.url).pathname));
  console.log('Canonical task/list owner foundation verified: ownership, MCP surface, Blob history, and exact-main-HEAD gate agree.');
} catch (error) {
  console.error(`Foundation verification failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
