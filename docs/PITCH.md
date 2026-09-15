## one-liner
The Internal Brain: RBAC-enforced RAG over Confluence/Jira/Slack/Drive with a hash-chained audit log judges can inspect.

## problem
Enterprises waste ~30% of the workweek hunting across Confluence, Jira, Slack, and Google Drive. The "AI over your data" answer is already table-stakes — every enterprise RAG vendor (Glean, Guru, Microsoft Copilot) leads with that pitch. What none of them solve credibly is the hard constraint underneath: *any assistant that can read everything, can leak everything.* A junior engineer asking "show me all security vulnerabilities" must not surface security-team-only pages, and there must be a tamper-evident record of every query, retrieval decision, and answer.

## why this is not a wrapper / chatbot / dashboard
Connectors + a retrieval filter + an LLM call is the default RAG architecture. Three things here are genuinely hard:

1. **Permission filtering at the retrieval layer, not after it.** Candidate docs are filtered *before* the LLM ever sees them — the model cannot paraphrase what it was never given — and enforcement happens at query time, so a revoked permission is respected within the freshness window, never served stale.
2. **Hash-chained tamper-evident audit log.** Every entry links to the previous entry's hash; the chain is anchored to an external check that recomputes and detects any modification or deletion. Timestamped, queryable by user/doc/decision.
3. **Cross-platform permission semantics preserved.** Confluence space+page roles, Jira project-role-issue security, Slack channel membership, Drive file-folder-user ACLs — each platform's model stays intact end-to-end rather than being flattened away.

## market - who pays
Enterprise IT/security, not the engineer using it. Security teams own budget for anything touching access control and compliance logging. The land-and-expand wedge is a compliance/audit mandate — SOC2, an internal pen-test finding, "auditor flagged our AI tool for data leakage" — not a productivity pitch. Nobody sponsors "save 30% of the week"; they sponsor "prove you didn't leak restricted data."

## open-source strategy
Open-source the connectors and permission-filtering framework — the "how do I RAG safely" reference for the community. Keep the audit-trail/compliance layer and enterprise SSO/directory integration closed; that is the monetizable slice security teams pay for.

## demo script (3 bullet steps, under 2 minutes)
1. Log in as two users with different Confluence/Jira permissions and ask the same question — the junior engineer's answer omits the security-only page; the admin's includes it.
2. Pull up the audit log live and show the exact query, the documents considered, and which were filtered out and why.
3. Tamper with a log entry and watch the hash-chain check catch it — that moment is the entire differentiator.