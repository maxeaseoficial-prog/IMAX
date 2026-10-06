const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Orchestrator } = require('../electron/orchestrator.cjs');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'imx-codex-workspace-'));
const fakeCli = path.join(root, 'codex-fixture.cjs');
fs.writeFileSync(fakeCli, '#!' + process.execPath + '\n' + `
const args = process.argv.slice(2);
if (!args.includes('--skip-git-repo-check')) {
  console.error('Not inside a trusted directory and --skip-git-repo-check was not specified.');
  process.exit(1);
}
console.log('workspace accepted');
`, { mode: 0o755 });
const manager = new Orchestrator({
  terminalManager: {}, state: { listMissions: () => [] }, codexPath: fakeCli,
  baseEnv: process.env, worktreesRoot: path.join(root, 'worktrees'), emit() {}
});
(async () => {
  const planner = manager.buildExecArgs('plan');
  assert.deepEqual(planner, ['exec', '--skip-git-repo-check', 'plan']);
  const agent = manager.buildExecArgs('build', { fullAuto: true, images: ['picture.png'] });
  assert.deepEqual(agent, ['-a', 'never', 'exec', '--sandbox', 'workspace-write', '--skip-git-repo-check', '-i', 'picture.png', 'build']);
  const resumed = manager.buildExecArgs('adjust', { fullAuto: true, resumeSessionId: 'session-id' });
  assert.deepEqual(resumed, ['-a', 'never', '-c', 'sandbox_mode="workspace-write"', 'exec', 'resume', 'session-id', '--skip-git-repo-check', 'adjust']);
  for (const args of [planner, agent, resumed]) {
    assert.equal(args.includes('--dangerously-bypass-approvals-and-sandbox'), false);
    assert.equal(args.includes('danger-full-access'), false);
  }
  assert.equal(fs.existsSync(path.join(root, '.git')), false);
  assert.match(await manager.runCodex('plan', root, null), /workspace accepted/);
  console.log('PASS: planning in a non-Git workspace, initial/resumed agent arguments, images and unchanged sandbox policy (CLI fixture).');
})().catch(error => { console.error(error); process.exitCode = 1; })
  .finally(() => fs.rmSync(root, { recursive: true, force: true }));
