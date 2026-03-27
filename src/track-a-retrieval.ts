/**
 * Track A Retrieval - Semantic + Hybrid Search Interface
 *
 * Provides memory retrieval using:
 * 1. Semantic search (embeddings + cosine similarity)
 * 2. Keyword search (FTS5 full-text)
 * 3. Hybrid combination (weighted ranking)
 *
 * Per user decision: Semantic search from day 1
 */

import fs from 'fs';
import path from 'path';
import { logger } from './logger.js';
import {
  generateEmbedding,
  searchSimilar,
  storeEmbedding,
  getIndexedCount,
  needsReindex,
} from './track-a-embeddings.js';
import { getDb } from './db.js';

export interface TrackAQuery {
  query: string;
  topK?: number;
  tier?: ('HOT' | 'WARM' | 'COLD')[];
  threshold?: number; // Minimum similarity (0-1)
  hybrid?: boolean; // Combine semantic + keyword
}

export interface TrackAResult {
  vaultPath: string;
  contentPreview: string;
  similarity: number;
  tier: string | null;
  rank: number;
}

/**
 * Index content from a vault file
 */
export async function indexVaultFile(
  vaultRoot: string,
  vaultPath: string,
  tier?: string,
  docType?: string,
): Promise<boolean> {
  const fullPath = path.join(vaultRoot, vaultPath);

  if (!fs.existsSync(fullPath)) {
    logger.warn({ vaultPath }, 'Cannot index - file not found');
    return false;
  }

  const content = fs.readFileSync(fullPath, 'utf-8');
  const contentHash = await hashContent(content);

  // Check if needs reindex
  if (!await needsReindex(vaultPath, contentHash)) {
    logger.debug({ vaultPath }, 'Content unchanged, skipping reindex');
    return true;
  }

  // Generate embedding
  const embedding = await generateEmbedding(content);
  if (!embedding) {
    logger.error({ vaultPath }, 'Failed to generate embedding');
    return false;
  }

  // Store in database
  storeEmbedding(vaultPath, contentHash, embedding, tier, docType);

  logger.info({ vaultPath, tier }, 'Indexed vault file');
  return true;
}

/**
 * Simple content hash for change detection
 */
async function hashContent(content: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(content);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Perform semantic search
 */
export async function semanticSearch(
  query: TrackAQuery,
): Promise<TrackAResult[]> {
  const { query: queryText, topK = 5, tier, threshold = 0.7 } = query;

  // Generate query embedding
  const queryEmbedding = await generateEmbedding(queryText);
  if (!queryEmbedding) {
    logger.warn('Failed to generate query embedding, returning empty results');
    return [];
  }

  // Search similar embeddings
  const tierFilter = tier?.map((t) => t.toLowerCase());
  const results = searchSimilar(queryEmbedding, topK, tierFilter, threshold);

  // Load content previews
  const output: TrackAResult[] = [];
  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    output.push({
      vaultPath: r.vault_path,
      contentPreview: '', // Loaded on demand
      similarity: r.similarity,
      tier: r.tier,
      rank: i + 1,
    });
  }

  return output;
}

/**
 * Perform keyword search using FTS5
 */
export function keywordSearch(
  query: TrackAQuery,
): TrackAResult[] {
  const { query: queryText, topK = 5, tier } = query;
  const db = getDb();

  // Build query - simple word extraction for now
  const words = queryText
    .toLowerCase()
    .replace(/[^\w\s]/g, '')
    .split(/\s+/)
    .filter((w) => w.length > 2);

  if (words.length === 0) {
    return [];
  }

  // Query embeddings table content via LIKE (FTS5 would be better but requires separate table)
  const likePattern = `%${words.join('%')}%`;

  let sql = `
    SELECT vault_path, tier, content_hash
    FROM embeddings
    WHERE vault_path LIKE ?
  `;
  const params: (string | string[])[] = [likePattern];

  if (tier && tier.length > 0) {
    sql += ` AND tier IN (${tier.map(() => '?').join(',')})`;
    params.push(...tier.map((t) => t.toLowerCase()));
  }

  sql += ` LIMIT ?`;
  params.push(topK.toString());

  const rows = db.prepare(sql).all(...params) as Array<{
    vault_path: string;
    tier: string | null;
    content_hash: string;
  }>;

  return rows.map((r, i) => ({
    vaultPath: r.vault_path,
    contentPreview: '',
    similarity: 0.5, // Base score for keyword matches
    tier: r.tier,
    rank: i + 1,
  }));
}

/**
 * Hybrid search: combine semantic + keyword results
 */
export async function hybridSearch(
  query: TrackAQuery,
): Promise<TrackAResult[]> {
  const { query: queryText, topK = 5, tier, threshold = 0.7 } = query;

  // Run both searches in parallel
  const [semanticResults, keywordResults] = await Promise.all([
    semanticSearch({ query: queryText, topK: topK * 2, tier, threshold }),
    Promise.resolve(keywordSearch({ query: queryText, topK: topK * 2, tier })),
  ]);

  // Merge results with weighted scoring
  const merged = new Map<string, TrackAResult>();

  // Add semantic results (weight: 0.7)
  for (const r of semanticResults) {
    merged.set(r.vaultPath, {
      ...r,
      similarity: r.similarity * 0.7,
    });
  }

  // Add keyword results (weight: 0.3)
  for (const r of keywordResults) {
    const existing = merged.get(r.vaultPath);
    if (existing) {
      // Boost existing with keyword score
      existing.similarity += r.similarity * 0.3;
    } else {
      merged.set(r.vaultPath, {
        ...r,
        similarity: r.similarity * 0.3,
      });
    }
  }

  // Sort by combined score and return topK
  const sorted = Array.from(merged.values())
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, topK);

  // Load content previews
  for (const r of sorted) {
    r.contentPreview = await loadContentPreview(r.vaultPath);
  }

  // Re-rank after loading previews
  return sorted.map((r, i) => ({ ...r, rank: i + 1 }));
}

/**
 * Load content preview for a result
 */
async function loadContentPreview(vaultPath: string): Promise<string> {
  // Note: vaultRoot not available here, would need to pass it in
  // For now return empty - caller should load if needed
  return '';
}

/**
 * Main query interface - dispatches to semantic or hybrid
 */
export async function queryTrackA(
  query: TrackAQuery,
  vaultRoot?: string, // Optional - for loading content previews
): Promise<TrackAResult[]> {
  if (query.hybrid !== false) {
    // Default to hybrid
    return hybridSearch(query);
  }
  return semanticSearch(query);
}

/**
 * Batch index multiple files
 */
export async function batchIndexFiles(
  vaultRoot: string,
  files: Array<{ path: string; tier?: string; docType?: string }>,
): Promise<{ succeeded: number; failed: number }> {
  let succeeded = 0;
  let failed = 0;

  for (const file of files) {
    const success = await indexVaultFile(
      vaultRoot,
      file.path,
      file.tier,
      file.docType,
    );
    if (success) {
      succeeded++;
    } else {
      failed++;
    }
  }

  logger.info({ succeeded, failed }, 'Batch indexing complete');
  return { succeeded, failed };
}

/**
 * Get search statistics
 */
export function getTrackAStats(): {
  indexedDocuments: number;
} {
  return {
    indexedDocuments: getIndexedCount(),
  };
}
