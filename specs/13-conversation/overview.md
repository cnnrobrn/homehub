# Conversation — Overview

**Purpose.** The product shape of HomeHub's chat: where it appears, what it does, what it does not do.

## Entry points

The chat is reachable from three places:

1. **Dedicated page** — `/chat`. Full-screen conversation view with history sidebar.
2. **Global launcher** — a persistent "ask" input affixed to the dashboard header. Hit `⌘K` from anywhere to open a floating conversation that can be expanded to the full page.
3. **Context menus** — on any entity (person node, transaction, meal, suggestion), a "Ask about this" opens a new conversation seeded with the entity as context.

## Turn shape

A turn is:

1. Member types a message.
2. HomeHub retrieves relevant memory, assembles context, calls the foreground model.
3. Model may call tools: `query_memory`, `list_events`, `draft_meal_plan`, `propose_suggestion`, etc.
4. Model streams a response; tool calls appear in-line as collapsible "cards" showing the tool, arguments, and result.
5. If the model proposes an action (place order, send draft), the action goes through the standard approval flow — the message contains a suggestion card inline, not a hidden auto-execution.

See [`agent-loop.md`](./agent-loop.md) for the loop internals and [`tools.md`](./tools.md) for the tool catalog.

## Conversation scope

Conversations are **household-scoped**. Any member of the household can see conversation history. There is no member-private chat in v1 — the product is shared-context-first. Members who want private notes have other surfaces.

(Open question: is that right for finances? A member might want to ask about only their personal cards without exposing the thread. See Open questions below.)

## What the chat can do

- **Answer** using memory and connected data: "last month's grocery spend?"
- **Plan**: "plan dinners for the week, one vegetarian, avoid chicken."
- **Draft**: "draft a reply to my mom about Saturday."
- **Propose & execute** (with approval): "order the groceries", "transfer $200 to savings."
- **Teach memory**: "remember that Sarah is vegetarian now" → member-authored fact.
- **Edit memory**: "actually, Mom's birthday is the 12th, not the 14th" → proposes a supersession.
- **Trace itself**: "why did you say that?" → evidence drawer.

## What the chat does not do (v1)

- **No auto-execution** of actions that spend money or write to third parties. Always routed through approval.
- **No message-sending to non-members.** Drafts into Gmail only.
- **No multi-step autonomous loops** without per-step UI. If the agent needs to do more than ~3 tool calls to answer, it surfaces a "working on it" indicator and streams progress; the member can stop at any point.
- **No cross-household chat.** Per principles.

## Persona

HomeHub's assistant voice is:

- Concise. Short paragraphs, not essays.
- Plain-spoken. No jargon unless mirroring the household's own words.
- Accurate about uncertainty. If a fact is conflicting or low-confidence, the assistant says so.
- Never sycophantic. "That's a great question!" is banned.

The system prompt encodes this and cites the memory layers, the current household context, and the household's configured preferences (tone formality, units, etc.).

## Example turns

```
Member: plan our meal tonight
Agent:  [calls query_memory layer=procedural] → "household eats around 7:30 on weekdays"
        [calls list_events today food] → "no meal planned"
        [calls query_memory query=pantry layer=semantic] → pantry state
        [calls query_memory query=recent_meals layer=episodic] → last 7 days

        "Pantry has chicken thighs (expire tomorrow), spinach, and rice.
         You haven't had anything Indian in ~2 weeks. Suggest chicken biryani —
         takes ~45 min, uses the thighs, works with what you've got.
         Want me to pencil it in and flag the spinach is also close?"
```

```
Member: what do I owe Priya?
Agent:  [calls query_memory query=shared_expenses, member=this] → pairwise balance
        "$84.50 on your side, mostly the Saturday groceries and the Airbnb split.
         Want me to draft a Venmo note or add it to her next transfer?"
```

## Dependencies

- [`ui.md`](./ui.md)
- [`agent-loop.md`](./agent-loop.md)
- [`tools.md`](./tools.md)
- [`conversations-data-model.md`](./conversations-data-model.md)

## Open questions

- Member-private threads: valuable for Financial in particular. Leaning: v1.1 feature. For v1, everything is household-visible and that's surfaced clearly in the UI.
- Voice input: nice-to-have, defer. Speech-to-text is a solved browser primitive; wiring it up is trivial but not v1 critical.
- "Whisper mode" / private memory: if the member says "don't remember this," the turn is marked `no_memory_write` and extraction skips it. Leaning yes for v1.
