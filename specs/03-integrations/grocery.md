# Grocery Integrations

**Purpose.** How HomeHub turns a meal plan into a real grocery order.

**Scope.** Which providers, what we write to them, and how we handle failures.

## Providers

- **Instacart** via their partner API (if accessible) or via their "shared list" link format as a fallback.
- **Amazon Fresh / Whole Foods** via Amazon's store APIs where available.
- **Store-specific**: Kroger, Walmart, Target — each has its own developer API with varying quality. Start with one; add more based on demand.
- **Fallback**: exportable shopping list (PDF / email / Apple Reminders / Todoist via MCP) for providers without an API.

## v1 target

Pick **one** provider to integrate deeply rather than stub three. Likely Instacart given market share. Others fall back to the exportable list path.

## Capability model

Every grocery provider integration implements a small interface:

```ts
interface GroceryProvider {
  searchItem(query, storeId): Candidate[]   // resolve a list item to a SKU
  createCart(storeId): CartHandle
  addToCart(cart, sku, quantity): void
  placeOrder(cart, deliveryWindow, paymentMethod): Order
  getOrder(externalOrderId): OrderStatus
}
```

Worker code is provider-agnostic. Adapter lives in `packages/providers/grocery/*`.

## Flow

1. Meal planner writes `meal` rows.
2. Pantry-diff job computes required groceries for the upcoming window.
3. A draft `grocery_list` is created and shown to the member.
4. Item resolution: each `grocery_list_item` is matched to a provider SKU via `searchItem`. Ambiguous matches are surfaced for member choice.
5. Member reviews and taps "Place order."
6. `action` row enqueued; action worker creates the cart, adds items, chooses delivery window, places order via Nango proxy.
7. Order confirmation email returns via Gmail ingestion → reconciler links it to the `grocery_list`.
8. Status updates (fulfilled, substitutions, out-of-stock) handled by the adapter's `getOrder` poll.

## Substitutions & out-of-stock

Providers handle these server-side. Our reconciler reads the final order back, updates `grocery_list_item` statuses, and may create a follow-up alert ("Your order was missing milk — want to add it to the next run?").

## Pantry synchronization

When an order is marked `received`, a job increments `pantry_item` quantities automatically. Member can adjust in UI. This closes the loop meal plan → groceries → pantry → next meal plan.

## Failure handling

- Provider API failures are retried with backoff, preserving the `action` row's `status = running`.
- On persistent failure, action moves to `failed` with the error, and the member sees a CTA to either retry or fall back to the exportable list.

## Dependencies

- [`nango.md`](./nango.md)
- [`../06-segments/food/pantry-and-grocery.md`](../06-segments/food/pantry-and-grocery.md)

## Open questions

- Do we hold household payment method info or defer to the provider's stored payment? Strong preference: defer to provider. HomeHub should not be PCI-in-scope.
- SKU resolution across stores: cache SKU mappings per `(household, item, provider)` so re-orders don't re-prompt.
