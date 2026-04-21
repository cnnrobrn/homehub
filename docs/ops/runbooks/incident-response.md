# Runbook — incident response

Every incident gets a timeline. Every incident gets a post-mortem.

## Template

Copy into a new GitHub issue or the team doc. Fill in as you go; DO NOT
wait until after the incident.

```
# Incident: <short title>

- Severity: P0 / P1 / P2
- Started: <UTC timestamp>
- Resolved: <UTC timestamp | TBD>
- On-call: <name>
- Commander: <name>

## Timeline (UTC)

- HH:MM — Alert fired: <description>.
- HH:MM — Paged.
- HH:MM — First observation: <what was seen>.
- HH:MM — Hypothesis: <what we thought was wrong>.
- HH:MM — Mitigation: <what we did>.
- HH:MM — Resolved: <how we confirmed>.

## Impact

- Which members / households were affected.
- Which features degraded.
- Data loss? (usually no — forward-only migrations + idempotent workers).

## Root cause

- <one-paragraph write-up>.

## Fix

- <link to PR>.

## Follow-ups

- [ ] Add alert for <gap uncovered>.
- [ ] Write runbook for <scenario not yet documented>.
- [ ] Automate the mitigation we manually did.
```

## During the incident

- Comms: post status in the team chat every 15 minutes, even if
  nothing's changed — silence is scarier than "still investigating."
- Declare a commander. The commander does not fix code — they track
  the timeline, hand out tasks, and decide when to escalate.
- Mitigate before rooting-out. A rollback is almost always safer than
  a hot-fix.

## After the incident

- Post-mortem inside 72 hours.
- Blameless. Focus on systems, not people.
- Every follow-up becomes a ticket, assigned, scheduled.

## Severity rubric

- **P0** — production outage; members cannot sign in, or data integrity is threatened.
- **P1** — major degradation; one or more features unavailable; paging.
- **P2** — minor degradation; non-urgent; handle in business hours.
