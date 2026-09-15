-- Demo users. admin = SecOps, junior = backend engineer.
INSERT INTO users (id, email, display_name, role) VALUES
  (1, 'admin@acme.co', 'Alex Admin', 'secops'),
  (2, 'junior@acme.co', 'Jade Junior', 'backend');

-- Confluence spaces.
INSERT INTO spaces (id, key, name, restricted) VALUES
  (1, 'ENG', 'Backend Engineering', 0),
  (2, 'SEC', 'Security (Restricted)', 1),
  (3, 'OPS', 'Operations & Runbooks', 0);

-- Space-level grants: admin has all spaces; junior has ENG + OPS but NOT SEC.
INSERT INTO permissions (user_id, entity_type, entity_id, allowed) VALUES
  (1, 'space', 1, 1),
  (1, 'space', 2, 1),
  (1, 'space', 3, 1),
  (2, 'space', 1, 1),
  (2, 'space', 3, 1);

-- Confluence pages.
INSERT INTO pages (id, space_id, title, body, updated_at, version) VALUES
  (1, 1, 'Database migration status',
   'The payments-db migration to PostgreSQL 17 is in progress. Phase 1 (schema) done. Phase 2 (dual-write) blockers: read-replica lag on eu-west-1. Phase 3 (cutover) scheduled Friday 14:00 UTC. Blocker raised in #payments-migration: replica lag exceeded 30s on Tuesday. Owners: the platform team.', '2026-09-14T09:00:00Z', 3),

  (2, 1, 'Auth service design discussion',
   'The new auth service moves from a shared JWT secret to per-client asymmetric keys. Discussion across last sprint: short-lived access tokens (5 min) + refresh rotation. Decision doc lands in Confluence (see DEC-2026/114). Open question: key rotation enveloppe still debated. Timeline: beta in Q4.', '2026-09-14T10:30:00Z', 2),

  (3, 1, 'API reference: payments endpoints',
   'POST /v1/payments creates a payment intent. GET /v1/payments returns paginated list. Webhooks: payment.succeeded, payment.failed. Sandbox key: pk_test_... Rate limits: 100 req/min per key. SCA required above €100.', '2026-09-10T08:00:00Z', 5),

  (4, 3, 'Payment outage runbook',
   'Runbook: payment-service incident I-2026-0913. Root cause: dual-write conflict in payments-db rollback path left orphaned intents. MITIGATION 1: kill orphaned intents via /ops/cleanup. MITIGATION 2 (NEW, added 2026-09-15 13:00 UTC): failover to read-replica must be done BEFORE replaying the WAL — replaying first re-triggers the conflict. If pager fires again, fail over first, then replay. Follow-up tickets: PAY-9921 (fix rollback idempotency), PAY-9922 (WAL replay ordering), PAY-9923 (observability on orphan counter).', '2026-09-15T13:00:00Z', 4),

  (5, 3, 'On-call escalation guide',
   'On-call rotation: see roster in #ops-oncall. Escalation: L1 → L2 → security. Severity-1 incidents page the on-call immediately. The payment outage (I-2026-0913) was escalated L1→L2 in 12 minutes. Postmortem link lives in the SEC space.', '2026-09-13T16:00:00Z', 2),

  (6, 2, 'Q3 security incident report',
   'Q3 incident: credential stuffing on internal admin console. 214 accounts affected. Root cause: no MFA on legacy SSO. Containment: session invalidation + forced rotation. Remediation: MFA-enforce rollout 100% by 2026-10-30. This report is restricted to the security team.', '2026-09-12T11:00:00Z', 1),

  (7, 2, 'Vulnerability remediation tracker',
   'Critical: CVE-2026-4521 in payments SDK (CVSS 9.4), patched 2026-09-08. High: CVE-2026-4419 SSRF in file proxy (CVSS 8.6), fix pending. Team: secops. This tracker is restricted to the security team.', '2026-09-14T15:00:00Z', 1);