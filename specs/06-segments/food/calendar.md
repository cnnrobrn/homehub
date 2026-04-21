# Food — Calendar

**Purpose.** Time-anchored view of the household's eating and shopping schedule.

## What shows up

| Event kind             | Source                              |
|------------------------|-------------------------------------|
| Planned meal           | `app.meal`                           |
| Grocery delivery window| `app.grocery_list.planned_for`       |
| Restaurant reservation | Gmail ingestion (OpenTable/Resy/etc.) |
| Takeout                | Member-entered or detected from food-delivery receipts |
| Meal-prep block        | Member-entered; optional              |

Rendered as `app.event` with `segment = 'food'`.

## Views

- **Week grid** — seven days × breakfast/lunch/dinner. Primary surface for meal planning.
- **Month view** — compact; useful for spotting variety gaps.
- **Timeline mode** — shows grocery deliveries relative to planned meals so the household can see "this meal assumes Tuesday's delivery."

## Interactions

- Drag to reschedule a meal.
- Click to open a meal's detail pane (dish, ingredients, cook, notes).
- Create meal: search dish node or type free text; enrichment resolves.
- "Copy last week" affordance for households that rotate.

## Conflicts with social events

If a member has a Social event (dinner out) that overlaps a Food meal (dinner at home), the calendar surfaces a reconcile prompt: "Skip this meal?" or "Cook for two?"

## Dependencies

- [`overview.md`](./overview.md)
- [`meal-planning.md`](./meal-planning.md)

## Open questions

- How far ahead do we plan meals by default? Current week + next week.
- Show nutrition totals per day? Useful, potentially noisy. Toggleable in settings.
