import { Env, Page } from "./types";

export interface GroundedAnswer {
  text: string;
  citations: { ref: number; page_id: number; title: string }[];
}

const SYSTEM = `You are the Internal Brain: an enterprise knowledge assistant with STRICT access-control guarantees.

RULES (non-negotiable):
1. Base your answer ONLY on the provided <context> documents. Never use outside knowledge of what those documents contain.
2. Every claim must be traceable to a context document via a citation marker like [1], [2] (the number in the document's <doc id=N> tag).
3. If the context does not contain enough to answer, say so plainly: "I could not find that in the sources I am allowed to view." Do not guess, do not fill in.
4. NEVER mention a document that is not in your context. NEVER say "there is a document I cannot see" or "a restricted report exists." Restricted material simply does not exist to you.
5. If the question asks about something the context shows is restricted/confidential and you have no allowed document on it, treat the topic as not found.
6. Be concise (under 120 words). Use bullets where helpful.`;

export function buildContext(docs: (Page & { ref: number })[]): string {
  return docs
    .map((d) => `<doc id=${d.ref} source="${d.title}" updated=${d.updated_at}>\n${d.body}\n</doc>`)
    .join("\n\n");
}

/**
 * Grounded generation. The prompt contains ONLY allowed documents — the
 * model literally cannot paraphrase or leak a denied page because the page
 * is absent from the context window.
 */
export async function answerGrounded(
  env: Env,
  query: string,
  allowed: Page[],
): Promise<GroundedAnswer> {
  const labeled = allowed.map((p, i) => ({ ...p, ref: i + 1 }));
  const context = buildContext(labeled);

  const prompt = `${SYSTEM}\n\n<context>\n${context}\n</context>\n\nUser question: ${query}\n\nAnswer with citations:`;

  const res = (await env.AI.run(env.LLM_MODEL, { prompt, stream: false })) as { response?: string };
  const text = (res.response ?? "").trim();

  const citations: GroundedAnswer["citations"] = [];
  const refPattern = /\[(\d+)\]/g;
  let m: RegExpExecArray | null;
  while ((m = refPattern.exec(text))) {
    const ref = Number(m[1]);
    const page = labeled.find((p) => p.ref === ref);
    if (page && !citations.some((c) => c.ref === ref)) {
      citations.push({ ref, page_id: page.id, title: page.title });
    }
  }

  return { text, citations };
}