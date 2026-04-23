-- Purpose: store provider checkout/deep-link URLs for grocery lists.
-- Instacart Developer Platform returns a Marketplace shopping-list URL
-- that users open to select a store, review items, and check out.

alter table app.grocery_list
  add column if not exists external_url text;
