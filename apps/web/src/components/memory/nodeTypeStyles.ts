/**
 * Palette + icon lookup for memory node types. Kept in its own
 * module (rather than inline in components) so the left rail, the
 * type index, and the node header all agree.
 *
 * The icon names map to `lucide-react` exports; consumers do the
 * import themselves because dynamic `Icon` lookups defeat Next's
 * tree-shaking.
 */

import { type NodeType } from '@homehub/shared';

export const NODE_TYPE_LABEL: Record<NodeType, string> = {
  person: 'Person',
  place: 'Place',
  merchant: 'Merchant',
  dish: 'Dish',
  ingredient: 'Ingredient',
  topic: 'Topic',
  event_type: 'Event type',
  subscription: 'Subscription',
  account: 'Account',
  category: 'Category',
};

export const NODE_TYPE_DESCRIPTION: Record<NodeType, string> = {
  person: 'People the household interacts with',
  place: 'Locations — home, work, favorite venues',
  merchant: 'Businesses you transact with',
  dish: 'Meals you cook or order',
  ingredient: 'Ingredients tracked across recipes',
  topic: 'Themes that recur across conversations',
  event_type: 'Classes of recurring events',
  subscription: 'Ongoing paid memberships',
  account: 'Financial accounts',
  category: 'Spending / budgeting categories',
};

export const NODE_TYPES_ORDERED: NodeType[] = [
  'person',
  'place',
  'merchant',
  'dish',
  'ingredient',
  'topic',
  'event_type',
  'subscription',
  'account',
  'category',
];
