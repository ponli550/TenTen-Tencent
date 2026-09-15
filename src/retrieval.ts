import { Env, Document } from "./types";
import { filterAllowedDocs } from "./permissions";

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

/** Recompute a document's embedding when stale (freshness). */
export async function ensureEmbeddingFresh(
  env: Env,
  doc: Document,
  currentEmbed: string | null,
) {
  if (currentEmbed && doc.updated_at <= currentEmbed.split("::")[0]) return;
  const [vec] = await embedTexts(env, [doc.title + "\n" + doc.body]);
  await env.DB.prepare(
    `INSERT INTO document_embeddings (document_id, embedding, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(document_id) DO UPDATE SET embedding = excluded.embedding, updated_at = excluded.updated_at`,
  )
    .bind(doc.id, `${doc.updated_at}::${JSON.stringify(vec)}`, new Date().toISOString())
    .run();
}

/**
 * Cross-platform permission-aware retrieval. One embed+rank pass over the
 * unified corpus, then EVERY candidate is filtered through its platform's own
 * ACL before the LLM ever sees it. Denied documents do not enter the context
 * window — no leakage, no prompt-injection-via-retrieved-content.
 */
export async function permissionAwareRetrieve(
  env: Env,
  userId: number,
  query: string,
  topK = 8,
): Promise<{ candidates: Document[]; allowed: Document[]; deniedIds: number[] }> {
  // Freshness pass: re-embed any doc updated since its last embed.
  const docs = await env.DB.prepare(
    `SELECT d.*, e.embedding AS emb
       FROM documents d
       LEFT JOIN document_embeddings e ON e.document_id = d.id`,
  ).all<Document & { emb: string | null }>();

  for (const d of docs.results) {
    await ensureEmbeddingFresh(env, d, d.emb);
  }

  const fresh = await env.DB.prepare(
    `SELECT d.*, e.embedding AS emb
       FROM documents d
       LEFT JOIN document_embeddings e ON e.document_id = d.id`,
  ).all<Document & { emb: string | null }>();

  const [q] = await embedTexts(env, [query]);

  const ranked = fresh.results
    .map((d) => {
      const embJson = d.emb?.split("::")[1];
      let score = -1;
      if (embJson) {
        try {
          score = cosineSim(q, JSON.parse(embJson));
        } catch {
          score = -1;
        }
      }
      return { doc: d, score };
    })
    .sort((a, b) => b.score - a.score);

  const candidates = ranked
    .filter((r) => r.score > 0.25)
    .slice(0, topK)
    .map((r) => r.doc);

  const { allowed, denied } = await filterAllowedDocs(
    env.DB,
    userId,
    candidates.map((d) => ({ id: d.id, acl_type: d.acl_type, acl_id: d.acl_id })),
  );

  return {
    candidates,
    allowed: candidates.filter((d) => allowed.includes(d.id)),
    deniedIds: denied,
  };
}