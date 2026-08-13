import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const verifier = new URL('../scripts/verify-foundation.mjs', import.meta.url);
const verifierPath = fileURLToPath(verifier);

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

function writeFixture(mutator = () => {}) {
  const root = mkdtempSync(join(tmpdir(), 'sharvatask-foundation-'));
  for (const directory of ['contracts', '.github/workflows', 'app/api/mcp', 'src/storage', 'src']) {
    mkdirSync(join(root, directory), { recursive: true });
  }

  const fixture = {
    contract: structuredClone(canonicalContract),
    packageJson: {
      version: '2.4.0',
      scripts: {
        test: 'node --test tests/foundation-contract.test.mjs',
        'verify:foundation': 'node scripts/verify-foundation.mjs',
        verify: 'npm run verify:foundation && npm test'
      }
    },
    workflow: `name: SharvaTask Exact Main HEAD Gate
on:
  push:
    branches: [main]
  workflow_dispatch:
permissions:
  contents: read
jobs:
  exact-main-head:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          ref: \${{ github.sha }}
      - name: Prove exact event commit
        run: test "$(git rev-parse HEAD)" = "$GITHUB_SHA"
      - run: npm ci
      - run: npm run verify
      - name: Write exact-HEAD evidence
        run: mkdir -p artifacts && printf '{"sha":"%s"}\n' "$GITHUB_SHA" > artifacts/main-head-evidence.json
      - uses: actions/upload-artifact@v4
        if: always()
        with:
          name: sharvatask-main-head-evidence-\${{ github.run_id }}
          path: artifacts/main-head-evidence.json
`,
    route: [...canonicalContract.interface.mutation_tools, ...canonicalContract.interface.read_tools]
      .map((name) => `server.registerTool('${name}', {}, async () => ({}));`)
      .join('\n'),
    types: `export type HistoryAction =\n${canonicalContract.persistence.event_actions.map((action) => `  | '${action}'`).join('\n')};\n`,
    store: `const DEFAULT_PREFIX = 'sharvatask-v2/events';\nexport async function writeEvent(event) {\n  await put('event.json', JSON.stringify(event), { access: 'private', addRandomSuffix: false });\n}\n`,
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

test('accepts the canonical owner contract when interfaces, persistence, and exact-main-HEAD evidence agree', () => {
  const result = verify(writeFixture());
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /canonical task\/list owner foundation verified/i);
});

test('rejects persistence drift before a Blob prefix change can silently split task history', () => {
  const root = writeFixture((fixture) => {
    fixture.contract.persistence.default_prefix = 'sharvatask-v3/events';
  });
  const result = verify(root);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /default_prefix.*sharvatask-v2\/events/i);
});

test('rejects a main gate that stops running on pushes to main', () => {
  const root = writeFixture((fixture) => {
    fixture.workflow = fixture.workflow.replace('  push:\n    branches: [main]\n', '  pull_request:\n    branches: [main]\n');
  });
  const result = verify(root);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /pushes to main/i);
});
