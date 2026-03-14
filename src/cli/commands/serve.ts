/**
 * memorix serve — Start MCP Server on stdio
 */

import { defineCommand } from 'citty';

export default defineCommand({
  meta: {
    name: 'serve',
    description: 'Start Memorix MCP Server on stdio transport',
  },
  args: {
    cwd: {
      type: 'string',
      description: 'Project working directory (defaults to process.cwd())',
      required: false,
    },
  },
  run: async ({ args }) => {
    const { StdioServerTransport } = await import(
      '@modelcontextprotocol/sdk/server/stdio.js'
    );
    const { createMemorixServer } = await import('../../server.js');
    const { detectProject, findGitInSubdirs, isSystemDirectory } = await import('../../project/detector.js');
    const { homedir } = await import('node:os');

    // Auto-exit when stdio pipe breaks (IDE closed) to prevent orphaned processes
    process.stdin.on('end', () => {
      console.error('[memorix] stdin closed — exiting');
      process.exit(0);
    });

    // Priority: explicit --cwd arg > MEMORIX_PROJECT_ROOT env > INIT_CWD (npm lifecycle) > process.cwd()
    let safeCwd: string;
    try { safeCwd = process.cwd(); } catch { safeCwd = homedir(); }
    let projectRoot = args.cwd || process.env.MEMORIX_PROJECT_ROOT || process.env.INIT_CWD || safeCwd;

    console.error(`[memorix] Starting with cwd: ${projectRoot}`);

    // Strict .git detection — no .git = not a project
    let detected = detectProject(projectRoot);

    // Multi-project workspace: cwd has no .git, scan immediate subdirs
    if (!detected) {
      const subGit = findGitInSubdirs(projectRoot);
      if (subGit) {
        console.error(`[memorix] Found .git in subdirectory: ${subGit}`);
        projectRoot = subGit;
        detected = detectProject(subGit);
      }
    }

    // System directory fallback: IDEs often set cwd to their install dir or System32.
    // Try: 1) last known project root, 2) home directory scan.
    if (!detected && isSystemDirectory(projectRoot)) {
      console.error(`[memorix] ⚠️ System directory detected: ${projectRoot}`);
      console.error(`[memorix] Your IDE launched memorix from a non-workspace directory.`);
      console.error(`[memorix] Fix: add --cwd to your MCP config, e.g. args: ["serve", "--cwd", "/path/to/project"]`);

      // Try last known project root first (persisted from previous successful detection)
      const { existsSync, readFileSync } = await import('node:fs');
      const path = await import('node:path');
      const lastRootFile = path.join(homedir(), '.memorix', 'last-project-root');
      if (existsSync(lastRootFile)) {
        try {
          const lastRoot = readFileSync(lastRootFile, 'utf-8').trim();
          if (lastRoot && existsSync(lastRoot)) {
            detected = detectProject(lastRoot);
            if (detected) {
              console.error(`[memorix] Restored last known project: ${lastRoot}`);
              projectRoot = lastRoot;
            }
          }
        } catch { /* ignore read errors */ }
      }

      // Fall back to home directory scan
      if (!detected) {
        const home = homedir();
        detected = detectProject(home);
        if (detected) {
          projectRoot = home;
        } else {
          const homeSubGit = findGitInSubdirs(home);
          if (homeSubGit) {
            console.error(`[memorix] Found .git in home subdirectory: ${homeSubGit}`);
            projectRoot = homeSubGit;
            detected = detectProject(homeSubGit);
          }
        }
      }

      if (!detected) {
        console.error(`[memorix] ❌ No git project found. Project will use untracked/ fallback.`);
        console.error(`[memorix] To fix, add --cwd to your IDE's MCP config pointing to your project root.`);
      }
    }

    // Persist successful project root for future system-directory fallback
    if (detected) {
      try {
        const { writeFileSync, mkdirSync } = await import('node:fs');
        const path = await import('node:path');
        const memorixDir = path.join(homedir(), '.memorix');
        mkdirSync(memorixDir, { recursive: true });
        writeFileSync(path.join(memorixDir, 'last-project-root'), detected.rootPath, 'utf-8');
      } catch { /* non-critical */ }
    }

    // Always register ALL tools BEFORE connecting transport.
    // This ensures tools/list returns the full tool set immediately on connect.
    // createMemorixServer handles no-.git gracefully (untracked/ fallback).
    const { server, projectId, deferredInit } = await createMemorixServer(projectRoot);
    const transport = new StdioServerTransport();
    await server.connect(transport);

    console.error(`[memorix] MCP Server running on stdio (project: ${projectId})`);
    console.error(`[memorix] Project root: ${detected?.rootPath ?? projectRoot}`);
    deferredInit().catch(e => console.error(`[memorix] Deferred init error:`, e));
    import('../update-checker.js').then(m => m.checkForUpdates()).catch(() => {});
  },
});
