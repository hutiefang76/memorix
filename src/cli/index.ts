/**
 * Memorix CLI
 *
 * Command-line interface for Memorix management.
 * Built with: citty (1.1K stars, zero-deps) + @clack/prompts (7.4K stars)
 *
 * Commands:
 *   memorix         — Interactive TUI menu (no args)
 *   memorix serve   — Start MCP Server on stdio
 *   memorix status  — Show project info + rules sync status
 *   memorix sync    — Interactive cross-agent rule sync
 */

import { defineCommand, runMain } from 'citty';
import { createRequire } from 'node:module';
import * as p from '@clack/prompts';
import { execSync, spawn } from 'node:child_process';

const require = createRequire(import.meta.url);
const pkg = require('../../package.json') as { version: string };

// ============================================================
// Interactive TUI Menu
// ============================================================

async function interactiveMenu(): Promise<void> {
  p.intro(`🧠 Memorix v${pkg.version} — Cross-Agent Memory Bridge`);

  const action = await p.select({
    message: 'What would you like to do?',
    options: [
      { value: 'search', label: '🔍 Search memories', hint: 'Find memories by keyword' },
      { value: 'list', label: '📋 View recent memories', hint: 'Show latest observations' },
      { value: 'dashboard', label: '📊 Open Dashboard', hint: 'Web UI at localhost:3210' },
      { value: 'hooks', label: '🔗 Install hooks', hint: 'Set up auto-capture for IDEs' },
      { value: 'status', label: '📈 Project status', hint: 'Show project info + stats' },
      { value: 'cleanup', label: '🧹 Clean up', hint: 'Remove old/resolved memories' },
      { value: 'sync', label: '🔄 Sync rules', hint: 'Cross-agent rule synchronization' },
      { value: 'serve', label: '🚀 Start MCP server', hint: 'For IDE integration' },
    ],
  });

  if (p.isCancel(action)) {
    p.cancel('Goodbye!');
    process.exit(0);
  }

  switch (action) {
    case 'search': {
      const query = await p.text({
        message: 'Enter search query:',
        placeholder: 'e.g., authentication bug fix',
      });
      if (p.isCancel(query) || !query) {
        p.cancel('Search cancelled');
        return;
      }
      await runSearch(query);
      break;
    }
    case 'list':
      await runList();
      break;
    case 'dashboard':
      await runCommand('dashboard');
      break;
    case 'hooks':
      await runCommand('hooks', ['install']);
      break;
    case 'status':
      await runCommand('status');
      break;
    case 'cleanup':
      await runCommand('cleanup');
      break;
    case 'sync':
      await runCommand('sync');
      break;
    case 'serve':
      p.log.info('Starting MCP server on stdio...');
      await runCommand('serve');
      break;
  }
}

async function runSearch(query: string): Promise<void> {
  const s = p.spinner();
  s.start('Searching memories...');
  
  try {
    const { searchObservations, getDb } = await import('../store/orama-store.js');
    const { getProjectDataDir } = await import('../store/persistence.js');
    const { detectProject } = await import('../project/detector.js');
    const { initObservations } = await import('../memory/observations.js');
    
    const project = await detectProject(process.cwd());
    const dataDir = await getProjectDataDir(project.id);
    await initObservations(dataDir);
    await getDb(); // Ensure Orama is initialized
    
    const results = await searchObservations({ query, limit: 10, projectId: project.id });
    s.stop('Search complete');
    
    if (results.length === 0) {
      p.log.warn('No memories found matching your query.');
      return;
    }
    
    p.log.success(`Found ${results.length} memories:`);
    console.log('');
    for (const r of results) {
      console.log(`  ${r.icon} #${r.id} ${r.title}`);
      console.log(`     ${r.time} | ${r.tokens} tokens | score: ${(r.score ?? 0).toFixed(2)}`);
      console.log('');
    }
  } catch (err) {
    s.stop('Search failed');
    p.log.error(`Error: ${err instanceof Error ? err.message : err}`);
  }
}

async function runList(): Promise<void> {
  const s = p.spinner();
  s.start('Loading recent memories...');
  
  try {
    const { getProjectDataDir, loadObservationsJson } = await import('../store/persistence.js');
    const { detectProject } = await import('../project/detector.js');
    
    const project = await detectProject(process.cwd());
    const dataDir = await getProjectDataDir(project.id);
    const observations = await loadObservationsJson(dataDir) as Array<{
      id: number; title: string; type: string; timestamp: string; status?: string;
    }>;
    
    const active = observations.filter(o => (o.status ?? 'active') === 'active');
    const recent = active.slice(-10).reverse();
    
    s.stop(`Project: ${project.name} (${active.length} active memories)`);
    
    if (recent.length === 0) {
      p.log.warn('No memories found.');
      return;
    }
    
    console.log('');
    for (const o of recent) {
      const icon = { gotcha: '🔴', decision: '🟤', 'problem-solution': '🟡', discovery: '🟣', 'how-it-works': '🔵', 'what-changed': '🟢' }[o.type] ?? '📝';
      console.log(`  ${icon} #${o.id} ${o.title?.slice(0, 60) ?? '(untitled)'}`);
    }
    console.log('');
  } catch (err) {
    s.stop('Failed to load memories');
    p.log.error(`Error: ${err instanceof Error ? err.message : err}`);
  }
}

async function runCommand(cmd: string, args: string[] = []): Promise<void> {
  const module = await import(`./commands/${cmd}.js`);
  if (module.default?.run) {
    await module.default.run({ args });
  }
}

// ============================================================
// Main command
// ============================================================

const main = defineCommand({
  meta: {
    name: 'memorix',
    version: pkg.version,
    description: 'Cross-Agent Memory Bridge — Universal memory layer for AI coding agents via MCP',
  },
  subCommands: {
    serve: () => import('./commands/serve.js').then(m => m.default),
    status: () => import('./commands/status.js').then(m => m.default),
    sync: () => import('./commands/sync.js').then(m => m.default),
    hook: () => import('./commands/hook.js').then(m => m.default),
    hooks: () => import('./commands/hooks.js').then(m => m.default),
    dashboard: () => import('./commands/dashboard.js').then(m => m.default),
    cleanup: () => import('./commands/cleanup.js').then(m => m.default),
  },
  async run() {
    // No subcommand provided — show interactive TUI menu
    await interactiveMenu();
  },
});

runMain(main);
