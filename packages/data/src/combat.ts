// The WC3-style counter matrix: damage multiplier percent (100 = ×1) by
// attack type vs armor type. Pierce shreds light, siege wrecks fortified,
// normal beats medium, hero damage is honest work against everything.

import type { ArmorType, AttackType } from './types.ts';

export const DAMAGE_PCT: Readonly<Record<AttackType, Readonly<Record<ArmorType, number>>>> = {
  normal: { light: 100, medium: 150, heavy: 100, fortified: 70 },
  pierce: { light: 200, medium: 75, heavy: 100, fortified: 35 },
  siege: { light: 100, medium: 50, heavy: 100, fortified: 150 },
  hero: { light: 100, medium: 100, heavy: 100, fortified: 50 },
};
