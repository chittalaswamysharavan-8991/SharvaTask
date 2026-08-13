import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { parseDocument } from 'yaml';

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
const REQUIRED_TEST_SCRIPT = 'node --test tests/foundation-contract.test.mjs tests/routing-intent.test.mjs tests/widget-phase-f.test.mjs';
const REQUIRED_VERIFY_SCRIPT = 'npm run verify:foundation && npm run verify:descriptor && npm run verify:phase-f && npm run typecheck && npm run build && npm run test';
const REQUIRED_EVIDENCE_COMMAND = `mkdir -p artifacts
printf '{"repository":"%s","ref":"%s","sha":"%s","run_id":"%s","verification":"%s"}\\n' \\
  "$GITHUB_REPOSITORY" "$GITHUB_REF" "$GITHUB_SHA" "$GITHUB_RUN_ID" "$VERIFY_OUTCOME" \\
  > artifacts/main-head-evidence.json`;

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

function sameKeys(actual, expected, label) {
  invariant(actual && typeof actual === 'object' && !Array.isArray(actual), `${label} must be a mapping`);
  sameMembers(Object.keys(actual), expected, `${label} keys`);
}

function sourceFile(source, fileName) {
  const parsed = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  invariant(parsed.parseDiagnostics.length === 0, `${fileName} must parse as TypeScript`);
  return parsed;
}

function walk(node, visitor) {
  visitor(node);
  ts.forEachChild(node, (child) => walk(child, visitor));
}

function registeredTools(route) {
  const parsed = sourceFile(route, 'app/api/mcp/route.ts');
  const tools = [];
  walk(parsed, (node) => {
    if (!ts.isCallExpression(node) || !ts.isPropertyAccessExpression(node.expression)) return;
    const receiver = node.expression.expression;
    if (!ts.isIdentifier(receiver) || receiver.text !== 'server' || node.expression.name.text !== 'registerTool') return;
    const name = node.arguments[0];
    invariant(name && ts.isStringLiteralLike(name), 'every server.registerTool call must use a literal tool name');
    tools.push(name.text);
  });
  return tools;
}

function historyActions(types) {
  const parsed = sourceFile(types, 'src/types.ts');
  const declaration = parsed.statements.find(
    (statement) => ts.isTypeAliasDeclaration(statement) && statement.name.text === 'HistoryAction'
  );
  invariant(declaration && ts.isTypeAliasDeclaration(declaration), 'src/types.ts must export a HistoryAction type alias');
  invariant(declaration.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword), 'HistoryAction must remain exported');
  const members = ts.isUnionTypeNode(declaration.type) ? declaration.type.types : [declaration.type];
  return members.map((member) => {
    invariant(ts.isLiteralTypeNode(member) && ts.isStringLiteralLike(member.literal), 'HistoryAction members must be string literals');
    return member.literal.text;
  });
}

function propertyName(node) {
  if (!node) return undefined;
  if (ts.isIdentifier(node) || ts.isStringLiteralLike(node) || ts.isNumericLiteral(node)) return node.text;
  return undefined;
}

function objectProperty(object, name) {
  const properties = object.properties.filter((property) => propertyName(property.name) === name);
  invariant(properties.length === 1 && ts.isPropertyAssignment(properties[0]), `Blob put options must define ${name} exactly once`);
  return properties[0].initializer;
}

