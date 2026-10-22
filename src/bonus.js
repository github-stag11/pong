// Timed bonus pickups and their tuning. Pure: no imports, so game.js and the renderer can both use it.
export const BONUS_KINDS = ['big', 'small', 'multi', 'shield', 'speed'];
export const BONUS_LABELS = {
  big: 'Big bar', small: 'Shrink rivals', multi: 'Multi-ball', shield: 'Shield', speed: 'Speed shift',
};
export const BONUS_SHORT = { big: '+', small: '-', multi: 'x3', shield: 'S', speed: '>>' };
export const BONUS_COLORS = {
  big: '#6ef0ff', small: '#ff6e9c', multi: '#ffe066', shield: '#b388ff', speed: '#7dff9a',
};
// Labels for the player list while an effect is active.
export const BONUS_TAGS = { big: 'BIG BAR', small: 'SHRUNK', shield: 'SHIELD' };
// Paddle effects; their keys are the names used in player.fx.
export const TIMED_EFFECTS = ['big', 'small', 'shield'];

export const BONUS_TTL = 10; // seconds a pickup stays on the field
export const EFFECT_TTL = 8; // seconds a paddle effect lasts
export const SPAWN_MIN = 8; // seconds between spawns
export const SPAWN_MAX = 15;
export const MAX_FIELD = 2; // pickups on the field at once
export const BONUS_RADIUS = 0.06;

export const BIG_SCALE = 1.5;
export const SMALL_SCALE = 0.6;
export const SPEED_UP = 1.5;
export const SPEED_DOWN = 0.6;
export const MAX_BALLS = 3;
export const MULTI_EXTRA = 2; // balls added by one multi-ball pickup
export const SPLIT_ANGLE = 0.45; // radians the new balls veer away from the original

// Bar scale for a player: their own big bonus and any shrink applied by rivals multiply together.
export function effectScale(player) {
  return (player.fx.big ? BIG_SCALE : 1) * (player.fx.small ? SMALL_SCALE : 1);
}

export function createBonusState() {
  return { timer: null, field: [] };
}
