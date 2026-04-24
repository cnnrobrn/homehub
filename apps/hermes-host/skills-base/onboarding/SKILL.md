---
name: onboarding
description: Guide HomeHub first-run setup through chat. Use when the user asks to set up HomeHub, make a section, tab, Calendar, or Decisions appear, start tracking a household area, or populate an empty Money/Food/Fun/People surface. This skill asks for the minimum useful details, writes safe HomeHub rows when possible, then reveals the matching UI surfaces through household onboarding settings.
version: 0.1.0
metadata:
  hermes:
    tags: [homehub, onboarding, setup, tabs, sections]
    category: homehub
    requires_toolsets: [terminal]
required_environment_variables:
  - name: HOUSEHOLD_ID
  - name: HOMEHUB_SUPABASE_URL
  - name: HOMEHUB_SUPABASE_ANON_KEY
  - name: HOMEHUB_SUPABASE_JWT
  - name: HOMEHUB_MEMBER_ROLE
    required_for: explaining owner-only setting changes
---

# Onboarding

Use this skill to replace pre-setup checkboxes with a conversation.
Your job is to discover what the member wants HomeHub to handle, collect
the key facts, populate the relevant HomeHub data, and reveal only the
surface that now has something useful to show.

See `_shared` for Supabase auth and scoping rules.

## Flow

1. Identify the target section or tab from the user's request.
2. If the target is unclear, ask which area they want first: Money,
   Food, Fun, or People.
3. Ask one follow-up at a time. Stop asking once you have enough to
   create at least one useful row or a clear first setup artifact.
4. Write safe, low-stakes HomeHub rows directly. For commitments
   (money movement, checkout, booking, cancellation), create a
   suggestion instead or ask for confirmation.
5. Reveal the matching section/tab by updating
   `app.household.settings.onboarding.setup_segments` and
   `setup_prompt_ids`. Reveal top-level Calendar or Decisions with
   `setup_surface_ids`.
6. Tell the user what appeared and what you added.

Do not reveal a tab or top-level surface just because the user mentioned
it. Reveal it after you have populated something or collected enough
information that the surface is no longer empty.

## Section And Tab IDs

Use these exact IDs in `setup_prompt_ids`:

| User wording                         | Segment   | Prompt/tab id             | UI                         |
| ------------------------------------ | --------- | ------------------------- | -------------------------- |
| accounts, balances                   | financial | `financial.accounts`      | `/financial/accounts`      |
| budgets, categories                  | financial | `financial.budgets`       | `/financial/budgets`       |
| subscriptions, recurring charges     | financial | `financial.subscriptions` | `/financial/subscriptions` |
| bills, autopay dates                 | financial | `financial.calendar`      | `/financial/calendar`      |
| meal plan, dinners                   | food      | `food.meal-planner`       | `/food/meal-planner`       |
| pantry, freezer, fridge              | food      | `food.pantry`             | `/food/pantry`             |
| groceries, shopping list             | food      | `food.groceries`          | `/food/groceries`          |
| dishes, favorites, dislikes          | food      | `food.dishes`             | `/food/dishes`             |
| trips, travel                        | fun       | `fun.trips`               | `/fun/trips`               |
| queue, places, shows, ideas          | fun       | `fun.queue`               | `/fun/queue`               |
| outings, tickets, plans              | fun       | `fun.calendar`            | `/fun/calendar`            |
| trip prep, booking reminders         | fun       | `fun.alerts`              | `/fun/alerts`              |
| people, friends, family              | social    | `social.people`           | `/social/people`           |
| groups, circles                      | social    | `social.groups`           | `/social/groups`           |
| birthdays, anniversaries             | social    | `social.calendar`         | `/social/calendar`         |
| check-ins, gifts, hosting follow-ups | social    | `social.alerts`           | `/social/alerts`           |

Top-level surface IDs live in
`household.settings.onboarding.setup_surface_ids`:

| Surface wording                      | Surface id  | UI             |
| ------------------------------------ | ----------- | -------------- |
| calendar, schedule, week, events     | `calendar`  | `/calendar`    |
| decisions, approvals, drafts, yes/no | `decisions` | `/suggestions` |

Reveal `calendar` when you create or find events/reminders worth
showing. Reveal `decisions` when you create a suggestion, draft, approval
card, or any item that needs a human yes/no.

## Minimum Useful Details

- `financial.accounts`: account name, kind
  (`checking|savings|credit|investment|loan|cash`), optional balance.
- `financial.budgets`: category/name, period
  (`weekly|monthly|yearly`), amount.
- `financial.subscriptions`: service name, price, cadence, last or next
  charge. If you cannot write the derived subscription node, reveal the
  tab only after recording a related transaction or reminder.
- `financial.calendar`: bill/autopay name, due date, amount if known.
- `food.meal-planner`: date, slot
  (`breakfast|lunch|dinner|snack`), meal title.
- `food.pantry`: item name, quantity/unit if known, location
  (`fridge|freezer|pantry`) if known.
- `food.groceries`: list date if relevant, item names, quantities if
  known.
- `food.dishes`: favorite/disliked dish names and who likes them. If
  direct dish-node writes are blocked, record a meal or ask to use this
  as meal-planning context before revealing the tab.
- `fun.trips`: trip name, start date, end date if known, location.
- `fun.queue`: item title and type. Queue rows are memory-backed in the
  current app; if direct writes are blocked, capture the idea in the
  response and reveal only after another supported row exists.
