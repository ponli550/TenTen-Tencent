import { Env, Page } from "./types";
import { filterAllowedPages } from "./permissions";

export async function embedTexts(env: Env, texts: string[]): Promise<number[][]> {
  // bge-base-en-v1.5 takes { text } singular. Loop + cache in D1 afterwards.
  const out: number[][] = [];
  for (const t of texts) {
    const res = (await env.AI.run(env.EMBED_MODEL, { text: t })) as {
      shape?: number[];
      data: number[][] | { embedding: number[] };
    };
    if (Array.isArray(res.data)) {
      out.push(res.data[0]);
    } else {
      out.push(res.data.embedding);
    }
  }
  return out;
}

export function cosineSim(a: number[], b: number[]): number {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom === 0 ? 0 : dot / denom;
}

/** Recompute a page's embedding when it's stale (freshness). */
export async function ensureEmbeddingFresh(env: Env, page: Page, currentEmbed: string | null) {
  if (currentEmbed && page.updated_at <= currentEmbed.split("::")[0]) return;
  const [vec] = await embedTexts(env, [page.title + "\n" + page.body]);
  await env.DB.prepare(
    `INSERT INTO page_embeddings (page_id, embedding, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(page_id) DO UPDATE SET embedding = excluded.embedding, updated_at = excluded.updated_at`,
  )
    .bind(page.id, `${page.updated_at}::${JSON.stringify(vec)}`, new Date().toISOString())
    .run();
}

/**
 * Permission-aware retrieval: embed the query, rank all pages by cosine
 * similarity, then filter to pages the ACTOR may view BEFORE any LLM call.
 * Denied candidates never enter the context window (no prompt-injection
 * via retrieved content, no leakage of denied content).
 */
export async function permissionAwareRetrieve(
  env: Env,
  userId: number,
  query: string,
  topK = 6,
): Promise<{ candidates: Page[]; allowed: Page[]; deniedIds: number[] }> {
  // Freshness pass: re-embed any page updated since its last embed.
  const pages = await env.DB.prepare(
    `SELECT p.*, e.embedding AS emb
       FROM pages p
       LEFT JOIN page_embeddings e ON e.page_id = p.id`,
  ).all<Page & { emb: string | null }>();

  for (const p of pages.results) {
    await ensureEmbeddingFresh(env, { ...p }, p.emb);
  }

  const fresh = await env.DB.prepare(
    `SELECT p.*, e.embedding AS emb
       FROM pages p
       LEFT JOIN page_embeddings e ON e.page_id = p.id`,
  ).all<Page & { emb: string | null }>();

  const [q] = await embedTexts(env, [query]);

  const ranked = fresh.results
    .map((p) => {
      const embJson = p.emb?.split("::")[1];
      let score = -1;
      if (embJson) {
        try {
          score = cosineSim(q, JSON.parse(embJson));
        } catch {
          score = -1;
        }
      }
      return { page: p, score };
    })
    .sort((a, b) => b.score - a.score);

  const candidates = ranked
    .filter((r) => r.score > 0.25)
    .slice(0, topK)
    .map((r) => r.page);

  const { allowed, denied } = await filterAllowedPages(
    env.DB,
    userId,
    candidates.map((p) => ({ id: p.id, space_id: p.space_id })),
  );

  return {
    candidates,
    allowed: candidates.filter((p) => allowed.includes(p.id)),
    deniedIds: denied,
  };
}