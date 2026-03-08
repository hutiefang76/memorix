/**
 * LLM Quality Benchmark — Real API测试
 *
 * 用真实 observations + 真实 LLM API 测量：
 * 1. 压缩率：narrative 压缩前后 token 数对比
 * 2. Reranking：LLM 重排 vs 原始排序的差异
 *
 * 运行: npx tsx tests/benchmarks/llm-quality-benchmark.ts
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const DATA_DIR = path.join(os.homedir(), '.memorix', 'data');
const API_BASE = process.env.MEMORIX_LLM_BASE_URL || 'https://api.rubbyai.com';
const API_KEY = process.env.MEMORIX_LLM_API_KEY || '';

if (!API_KEY) {
  console.error('❌ Set MEMORIX_LLM_API_KEY env var');
  process.exit(1);
}

// ── LLM Call ─────────────────────────────────────────────────────

async function callLLM(system: string, user: string): Promise<string> {
  let base = API_BASE.replace(/\/+$/, '');
  if (!base.endsWith('/v1')) base += '/v1';

  const res = await fetch(`${base}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${API_KEY}`,
    },
    body: JSON.stringify({
      model: 'gpt-5.4',
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      temperature: 0.1,
      max_tokens: 512,
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`API ${res.status}: ${err}`);
  }

  const data = await res.json() as any;
  return data.choices[0]?.message?.content ?? '';
}

// ── Token Estimator ──────────────────────────────────────────────

function estimateTokens(text: string): number {
  const cjk = (text.match(/[\u4e00-\u9fff\u3040-\u309f\u30a0-\u30ff\uac00-\ud7af]/g) || []).length;
  const other = text.length - cjk;
  return Math.ceil(cjk / 1.5 + other / 4);
}

// ── Compression Benchmark ────────────────────────────────────────

const COMPRESS_PROMPT = `You are a memory compression engine for a coding assistant.
Compress the given narrative into the shortest possible form that preserves ALL technical facts.
Rules:
- Aggressively remove: filler words, background context, debugging journey, repeated info
- Compress to MINIMUM viable length — aim for 50% or less of original
- Keep ONLY: specific values, file paths, error messages, version numbers, config keys, causal relationships
- Merge related points into single dense sentences
- Output the compressed text ONLY, no explanation or wrapper

Examples:
Input: "Final deployment model for shadcn-blog is stable: GitHub Actions build locally, SCP artifacts to VPS, systemd manages the process. Docker was considered but rejected due to complexity overhead for a simple blog. The whole pipeline takes about 2 minutes from push to live."
Output: "shadcn-blog部署: GH Actions构建→SCP到VPS→systemd管理, 弃Docker(复杂度过高), push到上线~2min"`;

async function benchmarkCompression() {
  console.log('\n' + '═'.repeat(60));
  console.log('📊 COMPRESSION BENCHMARK');
  console.log('═'.repeat(60));

  const raw = await fs.readFile(path.join(DATA_DIR, 'observations.json'), 'utf-8');
  const all = JSON.parse(raw) as any[];

  // Smart filter: only compress narrative-worthy content (skip commands, paths, short auto-captured)
  const SKIP_PATTERNS = [
    /^(?:Command|Run|Execute):\s/i,
    /^(?:File|Edit|Changed):\s/i,
    /^git\s+(?:add|commit|push|pull|log)/i,
    /^(?:npm|npx|pnpm|yarn|bun)\s/i,
    /^(?:Remove-Item|New-Item|Set-Content)/i,
    /^[A-Za-z]:\\[\w\\]/,
    /^\/(?:usr|home|var|etc|opt)\//,
  ];
  const LOW_TYPES = new Set(['what-changed', 'discovery', 'session-request']);

  function shouldSkip(obs: any): boolean {
    const n = obs.narrative || '';
    const firstLine = n.split('\n')[0];
    if (SKIP_PATTERNS.some((p: RegExp) => p.test(firstLine))) return true;
    if (LOW_TYPES.has(obs.type) && n.length < 200) return true;
    const specials = (n.match(/[{}()\[\]<>:;=|\\\/\-_\.@#$%^&*+~`"']/g) || []).length;
    if (specials / n.length > 0.35) return true;
    return false;
  }

  const allCandidates = all.filter((o: any) => o.narrative && o.narrative.length > 80 && o.status !== 'archived');
  const skipped = allCandidates.filter(shouldSkip);
  const candidates = allCandidates.filter((o: any) => !shouldSkip(o)).slice(0, 20);

  console.log(`\nTotal > 80 chars: ${allCandidates.length}`);
  console.log(`Smart-skipped (commands/paths/short auto-captured): ${skipped.length}`);
  console.log(`Compression candidates: ${candidates.length} (testing up to 20)\n`);

  let totalOriginal = 0;
  let totalCompressed = 0;
  let successCount = 0;

  for (let i = 0; i < candidates.length; i++) {
    const obs = candidates[i];
    const originalTokens = estimateTokens(obs.narrative);

    try {
      const compressed = await callLLM(COMPRESS_PROMPT, obs.narrative);

      if (!compressed || compressed.length >= obs.narrative.length) {
        console.log(`  ${i + 1}. ⏭️ #${obs.id} — LLM returned longer/empty, skipped`);
        totalOriginal += originalTokens;
        totalCompressed += originalTokens;
        continue;
      }

      const compressedTokens = estimateTokens(compressed);
      const reduction = ((originalTokens - compressedTokens) / originalTokens * 100).toFixed(1);

      totalOriginal += originalTokens;
      totalCompressed += compressedTokens;
      successCount++;

      console.log(`  ${i + 1}. ✅ #${obs.id} [${obs.type}] ${originalTokens}→${compressedTokens} tokens (↓${reduction}%)`);
      console.log(`     原: ${obs.narrative.substring(0, 60)}...`);
      console.log(`     压: ${compressed.substring(0, 60)}${compressed.length > 60 ? '...' : ''}`);
    } catch (err) {
      console.log(`  ${i + 1}. ❌ #${obs.id} — ${(err as Error).message}`);
      totalOriginal += originalTokens;
      totalCompressed += originalTokens;
    }
  }

  const overallReduction = ((totalOriginal - totalCompressed) / totalOriginal * 100).toFixed(1);
  console.log('\n' + '─'.repeat(60));
  console.log(`📈 Results:`);
  console.log(`   Samples tested: ${candidates.length}`);
  console.log(`   Successfully compressed: ${successCount}`);
  console.log(`   Total original tokens: ${totalOriginal}`);
  console.log(`   Total compressed tokens: ${totalCompressed}`);
  console.log(`   Overall reduction: ↓${overallReduction}%`);
  console.log('─'.repeat(60));

  return { totalOriginal, totalCompressed, reduction: parseFloat(overallReduction), samples: candidates.length, success: successCount };
}

// ── Reranking Benchmark ──────────────────────────────────────────

const RERANK_PROMPT = `You are a memory relevance ranker for a coding assistant.
Given a QUERY and CANDIDATE memories, rerank by relevance.
Output ONLY a JSON array of IDs in order of relevance (most relevant first).
Include ALL candidate IDs.`;

async function benchmarkReranking() {
  console.log('\n' + '═'.repeat(60));
  console.log('📊 RERANKING BENCHMARK');
  console.log('═'.repeat(60));

  // Test queries that have known "best" results
  const queries = [
    { query: 'JWT authentication token', expectedTop: ['jwt', 'auth', 'token'] },
    { query: 'MCP server configuration', expectedTop: ['mcp', 'server', 'config'] },
    { query: 'hooks handler bug', expectedTop: ['hook', 'handler', 'bug'] },
    { query: 'project isolation memory', expectedTop: ['project', 'isolation', 'memory'] },
    { query: 'retention decay archive', expectedTop: ['retention', 'decay', 'archive'] },
  ];

  const raw = await fs.readFile(path.join(DATA_DIR, 'observations.json'), 'utf-8');
  const all = JSON.parse(raw) as any[];
  const active = all.filter((o: any) => o.status !== 'archived');

  let totalRerankChanges = 0;
  let totalQueries = 0;

  for (const { query, expectedTop } of queries) {
    // Simulate BM25-style initial ranking (keyword match count)
    const scored = active.map((o: any) => {
      const text = `${o.title} ${o.narrative} ${(o.facts || []).join(' ')} ${(o.concepts || []).join(' ')}`.toLowerCase();
      const queryTokens = query.toLowerCase().split(/\s+/);
      const matchCount = queryTokens.filter(t => text.includes(t)).length;
      return { id: o.id, title: o.title, type: o.type, score: matchCount, narrative: o.narrative?.substring(0, 100) };
    }).filter(o => o.score > 0).sort((a, b) => b.score - a.score).slice(0, 8);

    if (scored.length < 3) {
      console.log(`\n  ⏭️ Query: "${query}" — too few matches (${scored.length}), skipped`);
      continue;
    }

    const originalOrder = scored.map(s => s.id);

    try {
      const candidateList = scored.map(c =>
        `[ID: ${c.id}] (${c.type}) ${c.title}${c.narrative ? ` — ${c.narrative}` : ''}`,
      ).join('\n');

      const response = await callLLM(RERANK_PROMPT, `QUERY: ${query}\n\nCANDIDATES:\n${candidateList}`);

      let content = response.trim();
      if (content.startsWith('```')) {
        content = content.replace(/^```(?:json)?\s*/, '').replace(/\s*```$/, '');
      }
      const rerankedIds = JSON.parse(content) as number[];

      // Count position changes
      let positionChanges = 0;
      for (let i = 0; i < Math.min(rerankedIds.length, originalOrder.length); i++) {
        if (rerankedIds[i] !== originalOrder[i]) positionChanges++;
      }

      // Check if reranked top results are more relevant (contain expected keywords)
      const topReranked = scored.find(s => s.id === rerankedIds[0]);
      const topOriginal = scored[0];
      const topRerankedText = `${topReranked?.title} ${topReranked?.narrative}`.toLowerCase();
      const topOriginalText = `${topOriginal.title} ${topOriginal.narrative}`.toLowerCase();
      const rerankedHits = expectedTop.filter(k => topRerankedText.includes(k)).length;
      const originalHits = expectedTop.filter(k => topOriginalText.includes(k)).length;

      totalRerankChanges += positionChanges;
      totalQueries++;

      console.log(`\n  Query: "${query}"`);
      console.log(`    Original #1: "${topOriginal.title}" (keyword hits: ${originalHits}/${expectedTop.length})`);
      console.log(`    Reranked #1: "${topReranked?.title}" (keyword hits: ${rerankedHits}/${expectedTop.length})`);
      console.log(`    Position changes: ${positionChanges}/${scored.length}`);
      console.log(`    Improvement: ${rerankedHits > originalHits ? '✅ Better' : rerankedHits === originalHits ? '➡️ Same' : '❌ Worse'}`);
    } catch (err) {
      console.log(`\n  ❌ Query: "${query}" — ${(err as Error).message}`);
    }
  }

  console.log('\n' + '─'.repeat(60));
  console.log(`📈 Reranking Results:`);
  console.log(`   Queries tested: ${totalQueries}`);
  console.log(`   Avg position changes: ${totalQueries > 0 ? (totalRerankChanges / totalQueries).toFixed(1) : 'N/A'}`);
  console.log('─'.repeat(60));
}

// ── Main ─────────────────────────────────────────────────────────

async function main() {
  console.log('🔬 Memorix LLM Quality Benchmark');
  console.log(`API: ${API_BASE}`);
  console.log(`Data: ${DATA_DIR}`);

  const compression = await benchmarkCompression();
  await benchmarkReranking();

  console.log('\n' + '═'.repeat(60));
  console.log('📋 FINAL SUMMARY');
  console.log('═'.repeat(60));
  console.log(`Compression: ↓${compression.reduction}% token reduction (${compression.success}/${compression.samples} successful)`);
}

main().catch(console.error);
