/**
 * Compact Engine
 *
 * Orchestrates the 3-layer Progressive Disclosure workflow.
 * Source: claude-mem's proven architecture (27K stars, ~10x token savings).
 *
 * Layer 1 (search)   → Compact index with IDs (~50-100 tokens/result)
 * Layer 2 (timeline) → Chronological context around an observation
 * Layer 3 (detail)   → Full observation content (~500-1000 tokens/result)
 */

import type { SearchOptions, IndexEntry, TimelineContext, MemorixDocument } from '../types.js';
import { searchObservations, getTimeline } from '../store/orama-store.js';
import { getObservation, getAllObservations } from '../memory/observations.js';
import { formatIndexTable, formatTimeline, formatObservationDetail } from './index-format.js';
import { countTextTokens } from './token-budget.js';

/**
 * Layer 1: Search and return a compact index.
 * Agent scans this to decide which observations to fetch in detail.
 */
export async function compactSearch(options: SearchOptions): Promise<{
  entries: IndexEntry[];
  formatted: string;
  totalTokens: number;
}> {
  const entries = await searchObservations(options);
  const formatted = formatIndexTable(entries, options.query);
  const totalTokens = countTextTokens(formatted);

  return { entries, formatted, totalTokens };
}

/**
 * Layer 2: Get timeline context around an anchor observation.
 * Shows what happened before and after for temporal understanding.
 */
export async function compactTimeline(
  anchorId: number,
  projectId?: string,
  depthBefore = 3,
  depthAfter = 3,
): Promise<{
  timeline: TimelineContext;
  formatted: string;
  totalTokens: number;
}> {
  const result = await getTimeline(anchorId, projectId, depthBefore, depthAfter);

  const timeline: TimelineContext = {
    anchorId,
    anchorEntry: result.anchor,
    before: result.before,
    after: result.after,
  };

  const formatted = formatTimeline(timeline);
  const totalTokens = countTextTokens(formatted);

  return { timeline, formatted, totalTokens };
}

/**
 * Layer 3: Get full observation details by IDs.
 * Only called after the agent has filtered via L1/L2.
 */
export async function compactDetail(
  ids: number[],
): Promise<{
  documents: MemorixDocument[];
  formatted: string;
  totalTokens: number;
}> {
  // Use in-memory observations for reliable ID lookup (Orama where-clause
  // can be unreliable with empty term + number filter)
  const documents: MemorixDocument[] = [];
  for (const id of ids) {
    const obs = getObservation(id);
    if (obs) {
      documents.push({
        id: `obs-${obs.id}`,
        observationId: obs.id,
        entityName: obs.entityName,
        type: obs.type,
        title: obs.title,
        narrative: obs.narrative,
        facts: obs.facts.join('\n'),
        filesModified: obs.filesModified.join('\n'),
        concepts: obs.concepts.join(', '),
        tokens: obs.tokens,
        createdAt: obs.createdAt,
        projectId: obs.projectId,
        accessCount: 0,
        lastAccessedAt: '',
        status: obs.status ?? 'active',
        source: obs.source ?? 'agent',
      });
    }
  }

  // Build cross-reference map for all requested observations
  const allObs = getAllObservations();
  const crossRefMap = new Map<number, string[]>();
  for (const id of ids) {
    const obs = getObservation(id);
    if (!obs) continue;
    const refs: string[] = [];

    // Source badge
    if (obs.source === 'git' && obs.commitHash) {
      refs.push(`Source: git commit ${obs.commitHash.substring(0, 7)}`);
    } else if (obs.source) {
      refs.push(`Source: ${obs.source}`);
    }

    // Explicit relatedCommits
    if (obs.relatedCommits && obs.relatedCommits.length > 0) {
      refs.push(`Related commits: ${obs.relatedCommits.map(h => h.substring(0, 7)).join(', ')}`);
      // Auto-find git memories for those commits
      const gitMems = allObs.filter(o => o.source === 'git' && o.commitHash && obs.relatedCommits!.includes(o.commitHash));
      for (const gm of gitMems) {
        refs.push(`  → #${gm.id} 🟢 ${gm.title}`);
      }
    }

    // Explicit relatedEntities
    if (obs.relatedEntities && obs.relatedEntities.length > 0) {
      refs.push(`Related entities: ${obs.relatedEntities.join(', ')}`);
    }

    // Auto cross-reference: if this is a git memory, find reasoning memories for same entity
    if (obs.source === 'git') {
      const reasoning = allObs.filter(o =>
        o.type === 'reasoning' && o.entityName === obs.entityName && o.id !== obs.id && o.status !== 'archived',
      ).slice(0, 3);
      if (reasoning.length > 0) {
        refs.push('Related reasoning:');
        for (const r of reasoning) {
          refs.push(`  → #${r.id} 🧠 ${r.title}`);
        }
      }
    }

    // Auto cross-reference: if this is a reasoning memory, find git memories for same entity
    if (obs.type === 'reasoning') {
      const gitMems = allObs.filter(o =>
        o.source === 'git' && o.entityName === obs.entityName && o.id !== obs.id && o.status !== 'archived',
      ).slice(0, 3);
      if (gitMems.length > 0) {
        refs.push('Related commits:');
        for (const g of gitMems) {
          refs.push(`  → #${g.id} 🟢 ${g.title}`);
        }
      }
    }

    if (refs.length > 0) crossRefMap.set(obs.id, refs);
  }

  const formattedParts = documents.map((doc: MemorixDocument) => {
    let detail = formatObservationDetail(doc);
    const refs = crossRefMap.get(doc.observationId);
    if (refs && refs.length > 0) {
      detail += '\n\nCross-references:\n' + refs.join('\n');
    }
    return detail;
  });

  const formatted = formattedParts.join('\n\n' + '═'.repeat(50) + '\n\n');
  const totalTokens = countTextTokens(formatted);

  return { documents, formatted, totalTokens };
}
