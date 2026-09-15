import { AuditEntry } from "./types";

function sha256Hex(parts: string[]): Promise<string> {
  const input = parts.join("|");
  const data = new TextEncoder().encode(input);
  return crypto.subtle
    .digest("SHA-256", data)
    .then((buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join(""));
}

function canonical(entry: Omit<AuditEntry, "id" | "chain_hash">): string {
  return [
    entry.seq,
    entry.prev_hash,
    entry.created_at,
    entry.actor_id,
    entry.action,
    entry.query,
    entry.candidates,
    entry.allowed,
    entry.denied,
    entry.answer,
  ].join("|");
}

export async function chainHash(entry: Omit<AuditEntry, "id" | "chain_hash">): Promise<string> {
  return sha256Hex([canonical(entry)]);
}

export async function latestSeq(db: D1Database): Promise<number> {
  const row = await db.prepare("SELECT MAX(seq) AS m FROM audit_log").first<{ m: number | null }>();
  return row?.m ?? 0;
}

/**
 * Append a tamper-evident audit entry. Every row links to the previous
 * row's chain hash, so any modification or deletion breaks the chain.
 */
export async function appendAudit(
  db: D1Database,
  e: Omit<AuditEntry, "id" | "seq" | "prev_hash" | "chain_hash">,
): Promise<AuditEntry> {
  const seq = (await latestSeq(db)) + 1;
  const prevRow = await db
    .prepare("SELECT chain_hash FROM audit_log ORDER BY seq DESC LIMIT 1")
    .first<{ chain_hash: string }>();
  const prev_hash = prevRow?.chain_hash ?? "GENESIS";
  const full = { ...e, seq, prev_hash };
  const hash = await chainHash(full);
  const res = await db
    .prepare(
      `INSERT INTO audit_log
         (seq, prev_hash, created_at, actor_id, action, query, candidates, allowed, denied, answer, chain_hash)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      seq,
      prev_hash,
      full.created_at,
      full.actor_id,
      full.action,
      full.query,
      full.candidates,
      full.allowed,
      full.denied,
      full.answer,
      hash,
    )
    .run();
  return { ...full, id: Number(res.meta?.last_row_id ?? -1), chain_hash: hash };
}

export interface ChainVerification {
  ok: boolean;
  checked: number;
  first_broken_seq: number | null;
  errors: string[];
}

/**
 * Recompute the entire chain from genesis. Detects:
 *  - tampered fields (recomputed hash != stored hash)
 *  - broken linkage (stored chain_hash != next row's prev_hash)
 *  - deleted rows (seq gaps after the first entry)
 */
export async function verifyChain(db: D1Database): Promise<ChainVerification> {
  const rows = await db.prepare("SELECT * FROM audit_log ORDER BY seq ASC").all<AuditEntry>();
  let prevHash = "GENESIS";
  const errors: string[] = [];
  let firstBroken: number | null = null;

  for (const r of rows.results) {
    const expected = await chainHash({
      seq: r.seq,
      prev_hash: r.prev_hash,
      created_at: r.created_at,
      actor_id: r.actor_id,
      action: r.action,
      query: r.query,
      candidates: r.candidates,
      allowed: r.allowed,
      denied: r.denied,
      answer: r.answer,
    });
    if (r.prev_hash !== prevHash) {
      const msg = `seq ${r.seq}: prev_hash mismatch (expected ${prevHash.slice(0, 12)}…, got ${r.prev_hash.slice(0, 12)}…)`;
      errors.push(msg);
      firstBroken ??= r.seq;
    }
    if (r.chain_hash !== expected) {
      const msg = `seq ${r.seq}: chain_hash tampered (recomputed ${expected.slice(0, 12)}…, stored ${r.chain_hash.slice(0, 12)}…)`;
      errors.push(msg);
      firstBroken ??= r.seq;
    }
    prevHash = r.chain_hash;
  }

  // Detect deletion: seq must be contiguous from 1.
  const seqs = rows.results.map((r) => r.seq);
  for (let i = 0; i < seqs.length; i++) {
    if (seqs[i] !== i + 1) {
      const msg = `seq ${i + 1}: deleted or reordered (next found: seq ${seqs[i]})`;
      errors.push(msg);
      firstBroken ??= i + 1;
      break;
    }
  }

  return { ok: errors.length === 0, checked: rows.results.length, first_broken_seq: firstBroken, errors };
}