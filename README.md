# TenTen-Tencent

AI-augmented enterprise knowledge system that unifies Confluence, Jira, Slack, and Google Drive under permission-aware retrieval with full audit trail.

**Live demo:** https://tenten-tencent.nazrijz336.workers.dev

## problem

Enterprises waste 30% of workweek searching for information scattered across Confluence, Jira, Slack, and Google Drive. Existing AI assistants ignore access controls entirely — a junior engineer can leak security-team-only pages. The Internal Brain solves this with RBAC-enforced retrieval and tamper-evident audit logging.

## how it works

- **Heterogeneous Source Ingestion**: Connectors for Confluence, Jira, Slack, and Google Drive with per-platform permission semantics preserved
- **Permission-Aware Retrieval**: Pre-LLM filtering ensures the model never sees content the user is not authorized to access
- **Context Assembly**: Cross-platform fan-out, ranking, and stitching into a coherent context window
- **Audit Trail**: Tamper-evident logging of every query, retrieval decision, and answer with timestamps

## architecture & trust boundaries

```
                ┌──────────────────  trusted  ──────────────────┐
 user (actor) ─►│  auth (identity + roles)                       │
                │       │                                        │
                │  permission filter  ◄── live D1 ACL lookup     │
                │  (evaluated at QUERY time, deny-wins)          │
                │       │ only ALLOWED docs cross this line      │
                │  grounded LLM context window                   │
                │       │                                        │
                │  answer + citations                            │
                └───────────────┬────────────────────────────────┘
                                ▼
              hash-chained audit log (tamper-evident, queryable)
```

**Trust boundaries**
- *User identity & platform ACLs* are the trust root. The permission filter re-checks D1 at query time — never a cached snapshot — so a revoked grant takes effect on the next request.
- *The LLM is untrusted.* It only ever receives the allowed context window. Restricted pages are physically absent from the prompt, so the model cannot paraphrase or leak them (also immunizes against prompt-injection-via-retrieved-content).
- *The audit log is append-only by design.* Each entry stores the previous entry's hash; any modification or deletion breaks the chain and is detected by `verify`.
- *Deny-wins, page-overrides-space* semantics mirror Confluence: if a page has explicit restriction rows, space-level grants are ignored for it.

**Key trade-offs**
- *LSH/brute-force cosine over D1-stored embeddings* (vs a vector index) — fine at demo scale, keeps the permission filter trivially auditable; swap to Vectorize for production scale.
- *Lazy re-embedding* on `updated_at` bump — freshness window is the first query after a push, within the challenge's "minutes" bound.
- *Single-region D1 + Workers AI* — no server to manage; audit chain anchored in-app rather than on an external ledger (an external anchor is the obvious production hardening).

## running locally

```bash
npm install
npx wrangler d1 migrations apply tenten --local   # creates + seeds demo data locally
npx wrangler dev
# open http://localhost:8787
```
