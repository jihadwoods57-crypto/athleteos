// AthleteOS core — pure, framework-agnostic domain logic.
// Designed to lift into a shared `packages/core` when the desktop dashboards land.
export * from './types';
export * from './constants';
export * from './scoring';
export * from './recommendation';
export * from './leaderboard';
export * from './content';
export * from './history';
export { createInitialState } from './defaultState';
