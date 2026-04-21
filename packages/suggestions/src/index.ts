/**
 * `@homehub/suggestions` — deterministic suggestion generators.
 *
 * Each generator returns zero-or-more `SuggestionEmission` records; the
 * suggestions worker owns deduplication and persistence (see
 * `apps/workers/suggestions`). Generators are pure over in-memory
 * inputs and never touch the DB or the model — a caller-supplied
 * `RationaleWriter` handles the one optional model call.
 */

export { type RationaleWriter, type SuggestionEmission } from './types.js';

// Fun-segment generators (M7).
export {
  FREE_WINDOW_LOOKAHEAD_DAYS,
  FREE_WINDOW_MIN_DURATION_HOURS,
  generateOutingIdea,
  type FreeWindow as FunFreeWindow,
  type OutingIdeaInput,
  type OutingIdeaPreferencePlace,
} from './fun/outing-idea.js';

export {
  TRIP_PREP_DEFAULT_CHECKLIST,
  generateTripPrep,
  type TripPrepInput,
  type TripPrepTrip,
} from './fun/trip-prep.js';

export {
  BOOK_RESERVATION_MIN_ATTENDED_COUNT,
  generateBookReservation,
  type BookReservationInput,
  type BookReservationPlaceNode,
} from './fun/book-reservation.js';

// Food-segment generators (M6).
export {
  type DishIngredientEdge,
  type DishNode,
  type MealRow as FoodMealRow,
  type PantryDeficit,
  type PantryItemRow as FoodPantryItemRow,
} from './food/types.js';

export {
  EXPIRING_SOON_DAYS,
  MEAL_SWAP_HORIZON_DAYS,
  generateMealSwapSuggestions,
  type GenerateMealSwapArgs,
  type MealSwapInput,
} from './food/meal-swap.js';

export {
  generateGroceryOrderSuggestions,
  type GenerateGroceryOrderArgs,
  type GroceryOrderInput,
} from './food/grocery-order.js';

export {
  DISH_REPEAT_THRESHOLD,
  NEW_DISH_LOOKBACK_DAYS,
  generateNewDishSuggestions,
  type GenerateNewDishArgs,
  type NewDishInput,
} from './food/new-dish.js';

// Social-segment generators (M8).
export {
  GIFT_IDEA_MAX_IDEAS,
  GIFT_IDEA_WINDOW_DAYS,
  generateGiftIdea,
  generateHostBack,
  generateReachOut,
  type AbsentPersonInfo,
  type FreeWindow,
  type GiftIdeaInput,
  type HomePlaceSet as SocialHomePlaceSet,
  type HostBackInput,
  type ReachOutInput,
  type ReciprocitySignal,
  type SocialEpisodeRow as SuggestSocialEpisodeRow,
  type SocialEventRow as SuggestSocialEventRow,
  type SocialFactRow,
  type SocialPersonRow as SuggestSocialPersonRow,
} from './social/index.js';
