/**
 * `@homehub/suggestions/social` — social-segment suggestion generators.
 */

export { generateReachOut, type ReachOutInput } from './reach-out.js';

export {
  GIFT_IDEA_MAX_IDEAS,
  GIFT_IDEA_WINDOW_DAYS,
  generateGiftIdea,
  type GiftIdeaInput,
} from './gift-idea.js';

export {
  generateHostBack,
  type FreeWindow,
  type HostBackInput,
  type ReciprocitySignal,
} from './host-back.js';

export {
  type AbsentPersonInfo,
  type HomePlaceSet,
  type SocialEpisodeRow,
  type SocialEventRow,
  type SocialFactRow,
  type SocialPersonRow,
} from './types.js';
