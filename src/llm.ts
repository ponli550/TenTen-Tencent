import { Env, Document, Platform } from "./types";

export interface GroundedAnswer {
  text: string;
  citations: { ref: number; document_id: number; title: string; platform: Platform }[];
}

const SYSTEM = `You are the Internal Brain: an enterprise knowledge assistant with STRICT access-control guarantees.

RULES (non-negotiable):
1. Base your answer ONLY on the provided <context> documents. Never use outside knowledge of what those documents contain.
2. Every claim must be traceable to a context document via a citation marker like [1], [2] (the number in the document's <doc id=N> tag).
3. If the context does not contain enough to answer, say so plainly: "I could not find that in the sources I am allowed to view." Do not guess, do not fill in.
4. NEVER mention a document that is not in your context. NEVER say "there is a document I cannot see" or "a restricted report exists." Restricted material simply does not exist to you.
5. If the question asks about something the context shows is restricted/confidential and you have no allowed document on it, treat the topic as not found.
6. Be concise (under 120 words). Use bullets where helpful.`;

export function buildContext(docs: (Document & { ref: number })[]): string {
  return docs
    .map(
      (d) => `<doc id=${d.ref} source="${d.platform}:${d.title}" updated=${d.updated_at}>\n${d.body}\n</doc>`,
    )
    .join("\n\n");
}

interface LabeledDoc extends Document {
  ref: number;
}

/**
 * Grounded generation. The prompt contains ONLY allowed documents — the
 * model literally cannot paraphrase or leak a denied doc because the doc
 * is absent from the context window.
 */
export async function answerGrounded(
  env: Env,
  query: string,
  allowed: Document[],
): Promise<GroundedAnswer> {
  const labeled: LabeledDoc[] = allowed.map((p, i) => ({ ...p, ref: i + 1 }));
  const context = buildContext(labeled);

  const prompt = `${SYSTEM}\n\n<context>\n${context}\n</context>\n\nUser question: ${query}\n\nAnswer with citations:`;

  const res = (await env.AI.run(env.LLM_MODEL, { prompt, stream: false })) as { response?: string };
  const text = (res.response ?? "").trim();

  const citations: GroundedAnswer["citations"] = [];
  const refPattern = /\[(\d+)\]/g;
  let m: RegExpExecArray | null;
  while ((m = refPattern.exec(text))) {
    const ref = Number(m[1]);
    const doc = labeled.find((p) => p.ref === ref);
    if (doc && !citations.some((c) => c.ref === ref)) {
      citations.push({ ref, document_id: doc.id, title: doc.title, platform: doc.platform });
    }
  }

  return { text, citations };
}