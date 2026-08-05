import fs from 'node:fs';
import { execFileSync } from 'node:child_process';

fs.mkdirSync('artifacts/release-gate', { recursive: true });

function run(cmd, args) {
  try {
    return { ok: true, stdout: execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }), stderr: '' };
  } catch (error) {
    return { ok: false, stdout: error.stdout?.toString?.() || '', stderr: error.stderr?.toString?.() || error.message, status: error.status };
  }
}

function parseAudit(result) {
  try { return JSON.parse(result.stdout || '{}'); }
  catch { return { parse_error: true, raw: result.stdout, stderr: result.stderr }; }
}

const allResult = run('npm', ['audit', '--json']);
const prodResult = run('npm', ['audit', '--omit=dev', '--json']);
const all = parseAudit(allResult);
const production = parseAudit(prodResult);

function normalize(parsed) {
  return Object.entries(parsed.vulnerabilities || {}).map(([name, value]) => ({
    package: name,
    severity: value.severity,
    direct: Boolean(value.isDirect),
    via: (value.via || []).map((entry) => typeof entry === 'string' ? entry : ({
      source: entry.source,
      name: entry.name,
      title: entry.title,
      severity: entry.severity,
      range: entry.range,
      url: entry.url
    })),
    effects: value.effects || [],
    range: value.range,
    nodes: value.nodes || [],
    fix_available: value.fixAvailable
  }));
}

const result = {
  generated_at: new Date().toISOString(),
  all_dependencies: { exit_ok: allResult.ok, metadata: all.metadata || null, vulnerabilities: normalize(all) },
  production_dependencies: { exit_ok: prodResult.ok, metadata: production.metadata || null, vulnerabilities: normalize(production) }
};

fs.writeFileSync('artifacts/release-gate/dependency-audit.json', JSON.stringify(result, null, 2));
const allCount = result.all_dependencies.metadata?.vulnerabilities?.total ?? result.all_dependencies.vulnerabilities.length;
const prodCount = result.production_dependencies.metadata?.vulnerabilities?.total ?? result.production_dependencies.vulnerabilities.length;
const summary = [
  '# Dependency advisory triage', '',
  `- Generated: ${result.generated_at}`,
  `- All dependency advisories: ${allCount}`,
  `- Production dependency advisories: ${prodCount}`, '',
  '## Production-impacting packages',
  ...(result.production_dependencies.vulnerabilities.length ? result.production_dependencies.vulnerabilities.map((item) => `- ${item.package}: ${item.severity}; direct=${item.direct}; fix=${JSON.stringify(item.fix_available)}`) : ['- None']), '',
  '## All packages',
  ...result.all_dependencies.vulnerabilities.map((item) => `- ${item.package}: ${item.severity}; direct=${item.direct}; fix=${JSON.stringify(item.fix_available)}`)
];
fs.writeFileSync('artifacts/release-gate/dependency-audit.md', `${summary.join('\n')}\n`);
console.log(JSON.stringify({ all_count: allCount, production_count: prodCount, packages: result.all_dependencies.vulnerabilities.map(r => `${r.package}:${r.severity}`) }, null, 2));
