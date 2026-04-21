# Personas

**Purpose.** Concrete household archetypes that design decisions should be tested against.

**Scope.** Not marketing personas. These are *internal* sanity checks: "does this feature work for the Nguyens?"

## The Martins — couple with two kids (primary target)

- Two working adults, two kids (8 and 11).
- Google Workspace family; both parents have separate Gmail and Google Calendar.
- Use Monarch for budgeting, one shared and one personal card each.
- Grocery order weekly on Instacart.
- Active social calendar: birthdays, school events, weekend outings.

**What they need from HomeHub:** A single view of "the week," auto-generated grocery runs that combine both parents' lists, reminders of kids' friends' birthdays, and a heads-up when two parents RSVP to conflicting events.

## Priya (solo professional, testing the product alone)

- Single adult, no dependents.
- One Gmail, one Google Calendar, YNAB for budgeting.
- Cooks three nights a week, eats out otherwise.
- Travels monthly.

**What she needs from HomeHub:** A single pane of glass for her own life; the "household" is just her. Validates that HomeHub degrades gracefully down to a household of one.

## The Garcia-Chens (multigenerational, five members)

- Two adults, two kids, one live-in grandparent.
- Mixed tech literacy; grandparent only uses a calendar on paper.
- Three Gmail accounts; the kids don't have email.
- Shared expenses split via a budgeting app; grandparent doesn't participate in the app.

**What they need:** Flexible household membership where not every member needs to connect every account, and a way to add events/expenses on behalf of non-connected members.

## The Okonkwos (roommates, not family)

- Three adults share a house; each has their own finances.
- Shared: rent, utilities, groceries sometimes.
- Personal: everything else.

**What they need:** Per-segment sharing grants. Food might be shared; Financial definitely isn't. Tests the "household ≠ family" assumption.

## Design tests

When evaluating a feature, run it through:

- Does it help the Martins? (primary target)
- Does it still work for Priya? (degenerate-case solo user)
- Does it handle the Garcia-Chens' non-connected member? (inclusion)
- Does it respect the Okonkwos' per-segment privacy? (privacy boundary)

If any of these break, the feature needs more thought.
