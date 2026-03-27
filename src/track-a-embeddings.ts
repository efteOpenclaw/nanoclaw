/**
 * Track A Embeddings - Semantic Search Foundation
 *
 * Generates embeddings using all-MiniLM-L6-v2 via transformers.js
 * Stores vectors in SQLite for fast retrieval
 *
 * Per user decision: Semantic search from day 1
 */

import { logger } from './logger.js';
import {
  storeEmbedding as dbStoreEmbedding,
  getEmbedding as dbGetEmbedding,
  deleteEmbedding as dbDeleteEmbedding,
  getIndexedCount as dbGetIndexedCount,
  clearEmbeddings as dbClearEmbeddings,
  searchSimilarEmbeddings,
} from './db.js';

// Lazy-loaded embedder
let embedder: ((text: string) => Promise<Float32Array>) | null = null;
let embedderReady = false;

/**
 * Initialize the embedding model
 */
export async function initializeEmbeddings(): Promise<boolean> {
  if (embedderReady) {
    return true;
  }

  try {
    // Dynamic import to avoid loading on startup if not needed
    const { pipeline } = await import('@xenova/transformers');

    const model = await pipeline(
      'feature-extraction',
      'Xenova/all-MiniLM-L6-v2',
      { quantized: false }, // Full precision for better quality
    );

    embedder = async (text: string): Promise<Float32Array> => {
      const output = await model(text, {
        pooling: 'mean',
        normalize: true,
      });
      return output.data as Float32Array;
    };

    embedderReady = true;
    logger.info('Embedding model initialized');
    return true;
  } catch (err) {
    logger.error({ err }, 'Failed to initialize embedding model');
    embedderReady = false;
    return false;
  }
}

/**
 * Generate embedding for text
 */
export async function generateEmbedding(text: string): Promise<Float32Array | null> {
  if (!embedderReady || !embedder) {
    const initialized = await initializeEmbeddings();
    if (!initialized) {
      return null;
    }
  }

  try {
    // Truncate long text (model limit ~512 tokens)
    const truncated = text.slice(0, 2000);
    const embedding = await embedder!(truncated);
    return embedding;
  } catch (err) {
    logger.error({ err, textLength: text.length }, 'Failed to generate embedding');
    return null;
  }
}

/**
 * Store embedding in database
 */
export function storeEmbedding(
  vaultPath: string,
  contentHash: string,
  embedding: Float32Array,
  tier?: string,
  docType?: string,
): void {
  dbStoreEmbedding(vaultPath, contentHash, embedding, tier, docType);
  logger.debug({ vaultPath, tier }, 'Stored embedding');
}

/**
 * Get embedding for a vault path
 */
export function getEmbedding(vaultPath: string): Float32Array | null {
  return dbGetEmbedding(vaultPath);
}

/**
 * Calculate cosine similarity between two embeddings
 */
export function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  const similarity = dot / (Math.sqrt(normA) * Math.sqrt(normB));
  return similarity;
}

/**
 * Search for similar embeddings
 */
export function searchSimilar(
  queryEmbedding: Float32Array,
  topK: number = 5,
  tier?: string[],
  minSimilarity: number = 0.7,
): Array<{ vault_path: string; similarity: number; tier: string | null }> {
  return searchSimilarEmbeddings(queryEmbedding, topK, tier, minSimilarity);
}

/**
 * Delete embedding for a vault path
 */
export function deleteEmbedding(vaultPath: string): void {
  dbDeleteEmbedding(vaultPath);
  logger.debug({ vaultPath }, 'Deleted embedding');
}

/**
 * Check if embedding needs update (content changed)
 */
export async function needsReindex(vaultPath: string, contentHash: string): Promise<boolean> {
  // Check if file exists in embeddings with different hash
  const existing = dbGetEmbedding(vaultPath);
  if (!existing) {
    return true;
  }
  // Would need to store content_hash separately to check this properly
  // For now, always reindex if exists
  return true;
}

/**
 * Get indexed document count
 */
export function getIndexedCount(): number {
  return dbGetIndexedCount();
}

/**
 * Clear all embeddings (for rebuild)
 */
export function clearEmbeddings(): void {
  dbClearEmbeddings();
  logger.info('Cleared all embeddings');
}