- `fun.calendar`: event title, date/time, location if known.
- `fun.alerts`: reminder title, date/time, what decision/prep is needed.
- `social.people`: person name, relationship/context, birthday if known.
- `social.groups`: group name and members. Group nodes may require a
  server action; if direct writes are blocked, reveal after adding the
  people.
- `social.calendar`: birthday/anniversary/social plan name and date.
- `social.alerts`: person, reason to reach out, target date.

## Reveal A Surface

Run this after you have created data. Edit `segment`, `prompt_ids`, and
`surface_ids` before running. Use an empty `surface_ids` list if no
top-level surface should appear yet. It preserves existing revealed
sections, tabs, and surfaces.

```bash
python - <<'PY'
import datetime
import json
import os
import urllib.error
import urllib.request

segment = "food"
prompt_ids = ["food.groceries"]
surface_ids = []

base = os.environ["HOMEHUB_SUPABASE_URL"].rstrip("/")
household_id = os.environ["HOUSEHOLD_ID"]
headers = {
    "apikey": os.environ["HOMEHUB_SUPABASE_ANON_KEY"],
    "Authorization": f"Bearer {os.environ['HOMEHUB_SUPABASE_JWT']}",
    "Accept-Profile": "app",
    "Content-Profile": "app",
    "Content-Type": "application/json",
    "Prefer": "return=representation",
}

def request(method, path, body=None):
    data = None if body is None else json.dumps(body).encode()
    req = urllib.request.Request(f"{base}{path}", data=data, method=method, headers=headers)
    with urllib.request.urlopen(req, timeout=20) as resp:
        raw = resp.read().decode()
        return json.loads(raw) if raw else None

try:
    rows = request("GET", f"/rest/v1/household?id=eq.{household_id}&select=settings")
    settings = (rows[0].get("settings") if rows else {}) or {}
    if not isinstance(settings, dict):
        settings = {}
    onboarding = settings.get("onboarding")
    if not isinstance(onboarding, dict):
        onboarding = {}

    segments = list(onboarding.get("setup_segments") or [])
    ids = list(onboarding.get("setup_prompt_ids") or [])
    surfaces = list(onboarding.get("setup_surface_ids") or [])
    if segment not in segments:
        segments.append(segment)
    for prompt_id in prompt_ids:
        if prompt_id not in ids:
            ids.append(prompt_id)
    for surface_id in surface_ids:
        if surface_id in ("calendar", "decisions") and surface_id not in surfaces:
            surfaces.append(surface_id)

    onboarding["setup_segments"] = segments
    onboarding["setup_prompt_ids"] = ids
    onboarding["setup_surface_ids"] = surfaces
    onboarding["last_onboarded_at"] = datetime.datetime.now(datetime.UTC).isoformat()
    settings["onboarding"] = onboarding

    updated = request(
        "PATCH",
        f"/rest/v1/household?id=eq.{household_id}",
        {"settings": settings},
    )
    print(json.dumps(updated, indent=2))
except urllib.error.HTTPError as e:
    print(e.read().decode() or f"HTTP {e.code}", flush=True)
    raise
PY
```

If this returns a permission error, the active member is not allowed to
change household settings. Explain that an owner can reveal the section,
but still help the member organize the details in chat.

## Safe Direct Writes

Use the segment skills for detailed reads and writes. These common
onboarding writes are safe when the member has write access:

```bash
# Food pantry item
curl -fsSL -X POST \
  -H "apikey: $HOMEHUB_SUPABASE_ANON_KEY" \
  -H "Authorization: Bearer $HOMEHUB_SUPABASE_JWT" \
  -H "Content-Profile: app" \
  -H "Content-Type: application/json" \
  -d '{"household_id":"'"$HOUSEHOLD_ID"'","name":"rice","quantity":2,"unit":"bags","location":"pantry"}' \
  "$HOMEHUB_SUPABASE_URL/rest/v1/pantry_item"

# Food grocery list + item. First create the list, then add items to its id.
curl -fsSL -X POST \
  -H "apikey: $HOMEHUB_SUPABASE_ANON_KEY" \
  -H "Authorization: Bearer $HOMEHUB_SUPABASE_JWT" \
  -H "Content-Profile: app" \
  -H "Content-Type: application/json" \
  -H "Prefer: return=representation" \
  -d '{"household_id":"'"$HOUSEHOLD_ID"'","status":"draft"}' \
  "$HOMEHUB_SUPABASE_URL/rest/v1/grocery_list"

# Social person
curl -fsSL -X POST \
  -H "apikey: $HOMEHUB_SUPABASE_ANON_KEY" \
  -H "Authorization: Bearer $HOMEHUB_SUPABASE_JWT" \
  -H "Content-Profile: app" \
  -H "Content-Type: application/json" \
  -d '{"household_id":"'"$HOUSEHOLD_ID"'","display_name":"Jane Garcia","relationship":"friend"}' \
  "$HOMEHUB_SUPABASE_URL/rest/v1/person"
```

For events/reminders, write to `app.event` with the right `segment` and
`kind`. For budgets/accounts, use the `financial` skill and keep
financial commitments as suggestions.

## Response Pattern

Keep the response short:

- Ask for the next missing detail, or
- Say what was added and name the section, tab, or top-level surface now
  visible.

Good: "I added the pantry staples and opened Food -> Pantry. What else
should be in there?"

Avoid: long setup summaries, generic tutorials, or revealing every tab
in a segment at once.
