# Threat Model

**Purpose.** The attack and failure scenarios we design against.

**Scope.** Assets, threats, mitigations. Not a compliance checklist.

## Assets

1. **Household data** — transactions, emails, calendar, memory graph. The core value and the core liability.
2. **Third-party credentials** — OAuth tokens held by Nango.
3. **Model provider keys** — OpenRouter API key.
4. **The household's own integrations** — actions we could take on their behalf (transfers, orders, message drafts).

## Threats

### T1. Cross-household data leak

A member of household A reading household B's data.

**Mitigations:** RLS on every table. Service-role keys confined to Railway workers. Automated RLS tests in CI. No cross-household entity sharing in the memory graph by design.

### T2. Token theft

An attacker exfiltrating third-party tokens.

**Mitigations:** Tokens live only in Nango (self-hosted). Nango's DB is network-isolated. Workers never handle raw tokens — they call Nango proxy. Audit log of every proxy call.

### T3. Compromised worker

An attacker gaining code execution on a Railway worker.

**Mitigations:** Each worker runs with the minimum secrets it needs. Service role key restricted to the enrichment/action workers. Nango secret key restricted to the sync/action workers. OpenRouter key restricted to model-calling workers. No worker has all keys.

### T4. Model-side prompt injection

Malicious content in an ingested email or calendar event tricking the enrichment model into producing dangerous output (e.g., "add a false transaction," "create a fake suggestion to transfer funds").

**Mitigations:** Structured output only; any model output is schema-validated before it hits the DB. Suggestions never execute without human approval. Action `preview` payloads are hashed at creation; a tampered preview fails hash-check at approval time.

### T5. Malicious member

A household member abusing their access (e.g., exfiltrating another member's data before leaving).

**Mitigations:** Per-segment grants. Account-level grants for roommate-like cases. Audit log visible to owners. Removing a member strips their access within one query's latency.

### T6. Upstream provider compromise

A budgeting app or grocery provider is breached; our connection is used maliciously.

**Mitigations:** Read-only scopes where possible. Write actions require human approval + quorum for high-dollar. Anomaly detection in the action-executor (e.g., first-ever attempt to move funds outside normal accounts) requires re-approval.

### T7. Model-provider data retention

OpenRouter / underlying model providers retain prompts.

**Mitigations:** Use providers with no-training + short retention commitments. Minimize PII in prompts (no account numbers, no message bodies beyond what's needed). Household owners can see model spend and request export/deletion of their graph.

### T8. Self-serve account takeover

Attacker gains access to a member's email → Supabase magic link → account.

**Mitigations:** Google OAuth recommended over email magic link. Session rotation on sensitive actions (change password, remove member, disconnect provider). Email notification to all household owners on new device sign-in.

## Non-threats (explicitly)

- **We are not defending against nation-state actors.** If that becomes relevant, that's a v2 conversation.
- **We don't own physical security of a household member's devices.** We advise 2FA on Google; that's the member's responsibility.

## Dependencies

- [`auth.md`](./auth.md)
- [`data-retention.md`](./data-retention.md)
- [`../02-data-model/row-level-security.md`](../02-data-model/row-level-security.md)
