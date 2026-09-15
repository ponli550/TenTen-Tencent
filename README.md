# TenTen-Tencent

AI-augmented enterprise knowledge system that unifies Confluence, Jira, Slack, and Google Drive under permission-aware retrieval with full audit trail.

## problem

Enterprises waste 30% of workweek searching for information scattered across Confluence, Jira, Slack, and Google Drive. Existing AI assistants ignore access controls entirely — a junior engineer can leak security-team-only pages. The Internal Brain solves this with RBAC-enforced retrieval and tamper-evident audit logging.

## how it works

- **Heterogeneous Source Ingestion**: Connectors for Confluence, Jira, Slack, and Google Drive with per-platform permission semantics preserved
- **Permission-Aware Retrieval**: Pre-LLM filtering ensures the model never sees content the user is not authorized to access
- **Context Assembly**: Cross-platform fan-out, ranking, and stitching into a coherent context window
- **Audit Trail**: Tamper-evident logging of every query, retrieval decision, and answer with timestamps

## running it locally

*TODO: add setup instructions*
