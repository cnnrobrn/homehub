---
name: onboarding
description: Guide HomeHub first-run setup through chat. Use when the user asks to set up, onboard, or start using HomeHub, including the Money/financials part of the platform, accounts, budgets, bills, subscriptions, Food, Fun, People, sections, tabs, Calendar, or Decisions. This skill asks for the minimum useful details and writes safe HomeHub rows when possible. All sections are visible by default; onboarding settings are progress metadata only.
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
the key facts, and populate the relevant HomeHub data. The app already
shows Calendar, Decisions, and every section for members with access, so
do not change navigation visibility or describe sections as newly
visible.

See `_shared` for Supabase auth and scoping rules. Use the `homehub`
CLI; it injects household scope.

## Flow

1. Identify the target section or tab from the user's request.
2. If the target is unclear, ask which area they want first: Money,
   Food, Fun, or People.
3. Ask one follow-up at a time. Stop asking once you have enough to
   create at least one useful row or a clear first setup artifact.
4. Write safe, low-stakes HomeHub rows directly. For commitments
   (money movement, checkout, booking, cancellation), create a
   suggestion instead or ask for confirmation.
5. Optionally record setup progress in
   `app.household.settings.onboarding.setup_segments`,
   `setup_prompt_ids`, and `setup_surface_ids`. These fields no longer
   control navigation visibility.
6. Tell the user what you added and name the section or tab where it
   lives.

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

Use `calendar` when you create or find events/reminders worth tracking.
Use `decisions` when you create a suggestion, draft, approval card, or
any item that needs a human yes/no. These IDs are only setup-progress
metadata; Calendar and Decisions remain visible regardless.

## Minimum Useful Details

- `financial.accounts`: account name, kind
  (`checking|savings|credit|investment|loan|cash`), optional balance.
- `financial.budgets`: category/name, period
  (`weekly|monthly|yearly`), amount.
- `financial.subscriptions`: service name, price, cadence, last or next
  charge. If you cannot write the derived subscription node, record a
  related transaction/reminder or keep the setup details in chat.
- `financial.calendar`: bill/autopay name, due date, amount if known.
- `food.meal-planner`: date, slot
  (`breakfast|lunch|dinner|snack`), meal title.
- `food.pantry`: item name, quantity/unit if known, location
  (`fridge|freezer|pantry`) if known.
- `food.groceries`: list date if relevant, item names, quantities if
  known.
- `food.dishes`: favorite/disliked dish names and who likes them. If
  direct dish-node writes are blocked, record a meal or ask to use this
  as meal-planning context.
- `fun.trips`: trip name, start date, end date if known, location.
- `fun.queue`: item title and type. Queue rows are memory-backed in the
  current app; if direct writes are blocked, capture the idea in the
  response.
- `fun.calendar`: event title, date/time, location if known.
- `fun.alerts`: reminder title, date/time, what decision/prep is needed.
- `social.people`: person name, relationship/context, birthday if known.
- `social.groups`: group name and members. Group nodes may require a
  server action; if direct writes are blocked, add the people first or
  keep the grouping details in chat.
- `social.calendar`: birthday/anniversary/social plan name and date.
- `social.alerts`: person, reason to reach out, target date.

## Record Setup Progress

This step is optional. Run it after you have created data if you want to
record which setup area the turn covered. Edit `segment`, `prompt_ids`,
and `surface_ids` before running. Use an empty `surface_ids` list if no
top-level surface metadata applies. It preserves existing setup progress.

```bash
homehub onboarding record-progress \
  --segment food \
  --prompt-id food.groceries \
  --surface-id decisions
```

If this returns a permission error, the active member is not allowed to
change household settings. Continue helping the member organize the
details in chat.

## Safe Direct Writes

Use the segment skills for detailed reads and writes. These common
onboarding writes are safe when the member has write access:

```bash
# Food pantry item
homehub food pantry add --name rice --quantity 2 --unit bags --location pantry

# Food grocery list + item. First create the list, then add items to its id.
homehub food groceries create --status draft
homehub food groceries add-item --list-id "$LIST_ID" --name rice --quantity 2 --unit bags

# Social person
homehub social people add --name "Jane Garcia" --relationship friend
```

For events/reminders, write to `app.event` with the right `segment` and
`kind`. For budgets/accounts, load the `financial` skill for the exact
safe setup writes. Keep financial commitments as suggestions.

## Response Pattern

Keep the response short:

- Ask for the next missing detail, or
- Say what was added and name the section, tab, or top-level surface
  where the member can find it.

Good: "I added the pantry staples. You can find them in Food -> Pantry. What else
should be in there?"

Avoid: long setup summaries, generic tutorials, or turning one useful
request into a tour of every tab.
