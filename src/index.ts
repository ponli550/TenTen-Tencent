import { Env, User, Document } from "./types";
import { appendAudit, verifyChain, latestSeq } from "./audit";
import { permissionAwareRetrieve, ensureEmbeddingFresh } from "./retrieval";
import { answerGrounded } from "./llm";
import { renderUI } from "./ui";

async function getUser(db: D1Database, email: string): Promise<User | null> {
  const row = await db.prepare("SELECT * FROM users WHERE email = ?").bind(email).first<User>();
  return row ?? null;
}

async function getDoc(db: D1Database, id: number): Promise<Document | null> {
  const row = await db.prepare("SELECT * FROM documents WHERE id = ?").bind(id).first<Document>();
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
        let citations: { ref: number; document_id: number; title: string; platform: string }[] = [];
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
          candidates: JSON.stringify(candidates.map((d) => d.id)),
          allowed: JSON.stringify(allowed.map((d) => d.id)),
          denied: JSON.stringify(deniedIds),
          answer: answerText,
        });

        return json({
          ok: true,
          answer: answerText,
          citations,
          allowed: allowed.map((d) => ({ id: d.id, title: d.title, platform: d.platform })),
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
        const seq = await latestSeq(env.DB);
        if (seq === 0) return json({ ok: false, error: "no entries yet" }, 400);
        await env.DB.prepare(
          "UPDATE audit_log SET answer = answer || ' [TAMPERED 2026]' WHERE seq = ?",
        ).bind(seq).run();
        return json({ ok: true, seq });
      }

      if (url.pathname === "/api/revoke") {
        // Generic per-platform revocation: deny the actor on an ACL entity
        // (page, project, channel, file). Deny-wins, enforced next query.
        const email = String((body as { user_email?: string }).user_email ?? "");
        const entityType = String((body as { entity_type?: string }).entity_type ?? "page");
        const entityId = Number((body as { entity_id?: number }).entity_id);
        const user = await getUser(env.DB, email);
        if (!user) return json({ ok: false, error: "unknown user" }, 400);
        const doc = await env.DB.prepare(
          "SELECT * FROM documents WHERE acl_type = ? AND acl_id = ? LIMIT 1",
        ).bind(entityType, entityId).first<Document>();
        await env.DB.prepare(
          `INSERT INTO permissions (user_id, entity_type, entity_id, allowed) VALUES (?, ?, ?, 0)
           ON CONFLICT(user_id, entity_type, entity_id) DO UPDATE SET allowed = 0`,
        ).bind(user.id, entityType, entityId).run();
        await appendAudit(env.DB, {
          created_at: new Date().toISOString(),
          actor_id: user.id,
          action: "revoke",
          query: "",
          candidates: JSON.stringify(doc ? [doc.id] : [entityId]),
          allowed: "[]",
          denied: JSON.stringify(doc ? [doc.id] : [entityId]),
          answer: `permission revoked for ${email} on ${entityType}(${entityId})`,
        });
        return json({ ok: true, title: doc?.title ?? `${entityType} ${entityId}` });
      }

      if (url.pathname === "/api/sync") {
        // Simulate a platform push (freshness): update an existing document by
        // platform+external_id, or insert a new one. updated_at bump makes the
        // embedding stale, so the NEXT query re-embeds before retrieval.
        const s = body as {
          platform?: string;
          external_id?: string;
          title?: string;
          body?: string;
          acl_type?: string;
          acl_id?: number;
        };
        const platform = (s.platform ?? "slack") as Document["platform"];
        const externalId = String(s.external_id ?? `SYNC-${Date.now()}`);
        const title = String(s.title ?? "Live sync message");
        const content = String(s.body ?? "Fresh content pushed at query time.");
        const aclType = (s.acl_type ?? "slack_channel") as Document["acl_type"];
        const aclId = Number(s.acl_id ?? 2);

        const existing = await env.DB.prepare(
          "SELECT * FROM documents WHERE platform = ? AND external_id = ?",
        ).bind(platform, externalId).first<Document>();

        if (existing) {
          await env.DB.prepare(
            "UPDATE documents SET body = ?, title = ?, updated_at = ?, version = version + 1 WHERE id = ?",
          ).bind(content, title, new Date().toISOString(), existing.id).run();
          return json({ ok: true, document_id: existing.id, title });
        }

        const { meta } = await env.DB.prepare(
          `INSERT INTO documents (platform, external_id, title, body, updated_at, version, acl_type, acl_id)
           VALUES (?, ?, ?, ?, ?, 1, ?, ?)`,
        ).bind(platform, externalId, title, content, new Date().toISOString(), aclType, aclId).run();
        return json({ ok: true, document_id: Number(meta?.last_row_id ?? -1), title });
      }

      return json({ ok: false, error: "not found" }, 404);
    }

    return json({ ok: false, error: "not found" }, 404);
  },
};