# HomeHub — Household AI Control Panel

## Overview

HomeHub is an AI-powered control panel for the household. It unifies the information streams that run a home — money, meals, leisure, and relationships — into a single surface that can summarize, coordinate, and suggest. Each family member connects their own accounts (calendars, email, budgeting tools, etc.), and HomeHub weaves the data into a shared memory that the household's AI agents reason over.

## Guiding Principles

- **Household-first, not user-first.** The unit of value is the household. Individual connections feed the shared view.
- **One control panel, four domains, one chat.** Everything a household coordinates fits into Financial, Food, Fun, or Social — browsable via the dashboard and askable via a first-party chat.
- **Every domain has the same three-part shape.** Calendar, Summaries & Alerts, Suggestions & Coordination. This symmetry keeps the UI learnable and the data model consistent.
- **Data in → metadata out → memory network.** Any data that lands in the platform is automatically enriched with metadata (entities, topics, dates, people, money, places) and linked into an Obsidian-style memory graph that agents traverse.
- **Memory is layered, not monolithic.** Episodic (things that happened), semantic (atomic facts about entities), and procedural (household patterns and rules) are distinct layers with different write rules and retrieval patterns. Every fact is bi-temporal.
- **Self-hosted where it matters.** Auth brokering (Nango) and orchestration components are self-hosted so the household owns its data path.
- **Agents run in the background; humans decide in the foreground.** Background models draft summaries, detect conflicts, and propose actions. Humans approve and act. A first-party chat surface lets the household *ask* HomeHub instead of only browsing.

## The Four Segments

### 1. Financial
The money view of the household: accounts, budgets, bills, subscriptions, shared expenses, and upcoming large outflows.

### 2. Food
The kitchen view: what's planned, what's in the pantry, what needs to be bought, and what the household is eating this week.

### 3. Fun
The leisure view: activities, trips, hobbies, tickets, reservations, watch/read/play queues, and family outings.

### 4. Social
The people view: family, friends, extended network, upcoming commitments, reciprocity, and relationships that need tending.

## The Three Slices (applied to every segment)

Every segment exposes the same three-part interface. This makes the system predictable to use and uniform to build.

### A. Calendar
A time-anchored view of the segment.

- **Financial calendar** — pay dates, bill due dates, subscription renewals, investment contributions, tax deadlines.
- **Food calendar** — planned meals, grocery delivery windows, restaurant reservations, meal-prep days.
- **Fun calendar** — trips, events, concerts, game nights, scheduled hobby time.
- **Social calendar** — birthdays, anniversaries, recurring check-ins, dinners, visits, kid activities.

All calendars are rendered on a unified timeline so a household can see "what's happening this week" across all four segments at once, or filter to a single segment.

### B. Summaries / Alerts
A continuously-updated briefing of what matters right now in that segment.

- **Summaries** — periodic (daily/weekly/monthly) digests. "Here's what your money did this week." "Here's what you ate and what it cost." "Here's who you spent time with this month."
- **Alerts** — event-driven nudges. "Your credit card autopay failed." "Milk expires tomorrow." "You RSVP'd yes to two events at the same time Saturday." "Mom's birthday is in 7 days and you haven't planned anything."

### C. Suggestions & Coordination
The agentic layer. This is where HomeHub proposes actions and helps the household coordinate.

- **Suggestions** — proactive recommendations from background models. "Shift this $400 from checking to the emergency fund." "Swap Wednesday's chicken for the fish that's about to expire." "You haven't seen the Garcias in 4 months — here are three free evenings you both have."
- **Coordination** — multi-person workflows. Running a grocery run that covers what three household members each need; assigning who picks up the kids; splitting a shared trip budget; confirming dinner plans across calendars.

## Key Features

### Per-user self-connected accounts
Each household member connects their own:
- **Google Calendar** — pulled into the unified calendar with per-person color coding.
- **Gmail** — parsed for receipts, reservations, bills, event invites, shipping notifications.
- **Budgeting apps** — connection to budgeting/financial tools (e.g. Copilot, YNAB, Monarch, or via Plaid-backed services) for balances, transactions, categories, budgets.

Connections are per-user, not per-household. A household is simply the set of users who have opted into sharing with one another.

