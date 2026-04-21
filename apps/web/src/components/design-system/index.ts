/**
 * Design-system barrel.
 *
 * Pages import primitives from this single entry point
 * (`@/components/design-system`) so the warm-cream re-skin stays
 * consistent. Segment identity lives alongside the primitives since
 * every card / dot / accent color depends on it.
 */

export * from './primitives';
export * from './segment';