function verifyBlobStore(store) {
  const parsed = sourceFile(store, 'src/storage/blobEventStore.ts');
  let blobImport;
  let defaultPrefix;
  let writeEvent;

  for (const statement of parsed.statements) {
    if (ts.isImportDeclaration(statement) && ts.isStringLiteral(statement.moduleSpecifier) && statement.moduleSpecifier.text === '@vercel/blob') {
      invariant(!blobImport, 'blobEventStore must have exactly one static @vercel/blob import');
      blobImport = statement;
    }
    if (ts.isFunctionDeclaration(statement) && statement.name?.text === 'writeEvent') writeEvent = statement;
  }

  invariant(blobImport, 'blobEventStore must statically import @vercel/blob');
  const bindings = blobImport.importClause?.namedBindings;
  invariant(bindings && ts.isNamedImports(bindings), '@vercel/blob must use named imports only');
  const imported = new Map();
  for (const element of bindings.elements) {
    const importedName = element.propertyName?.text || element.name.text;
    invariant(!imported.has(importedName), `@vercel/blob import ${importedName} must not be duplicated`);
    imported.set(importedName, element.name.text);
  }
  sameMembers([...imported.keys()], ['get', 'list', 'put'], '@vercel/blob imports');

  const importedLocals = new Set(imported.values());
  walk(parsed, (node) => {
    if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword && node.arguments[0] && ts.isStringLiteral(node.arguments[0]) && node.arguments[0].text === '@vercel/blob') {
      invariant(false, 'dynamic @vercel/blob imports are not allowed');
    }
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'require' && node.arguments[0] && ts.isStringLiteral(node.arguments[0]) && node.arguments[0].text === '@vercel/blob') {
      invariant(false, 'require(@vercel/blob) is not allowed');
    }
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && importedLocals.has(node.name.text)) {
      invariant(false, `@vercel/blob binding ${node.name.text} must not be shadowed`);
    }
    if (ts.isParameter(node) && ts.isIdentifier(node.name) && importedLocals.has(node.name.text)) {
      invariant(false, `@vercel/blob binding ${node.name.text} must not be shadowed`);
    }
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === 'DEFAULT_PREFIX') {
      invariant(!defaultPrefix, 'DEFAULT_PREFIX must be declared exactly once');
      defaultPrefix = node.initializer;
    }
  });

  invariant(defaultPrefix && ts.isStringLiteralLike(defaultPrefix) && defaultPrefix.text === 'sharvatask-v2/events', 'Blob DEFAULT_PREFIX must remain sharvatask-v2/events');
  invariant(writeEvent?.body, 'blobEventStore must define writeEvent');

  const putLocal = imported.get('put');
  const allPutCalls = [];
  const writeEventPutCalls = [];
  walk(parsed, (node) => {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === putLocal) allPutCalls.push(node);
  });
  walk(writeEvent.body, (node) => {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === putLocal) writeEventPutCalls.push(node);
  });
  invariant(allPutCalls.length === 1 && writeEventPutCalls.length === 1, 'writeEvent must contain the only @vercel/blob put call');

  const options = writeEventPutCalls[0].arguments[2];
  invariant(options && ts.isObjectLiteralExpression(options), 'event writes must pass literal Blob put options');
  invariant(!options.properties.some(ts.isSpreadAssignment), 'Blob put options must not use spreads');
  sameMembers(options.properties.map((property) => propertyName(property.name)), ['access', 'contentType', 'addRandomSuffix'], 'Blob put option names');
  const access = objectProperty(options, 'access');
  const contentType = objectProperty(options, 'contentType');
  const addRandomSuffix = objectProperty(options, 'addRandomSuffix');
  invariant(ts.isStringLiteralLike(access) && access.text === 'private', 'event writes must remain private');
  invariant(ts.isStringLiteralLike(contentType) && contentType.text === 'application/json', 'event writes must remain JSON');
  invariant(addRandomSuffix.kind === ts.SyntaxKind.FalseKeyword, 'event writes must retain deterministic append-only path names');
}

function actionRefMatches(value, action, major) {
  if (typeof value !== 'string' || !value.startsWith(`${action}@`)) return false;
  const ref = value.slice(action.length + 1);
  return ref === major || /^[0-9a-f]{40}$/.test(ref);
}

function parseWorkflow(source) {
  const document = parseDocument(source, { uniqueKeys: true });
  invariant(document.errors.length === 0, `exact-HEAD workflow must parse as YAML: ${document.errors[0]?.message || ''}`);
  const workflow = document.toJS();
  invariant(workflow && typeof workflow === 'object' && !Array.isArray(workflow), 'exact-HEAD workflow must be a YAML mapping');
  return workflow;
}