### Meal planning and grocery connection
- Weekly meal plan editor feeding the Food calendar.
- Pantry/inventory tracking.
- Auto-generated grocery lists from the meal plan minus current pantry.
- Connection to grocery delivery services (Instacart, Amazon Fresh, or store-specific APIs) to push the generated list into a real order.

### Financial connection to budgeting apps
- Read-only sync of accounts, transactions, and budget categories.
- Bill and subscription detection.
- Shared-expense tracking between household members.
- Cash-flow forecasting feeding the Financial calendar.

### Automatic metadata → layered memory network
- Every inbound data item (email, transaction, calendar event, meal, chat turn) runs through a background enrichment pass that extracts **atomic facts** — `(subject, predicate, object)` triples with confidence, evidence, and bi-temporal validity.
- Memory has four layers, each with its own write rules:
  - **Working** — the current agent turn's context. Not persisted as memory.
  - **Episodic** — specific events with time and place (`mem.episode`).
  - **Semantic** — atomic facts about entities (`mem.fact`), each with `valid_from`/`valid_to`/`recorded_at`/`superseded_at` so history is preserved and "as-of" queries work.
  - **Procedural** — detected patterns and member-authored rules (`mem.pattern`, `mem.rule`).
- Extracted facts pass through a **candidate pool** with reinforcement before becoming canonical. Contradictions trigger provenance-weighted conflict resolution — new facts supersede old via closed validity intervals, not overwrite.
- A nightly **consolidator** rolls episodic memory up into semantic and procedural candidates; a weekly **reflection** produces cross-cutting insights the household can confirm or dismiss.
- Every node has a **canonical markdown document** regenerated from its underlying facts and episodes — an Obsidian-style memory the household can browse, with per-fact confirm/edit/dispute/delete controls.
- Agents query memory in a **layer-aware** way: "what do we know about Sarah?" hits semantic first; "when did we last see the Garcias?" hits episodic; "how does this household run?" hits procedural. Retrieval ranks with recency decay, confidence, and a conflict penalty; it surfaces contradictions honestly rather than picking silently.

### First-party conversational surface
- A `/chat` page (plus a `⌘K` launcher reachable from anywhere) lets members *ask* HomeHub: "plan our meal tonight," "what do I owe Priya," "what's happening this weekend."
- The foreground agent runs a slotted-context loop: system + household + procedural + conversation history + layer-aware retrieval. Prompt caching on the stable prefix; intent prefilter decides how much retrieval to spend.
- The agent has a typed tool catalog (read / draft-write / direct-write). Any action that spends money, writes to a third party, or destructively edits memory is a **draft-write** that produces a suggestion card inline — approval stays with the member.
- Every assistant message carries a **memory trace**: the facts and episodes it relied on, with links into the graph browser. Trust is built by being auditable by default.
- Conversations themselves become memory: member-stated facts enter the candidate pool; substantive exchanges roll up into episodes on archive.

## Technical Architecture

### Stack
- **Frontend + edge** — Vercel (Next.js). The control panel UI, public-facing API routes, and lightweight edge functions.
- **Database, auth, storage, realtime** — Supabase. Postgres as the system of record; row-level security keyed to household membership; realtime for live calendar/alert updates; storage for attachments (receipts, photos, docs).
- **Long-running workers, cron, background jobs** — Railway. Enrichment pipelines, sync workers, scheduled summary generation, and anything that shouldn't live in a serverless request.

### Authentication & Integrations
- **Self-hosted Nango** runs on Railway and brokers all third-party OAuth/API connections where Nango has a provider (Google Calendar, Gmail, financial providers, grocery providers, etc.). Tokens are stored in Nango; HomeHub calls Nango to proxy requests or fetch fresh credentials.
- **MCP (Model Context Protocol)** is used for additional syncs and for exposing HomeHub data to the household's AI agents. MCP servers wrap sources that Nango doesn't cover and expose capabilities (read-memory, write-memory, list-calendar, propose-action) to the background models in a standardized way.

