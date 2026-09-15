import type { Document, EntityType } from "./types";

/**
 * Per-platform permission semantics, enforced AT QUERY TIME (never cached).
 * The unified corpus never flattens these away: each document points at its
 * platform's own ACL entity and is evaluated with platform-native rules.
 *
 *   confluence space/page : deny-wins; a restricted page (acl_type='page')
 *                           ignores space-level grants entirely.
 *   jira_project          : project-role grant (absent row = no such role).
 *   slack_channel         : channel-membership grant.
 *   drive_file            : file-level ACL grant (absent row = no share).
 *
 * Explicit deny always wins over grant at the same level.
 */
export async function canViewDocument(
  db: D1Database,
  userId: number,
  doc: Pick<Document, "acl_type" | "acl_id">,
): Promise<boolean> {
  const { acl_type: entityType, acl_id: entityId } = doc;

  if (entityType === "page") {
    // Confluence page restriction: only page-level rows decide access,
    // deny-wins, and absence of a grant means "not on the allow list".
    const rows = await db
      .prepare(
        `SELECT allowed FROM permissions WHERE user_id = ? AND entity_type = 'page' AND entity_id = ?`,
      )
      .bind(userId, entityId)
      .all<{ allowed: 0 | 1 }>();
    return rows.results.length > 0 && rows.results.some((r) => r.allowed === 1);
  }

  // Guard against a grant+deny pair at the same scope: deny wins.
  const rows = await db
    .prepare(
      `SELECT allowed FROM permissions WHERE user_id = ? AND entity_type = ? AND entity_id = ?`,
    )
    .bind(userId, entityType, entityId)
    .all<{ allowed: 0 | 1 }>();
  if (rows.results.some((r) => r.allowed === 0)) return false;
  return rows.results.some((r) => r.allowed === 1);
}

export async function filterAllowedDocs(
  db: D1Database,
  userId: number,
  docs: { id: number; acl_type: EntityType; acl_id: number }[],
): Promise<{ allowed: number[]; denied: number[] }> {
  const allowed: number[] = [];
  const denied: number[] = [];
  for (const d of docs) {
    (await canViewDocument(db, userId, d)) ? allowed.push(d.id) : denied.push(d.id);
  }
  return { allowed, denied };
}