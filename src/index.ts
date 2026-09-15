import { Env, User, Page } from "./types";
import { appendAudit, verifyChain, latestSeq } from "./audit";
import { permissionAwareRetrieve, ensureEmbeddingFresh } from "./retrieval";
import { answerGrounded } from "./llm";
import { renderUI } from "./ui";

async function getUser(db: D1Database, email: string): Promise<User | null> {
  const row = await db.prepare("SELECT * FROM users WHERE email = ?").bind(email).first<User>();
  return row ?? null;
}

async function getPage(db: D1Database, id: number): Promise<Page | null> {
  const row = await db.prepare("SELECT * FROM pages WHERE id = ?").bind(id).first<Page>();
  return row ?? null;
}

async function listUsers(db: D1Database): Promise<User[]> {
  const row = await db.prepare("SELECT * FROM users ORDER BY id").all<User>();
  return row.results;
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });

const text = (body: string, status = 200, type = "text/html") =>
  new Response(body, { status, headers: { "Content-Type": `${type}; charset=utf-8` } });

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === "GET" && url.pathname === "/") return text(renderUI());
    if (request.method === "POST" && url.pathname !== "/") {
      const body = await request.json().catch(() => ({}));

      if (url.pathname === "/api/ask") {
        const user = await getUser(env.DB, String((body as { user_email?: string }).user_email ?? ""));
        if (!user) return json({ ok: false, error: "unknown user" }, 401);
        const query = String((body as { query?: string }).query ?? "").trim();
        if (!query) return json({ ok: false, error: "empty query" }, 400);

        const { candidates, allowed, deniedIds } = await permissionAwareRetrieve(env, user.id, query);
        let answerText = "I could not find that in the sources I am allowed to view.";
        let citations: { ref: number; page_id: number; title: string }[] = [];
        if (allowed.length > 0) {
          const grounded = await answerGrounded(env, query, allowed);
          answerText = grounded.text;
          citations = grounded.citations;
        }

        await appendAudit(env.DB, {
          created_at: new Date().toISOString(),
          actor_id: user.id,
          action: "ask",
          query,
          candidates: JSON.stringify(candidates.map((p) => p.id)),
          allowed: JSON.stringify(allowed.map((p) => p.id)),
          denied: JSON.stringify(deniedIds),
          answer: answerText,
        });

        return json({
          ok: true,
          answer: answerText,
          citations,
          allowed: allowed.map((p) => ({ id: p.id, title: p.title })),
          denied_count: deniedIds.length,
        });
      }

      if (url.pathname === "/api/audit") {
        const entries = await env.DB.prepare(
          "SELECT * FROM audit_log ORDER BY seq DESC LIMIT 30",
        ).all<Record<string, unknown>>();
        return json({ ok: true, entries: entries.results, users: await listUsers(env.DB) });
      }

      if (url.pathname === "/api/audit/verify") {
        const v = await verifyChain(env.DB);
        return json({ ok: v.ok, checked: v.checked, first_broken_seq: v.first_broken_seq, errors: v.errors });
      }

      if (url.pathname === "/api/audit/tamper") {
        // Demo-only: mutates the most recent entry to prove tamper-evidence.
        const seq = await latestSeq(env.DB);
        if (seq === 0) return json({ ok: false, error: "no entries yet" }, 400);
        await env.DB.prepare(
          "UPDATE audit_log SET answer = answer || ' [TAMPERED 2026]' WHERE seq = ?",
        ).bind(seq).run();
        return json({ ok: true, seq });
      }

      if (url.pathname === "/api/revoke") {
        const email = String((body as { user_email?: string }).user_email ?? "");
        const pageId = Number((body as { page_id?: number }).page_id);
        const user = await getUser(env.DB, email);
        const page = await getPage(env.DB, pageId);
        if (!user || !page) return json({ ok: false, error: "unknown user or page" }, 400);
        // Deny-wins page restriction: evaluator sees this page row and blocks.
        await env.DB.prepare(
          `INSERT INTO permissions (user_id, entity_type, entity_id, allowed) VALUES (?, 'page', ?, 0)
           ON CONFLICT(user_id, entity_type, entity_id) DO UPDATE SET allowed = 0`,
        ).bind(user.id, pageId).run();
        await appendAudit(env.DB, {
          created_at: new Date().toISOString(),
          actor_id: user.id,
          action: "revoke",
          query: "",
          candidates: JSON.stringify([pageId]),
          allowed: "[]",
          denied: JSON.stringify([pageId]),
          answer: `permission revoked for ${email} on page ${pageId}`,
        });
        return json({ ok: true, title: page.title });
      }

      if (url.pathname === "/api/sync") {
        // Simulate a Confluence push. With page_id: update that page in
        // place (freshness). Without: insert a brand-new page. Either way
        // the updated_at bump makes embeddings stale, so the NEXT query
        // re-embeds before retrieval — no stale snapshots.
        const bodySync = body as { page_id?: number; title?: string; body?: string };
        const content = String(bodySync.body ?? "Fresh content pushed at query time.");
        const title = String(bodySync.title ?? "Live sync test page");

        if (bodySync.page_id) {
          const existing = await getPage(env.DB, bodySync.page_id);
          if (!existing) return json({ ok: false, error: "page not found" }, 404);
          await env.DB.prepare(
            "UPDATE pages SET body = ?, updated_at = ?, version = version + 1 WHERE id = ?",
          ).bind(content, new Date().toISOString(), bodySync.page_id).run();
          return json({ ok: true, page_id: bodySync.page_id, title: existing.title });
        }

        const { meta } = await env.DB.prepare(
          "INSERT INTO pages (space_id, title, body, updated_at, version) VALUES (1, ?, ?, ?, 1)",
        ).bind(title, content, new Date().toISOString()).run();
        return json({ ok: true, page_id: Number(meta?.last_row_id ?? -1), title });
      }

      if (url.pathname === "/api/seed-embeddings") {
        const p4 = await getPage(env.DB, 4);
        if (p4) await ensureEmbeddingFresh(env, p4, null);
        return json({ ok: true });
      }

      return json({ ok: false, error: "not found" }, 404);
    }

    return json({ ok: false, error: "not found" }, 404);
  },
};