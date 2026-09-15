import type { User, Page, PermissionRow } from "./types";

/**
 * Confluence permission semantics, enforced AT QUERY TIME (never cached):
 *
 *  1. If a page has ANY explicit permission rows, the page is restricted —
 *     only rows for that page decide access (space-level is ignored for it).
 *  2. Otherwise access is decided by the page's space.
 *  3. Restricted spaces default to deny when the user has no explicit grant.
 *  4. Deny always wins over grant at the same level.
 *
 * Evaluated live against D1 on every retrieval, so a revoked permission is
 * reflected on the very next query — no stale snapshot.
 */
export async function canViewPage(
  db: D1Database,
  userId: number,
  spaceId: number,
  pageId: number,
): Promise<boolean> {
  const pagePerms = await db
    .prepare(
      `SELECT allowed FROM permissions WHERE user_id = ? AND entity_type = 'page' AND entity_id = ?`,
    )
    .bind(userId, pageId)
    .all<{ allowed: 0 | 1 }>();

  if (pagePerms.results.length > 0) {
    // Page is restricted: deny always wins, and absence of an explicit grant
    // for THIS user means "not on the page's allow list".
    return pagePerms.results.some((p) => p.allowed === 1);
  }

  const spacePerm = await db
    .prepare(
      `SELECT allowed FROM permissions WHERE user_id = ? AND entity_type = 'space' AND entity_id = ?`,
    )
    .bind(userId, spaceId)
    .first<{ allowed: 0 | 1 }>();

  if (!spacePerm) return false; // restricted space, no grant => denied
  return spacePerm.allowed === 1;
}

export async function filterAllowedPages(
  db: D1Database,
  userId: number,
  pages: { id: number; space_id: number }[],
): Promise<{ allowed: number[]; denied: number[] }> {
  const allowed: number[] = [];
  const denied: number[] = [];
  for (const p of pages) {
    (await canViewPage(db, userId, p.space_id, p.id)) ? allowed.push(p.id) : denied.push(p.id);
  }
  return { allowed, denied };
}