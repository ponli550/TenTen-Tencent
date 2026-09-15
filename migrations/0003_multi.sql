-- Multi-platform: unified retrieval corpus + per-platform ACLs (issue #2).

-- 1. Rebuild permissions without the restrictive CHECK — entity_type is now
--    platform-agnostic: space|page|jira_project|slack_channel|drive_file.
ALTER TABLE permissions RENAME TO permissions_old;

CREATE TABLE permissions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  entity_type TEXT NOT NULL,
  entity_id INTEGER NOT NULL,
  allowed INTEGER NOT NULL CHECK (allowed IN (0, 1)),
  UNIQUE (user_id, entity_type, entity_id)
);

INSERT INTO permissions (user_id, entity_type, entity_id, allowed)
  SELECT user_id, entity_type, entity_id, allowed FROM permissions_old;

DROP TABLE permissions_old;

-- 2. Unified knowledge fabric: every source becomes a document. acl_type /
--    acl_id point at the platform's OWN permission entity:
--      confluence -> space or page (page-level restriction overrides space)
--      jira       -> jira_project
--      slack      -> slack_channel
--      drive      -> drive_file
CREATE TABLE IF NOT EXISTS documents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  platform TEXT NOT NULL,
  external_id TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  acl_type TEXT NOT NULL,
  acl_id INTEGER NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_documents_platform_ext ON documents(platform, external_id);

CREATE TABLE IF NOT EXISTS document_embeddings (
  document_id INTEGER PRIMARY KEY REFERENCES documents(id),
  embedding TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- 3. Backfill existing Confluence pages.
INSERT INTO documents (platform, external_id, title, body, updated_at, version, acl_type, acl_id)
  SELECT 'confluence', CAST(p.id AS TEXT), p.title, p.body, p.updated_at, p.version, 'space', p.space_id
  FROM pages p;

-- Pages with explicit restriction rows become page-level ACL docs.
UPDATE documents SET acl_type = 'page', acl_id = id
  WHERE platform = 'confluence'
    AND id IN (SELECT DISTINCT entity_id FROM permissions WHERE entity_type = 'page');

INSERT INTO document_embeddings (document_id, embedding, updated_at)
  SELECT page_id, embedding, updated_at FROM page_embeddings;

-- 4. Jira issues — project-role ACL. Project 1=PAY (eng/ops), 2=SEC (secops).
INSERT INTO documents (platform, external_id, title, body, updated_at, version, acl_type, acl_id) VALUES
  ('jira', 'PAY-9921', 'PAY-9921: fix rollback idempotency',
   'Open. Priority: P1. Assignee: platform team. Linked to postmortem I-2026-0913. Status: in progress. Fix dual-write rollback path leaving orphaned intents.',
   '2026-09-15T08:00:00Z', 1, 'jira_project', 1),
  ('jira', 'PAY-9922', 'PAY-9922: WAL replay ordering',
   'Open. Priority: P1. Must land before next failover drill. Root cause: replaying WAL before failover re-triggers the orphan conflict.',
   '2026-09-15T09:30:00Z', 1, 'jira_project', 1),
  ('jira', 'PAY-9923', 'PAY-9923: observability on orphan counter',
   'Open. Priority: P2. Add gauge and alert when orphaned intents exceed threshold.',
   '2026-09-15T10:00:00Z', 1, 'jira_project', 1),
  ('jira', 'SEC-777', 'SEC-777: MFA enforcement rollout (RESTRICTED)',
   'Security-team only. Track MFA-enforce rollout for legacy SSO: 100% by 2026-10-30. 214 accounts remain.',
   '2026-09-14T14:00:00Z', 1, 'jira_project', 2);

-- 5. Slack — channel-membership ACL. Channel 1=#payments-migration, 2=#secops-alerts.
INSERT INTO documents (platform, external_id, title, body, updated_at, version, acl_type, acl_id) VALUES
  ('slack', 'SH-001', '#payments-migration (Tue): blocker discussion',
   'Thread: hitting 30s replica lag on eu-west-1 this morning. Forcing dual-write catch-up. No ETA — PAY-9922 (WAL replay ordering) must land first.',
   '2026-09-12T07:00:00Z', 1, 'slack_channel', 1),
  ('slack', 'SH-002', '#payments-migration (Wed): blocker resolved',
   'Lag back under 5s after PAY-9922 landed. Failover drill scheduled Friday.',
   '2026-09-13T11:00:00Z', 1, 'slack_channel', 1),
  ('slack', 'SH-003', '#secops-alerts (CONFIDENTIAL): MFA enforcement',
   'MFA rollout at 87%. 214 legacy SSO accounts remain. Force-check on login ships next sprint.',
   '2026-09-14T09:00:00Z', 1, 'slack_channel', 2);

-- 6. Google Drive — file-level ACL. File 1=postmortem draft, 2=breach runbook.
INSERT INTO documents (platform, external_id, title, body, updated_at, version, acl_type, acl_id) VALUES
  ('drive', 'G-001', 'Postmortem: I-2026-0913 payment outage (draft)',
   'Shared with platform team. Timeline: dual-write conflict at 02:41, orphaned intents across eu regions, WAL replay ordering issue, 3h time-to-restore.',
   '2026-09-15T12:00:00Z', 1, 'drive_file', 1),
  ('drive', 'G-002', 'Q3 breach containment runbook (INTERNAL - SecOps only)',
   'Credential stuffing incident: containment steps, session invalidation, remediation owners. Do not share outside SecOps.',
   '2026-09-12T15:00:00Z', 1, 'drive_file', 2);

-- 7. Cross-platform grants. admin has everything; junior has the shared tiers only.
INSERT INTO permissions (user_id, entity_type, entity_id, allowed) VALUES
  (1, 'jira_project', 1, 1), (1, 'jira_project', 2, 1),
  (1, 'slack_channel', 1, 1), (1, 'slack_channel', 2, 1),
  (1, 'drive_file', 1, 1),    (1, 'drive_file', 2, 1),
  (2, 'jira_project', 1, 1),
  (2, 'slack_channel', 1, 1),
  (2, 'drive_file', 1, 1);