function verifyWorkflow(source) {
  const workflow = parseWorkflow(source);
  const triggers = workflow.on;
  sameKeys(triggers, ['push', 'workflow_dispatch'], 'workflow.on');
  sameKeys(triggers.push, ['branches'], 'workflow.on.push');
  sameMembers(triggers.push.branches, ['main'], 'workflow.on.push.branches');
  invariant(triggers.workflow_dispatch === null, 'workflow_dispatch must not define alternate inputs or behavior');
  invariant(workflow.concurrency === undefined, 'exact-main-HEAD runs must not cancel or supersede earlier main pushes');
  sameKeys(workflow.permissions, ['contents'], 'workflow.permissions');
  invariant(workflow.permissions.contents === 'read', 'exact-HEAD gate permissions must remain contents: read');
  sameKeys(workflow.jobs, ['exact-main-head'], 'workflow.jobs');

  const job = workflow.jobs['exact-main-head'];
  invariant(job && typeof job === 'object' && !Array.isArray(job), 'exact-main-head job must be a mapping');
  invariant(job.if === "${{ github.ref == 'refs/heads/main' }}", 'exact-main-head job must reject non-main workflow dispatches');
  sameKeys(job, ['name', 'if', 'runs-on', 'timeout-minutes', 'steps'], 'exact-main-head job');
  invariant(job['runs-on'] === 'ubuntu-latest', 'exact-main-head job must run on ubuntu-latest');
  invariant(job['timeout-minutes'] === 18, 'exact-main-head job timeout must remain 18 minutes');
  invariant(Array.isArray(job.steps) && job.steps.length === 7, 'exact-main-head job must contain exactly seven audited steps');

  const [checkout, prove, setup, install, verify, evidence, upload] = job.steps;
  sameKeys(checkout, ['name', 'uses', 'with'], 'checkout step');
  invariant(actionRefMatches(checkout.uses, 'actions/checkout', 'v4'), 'checkout step must use actions/checkout v4 or an immutable SHA');
  sameKeys(checkout.with, ['ref', 'fetch-depth'], 'checkout inputs');
  invariant(checkout.with.ref === '${{ github.sha }}', 'checkout must pin the exact github.sha');
  invariant(checkout.with['fetch-depth'] === 1, 'checkout fetch-depth must remain 1');

  sameKeys(prove, ['name', 'run'], 'exact commit proof step');
  invariant(prove.run === 'test "$(git rev-parse HEAD)" = "$GITHUB_SHA"', 'gate must execute the exact checked-out HEAD comparison');

  sameKeys(setup, ['name', 'uses', 'with'], 'Node setup step');
  invariant(actionRefMatches(setup.uses, 'actions/setup-node', 'v4'), 'Node setup must use actions/setup-node v4 or an immutable SHA');
  sameKeys(setup.with, ['node-version', 'cache'], 'Node setup inputs');
  invariant(setup.with['node-version'] === 20 && setup.with.cache === 'npm', 'Node setup must use Node 20 with npm cache');

  sameKeys(install, ['name', 'run'], 'dependency install step');
  invariant(install.run === 'npm ci', 'gate must execute npm ci from the lockfile');
  sameKeys(verify, ['name', 'id', 'run'], 'verification step');
  invariant(verify.id === 'verification' && verify.run === 'npm run verify', 'gate must execute the full npm run verify script');

  sameKeys(evidence, ['name', 'if', 'env', 'run'], 'evidence writer step');
  invariant(evidence.if === 'always()', 'evidence writer must run even after verification failure');
  sameKeys(evidence.env, ['VERIFY_OUTCOME'], 'evidence writer environment');
  invariant(evidence.env.VERIFY_OUTCOME === '${{ steps.verification.outcome }}', 'evidence must record the verification step outcome');
  invariant(evidence.run.trim() === REQUIRED_EVIDENCE_COMMAND, 'evidence writer must use the audited main-head JSON command');

  sameKeys(upload, ['name', 'if', 'uses', 'with'], 'evidence upload step');
  invariant(upload.if === 'always()', 'evidence upload must run even after verification failure');
  invariant(actionRefMatches(upload.uses, 'actions/upload-artifact', 'v4'), 'evidence upload must use actions/upload-artifact v4 or an immutable SHA');
  sameKeys(upload.with, ['name', 'path', 'if-no-files-found', 'retention-days'], 'evidence upload inputs');
  invariant(upload.with.name === 'sharvatask-main-head-evidence-${{ github.run_id }}', 'evidence artifact name must include github.run_id');
  invariant(upload.with.path === 'artifacts/main-head-evidence.json', 'evidence upload path must remain main-head-evidence.json');
  invariant(upload.with['if-no-files-found'] === 'error' && upload.with['retention-days'] === 30, 'evidence upload retention/error policy drifted');
}

function verifyPackageScripts(packageJson) {
  const scripts = packageJson.scripts || {};
  invariant(scripts['verify:foundation'] === 'node scripts/verify-foundation.mjs', 'package scripts must expose the exact verify:foundation command');
  invariant(scripts.test === REQUIRED_TEST_SCRIPT, 'npm test must execute the exact audited test suite');
  invariant(scripts.verify === REQUIRED_VERIFY_SCRIPT, 'npm run verify must execute the exact audited verification chain');
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
  verifyBlobStore(store);
  verifyWorkflow(workflow);
  verifyPackageScripts(packageJson);
}

function argument(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
}

try {
  verifyFoundation(resolve(argument('--root') || fileURLToPath(new URL('..', import.meta.url))));
  console.log('Canonical task/list owner foundation verified: ownership, MCP surface, Blob history, and exact-main-HEAD gate agree.');
} catch (error) {
  console.error(`Foundation verification failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
