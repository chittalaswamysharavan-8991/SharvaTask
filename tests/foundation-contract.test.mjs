import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const verifierPath = fileURLToPath(new URL('../scripts/verify-foundation.mjs', import.meta.url));
const canonicalWorkflow = readFileSync(new URL('../.github/workflows/main-head-gate.yml', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const fixtureRoots = new Set();

const canonicalContract = {
  schema_version: 1,
  contract_id: 'sharvaos.task-list-owner',
  repository: 'chittalaswamysharavan-8991/SharvaTask',
  role: 'canonical_task_list_owner',
  domains: ['lists', 'tasks', 'task_history'],
  consumers: [
    {
      repository: 'chittalaswamysharavan-8991/SharvaOS-Pulse',
      responsibility: 'daily_task_view',
      access: 'read_write_through_sharvatask',
      authoritative_read_back_required: true
    },
    {
      repository: 'chittalaswamysharavan-8991/sharvaos-app',
      responsibility: 'universal_capture_client',
      access: 'read_write_through_sharvatask',
      authoritative_read_back_required: true
    }
  ],
  interface: {
    transport: 'mcp',
    primary_path: '/api/mcp',
    alias_path: '/mcp',
    mutation_tools: ['create_list', 'add_task', 'update_task_status', 'edit_task_details', 'update_task', 'add_proof', 'archive_list'],
    read_tools: ['open_task_board', 'get_board_snapshot', 'browse_lists', 'search_board', 'get_history', 'get_task_detail', 'refresh_board_state', 'show_list', 'list_all', 'search_lists', 'continue_list', 'show_history']
  },
  persistence: {
    provider: 'vercel_blob',
    access: 'private',
    model: 'append_only_event_history',
    default_prefix: 'sharvatask-v2/events',
    event_actions: ['list_created', 'task_added', 'task_status_updated', 'task_updated', 'task_proof_added', 'list_archived']
  },
  ownership_policy: {
    competing_task_stores_allowed: false,
    consumer_repositories_are_views_or_clients: true
  }
};

test.afterEach(() => {
  for (const root of fixtureRoots) rmSync(root, { recursive: true, force: true });
  fixtureRoots.clear();
});

function writeFixture(mutator = () => {}) {
  const root = mkdtempSync(join(tmpdir(), 'sharvatask-foundation-'));
  fixtureRoots.add(root);
  for (const directory of ['contracts', '.github/workflows', 'app/api/mcp', 'src/storage', 'src']) {
    mkdirSync(join(root, directory), { recursive: true });
  }

  const fixture = {
    contract: structuredClone(canonicalContract),
    packageJson: {
      version: '2.4.0',
      scripts: {
        test: 'node --test tests/foundation-contract.test.mjs tests/routing-intent.test.mjs tests/widget-phase-f.test.mjs',
        'verify:foundation': 'node scripts/verify-foundation.mjs',
        'verify:descriptor': 'node scripts/verify-descriptor.mjs',
        'verify:phase-f': 'node scripts/verify-phase-f.mjs',
        typecheck: 'tsc --noEmit',
        build: 'next build',
        verify: 'npm run verify:foundation && npm run verify:descriptor && npm run verify:phase-f && npm run typecheck && npm run build && npm run test'
      }
    },
    workflow: canonicalWorkflow,
    route: [...canonicalContract.interface.mutation_tools, ...canonicalContract.interface.read_tools]
      .map((name) => `server.registerTool('${name}', {}, async () => ({}));`)
      .join('\n'),
    types: `export type HistoryAction =\n${canonicalContract.persistence.event_actions.map((action) => `  | '${action}'`).join('\n')};\n`,
    store: `import { get, list, put } from '@vercel/blob';
const DEFAULT_PREFIX = 'sharvatask-v2/events';
export async function writeEvent(event) {
  await put('event.json', JSON.stringify(event), {
    access: 'private',
    contentType: 'application/json',
    addRandomSuffix: false
  });
}
`,
    vercel: { rewrites: [{ source: '/mcp', destination: '/api/mcp' }] }
  };

  mutator(fixture);
  writeFileSync(join(root, 'contracts/sharvaos-task-owner.v1.json'), `${JSON.stringify(fixture.contract, null, 2)}\n`);
  writeFileSync(join(root, 'package.json'), `${JSON.stringify(fixture.packageJson, null, 2)}\n`);
  writeFileSync(join(root, '.github/workflows/main-head-gate.yml'), fixture.workflow);
  writeFileSync(join(root, 'app/api/mcp/route.ts'), fixture.route);
  writeFileSync(join(root, 'src/types.ts'), fixture.types);
  writeFileSync(join(root, 'src/storage/blobEventStore.ts'), fixture.store);
  writeFileSync(join(root, 'vercel.json'), `${JSON.stringify(fixture.vercel, null, 2)}\n`);
  return root;
}

function verify(root) {
  return spawnSync(process.execPath, [verifierPath, '--root', root], { encoding: 'utf8' });
}

function expectFailure(mutator, messagePattern) {
  const result = verify(writeFixture(mutator));
  assert.notEqual(result.status, 0, result.stdout);
  assert.match(result.stderr, messagePattern);
}

function replaceWorkflow(fixture, before, after) {
  const mutated = fixture.workflow.replace(before, after);
  assert.notEqual(mutated, fixture.workflow, 'workflow test mutation must change the canonical fixture');
  fixture.workflow = mutated;
}

test('accepts the canonical owner contract when interfaces, persistence, and exact-main-HEAD evidence agree', () => {
  const result = verify(writeFixture());
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /canonical task\/list owner foundation verified/i);
});

test('rejects persistence drift before a Blob prefix change can silently split task history', () => {
  expectFailure((fixture) => {
    fixture.contract.persistence.default_prefix = 'sharvatask-v3/events';
  }, /default_prefix.*sharvatask-v2\/events/i);
});

test('rejects a main gate that stops running on pushes to main', () => {
  expectFailure((fixture) => {
    replaceWorkflow(fixture, '  push:\n    branches: [main]\n', '  # push:\n  #   branches: [main]\n');
  }, /workflow\.on keys.*push/i);
});

test('rejects a commented github.sha reference when checkout uses main', () => {
  expectFailure((fixture) => {
    replaceWorkflow(
      fixture,
      '          ref: ${{ github.sha }}',
      '          ref: main\n          # ref: ${{ github.sha }}'
    );
  }, /checkout must pin the exact github\.sha/i);
});

test('rejects an echoed verification command', () => {
  expectFailure((fixture) => {
    replaceWorkflow(fixture, '        run: npm run verify', '        run: echo npm run verify');
  }, /execute the full npm run verify/i);
});

test('rejects an echoed package foundation command', () => {
  expectFailure((fixture) => {
    fixture.packageJson.scripts['verify:foundation'] = 'echo node scripts/verify-foundation.mjs';
  }, /exact verify:foundation command/i);
});

test('rejects an echoed foundation call in the package verification chain', () => {
  expectFailure((fixture) => {
    fixture.packageJson.scripts.verify = 'echo npm run verify:foundation && npm run verify:descriptor && npm run verify:phase-f && npm run typecheck && npm run build && npm run test';
  }, /exact audited verification chain/i);
});

test('rejects a commented tool registration', () => {
  expectFailure((fixture) => {
    fixture.route = fixture.route.replace("server.registerTool('create_list'", "// server.registerTool('create_list'");
  }, /registered MCP tools drifted/i);
});

test('rejects an aliased Blob delete import and call', () => {
  expectFailure((fixture) => {
    fixture.store = fixture.store
      .replace("import { get, list, put } from '@vercel/blob';", "import { del as remove, get, list, put } from '@vercel/blob';")
      .replace('\n}', "\n  await remove('event.json');\n}");
  }, /@vercel\/blob imports.*del/i);
});

test('rejects public Blob writes even when a private-access comment remains', () => {
  expectFailure((fixture) => {
    fixture.store = fixture.store.replace("    access: 'private',", "    access: 'public', // access: 'private'");
  }, /event writes must remain private/i);
});

test('rejects cancellation of an earlier exact-main-HEAD run', () => {
  expectFailure((fixture) => {
    replaceWorkflow(
      fixture,
      'permissions:\n',
      'concurrency:\n  group: sharvatask-main-head-${{ github.ref }}\n  cancel-in-progress: true\npermissions:\n'
    );
  }, /must not cancel or supersede/i);
});

test('rejects workflow dispatch without a main-ref guard', () => {
  expectFailure((fixture) => {
    replaceWorkflow(fixture, "    if: ${{ github.ref == 'refs/heads/main' }}\n", '');
  }, /must reject non-main workflow dispatches/i);
});