### Memory Network
- Enrichment worker on Railway consumes new rows from Supabase, extracts atomic facts + episodes via a background model, and passes them through a candidate-pool → reconciliation stage before writing into the canonical graph.
- Tables (under `mem.*` in Supabase Postgres): `node`, `edge`, `episode`, `fact` (+ `fact_candidate`), `pattern`, `rule`, `mention`, `insight`. Bi-temporal columns on `fact`. `pgvector` for embeddings alongside structured graph tables.
- Each node has a canonical markdown document regenerated from underlying facts/episodes so the graph is human-browsable, Obsidian-style.
- Embeddings on node content and episode content power semantic search; explicit edges and fact predicates power structural traversal; retrieval is hybrid and layer-aware.
- Nightly consolidator + weekly reflection roll episodic memory into semantic candidates and detect procedural patterns.
- Every contradiction is resolved by a provenance-weighted policy (member-written beats inferred; explicit beats ambient; reinforcement matters); supersession preserves history via validity intervals, never overwrite.

### Background & Foreground Models
- **Kimi K2 (via OpenRouter)** is the default background model for enrichment, summarization, alerting, suggestion generation, and consolidation.
- **Foreground model** (chosen at runtime via OpenRouter — Sonnet-class or equivalent) handles interactive chat turns where latency and tool-use quality matter.
- OpenRouter is the single gateway so models can be swapped without code changes. Prompt caching is applied to stable prefixes (system + household + procedural layer) to keep foreground turns fast and cheap across a conversation.
- Enrichment outputs structured JSON; foreground turns output natural language with typed tool calls. Both enforce schemas at the call site.

### Data Flow (end to end)
1. User connects an account via Nango (or an MCP server is registered).
2. Sync worker on Railway pulls data into Supabase tables.
3. On insert, an enrichment job is enqueued.
4. Enrichment worker calls Kimi via OpenRouter, extracts episodes + atomic fact candidates, and hands them to the reconciler which promotes to canonical facts or routes to conflict resolution.
5. Nightly consolidator rolls recent episodes into semantic candidates; a weekly reflection produces insights.
6. Summary, alert, and suggestion workers run on schedule (and on event triggers), read from the graph via layer-aware retrieval, and write back into Supabase.
7. Members browse the control panel (subscribing via Supabase realtime) or ask via `/chat` / `⌘K`. The foreground agent assembles slotted context, calls typed tools, and streams responses with inline suggestion cards for any draft-write actions.
8. Approved actions flow out through Nango/MCP to the relevant third party; conversation turns themselves become memory on natural stopping points.

## Segment × Slice Matrix

| | Calendar | Summaries / Alerts | Suggestions & Coordination |
|---|---|---|---|
| **Financial** | Pay dates, bills, renewals, tax deadlines | Weekly spend digest; failed-payment alerts; over-budget alerts | Transfer suggestions; subscription cleanup; shared-expense settling |
| **Food** | Planned meals, grocery windows, reservations | Weekly meal/cost recap; expiring-item alerts | Meal swaps; auto-generated grocery orders; who-cooks-tonight |
| **Fun** | Trips, events, hobby time | What-you-did recap; ticket/reservation alerts | Outing ideas using free windows; shared trip planning |
| **Social** | Birthdays, anniversaries, check-ins, visits | Who-you-saw recap; "haven't seen X in a while" alerts | Reach-out prompts; gift ideas; coordinating joint plans |

## Out of Scope (initial version)

- Public sharing outside the household.
- Non-Google calendar/email providers (Outlook, iCloud) — planned post-v1.
- Voice interface — planned post-v1.
- Mobile-native app — web-responsive first.
- Member-private chat threads within a household — v1 is household-shared; private mode is v1.1.
- Parallel tool calls in the agent loop — serial in v1 for predictable side effects.

## Open Questions

- Graph store: stay in Postgres with adjacency tables + pgvector, or introduce a dedicated graph DB? Leaning Postgres for operational simplicity.
- Household model: invite-based with explicit sharing grants per segment, or all-or-nothing membership? Leaning per-segment grants.
- Suggestion autonomy: which categories of suggestion (if any) can auto-execute vs. always require human approval? Default to approval-required for anything that spends money, sends a message, or modifies an external calendar.
- Memory retention policy: how long do raw emails/transactions stay vs. just the extracted metadata? Needs a user-controlled knob.
