export type MovementType = 'walk' | 'home' | 'desk' | 'gentle' | 'none';
export interface MovementSettings {
  pain: boolean;
  doctorLimit: boolean;
  location: 'out' | 'home' | 'desk';
}

const KEY = 'spike.movement.settings.v1';

/** Health-related answers stay on this device. Never pass this object to analytics or APIs. */
export function loadMovementSettings(): MovementSettings | null {
  try {
    const value = JSON.parse(localStorage.getItem(KEY) || 'null');
    if (!value || typeof value.pain !== 'boolean' || typeof value.doctorLimit !== 'boolean'
      || !['out', 'home', 'desk'].includes(value.location)) return null;
    return { pain: value.pain, doctorLimit: value.doctorLimit, location: value.location };
  } catch {
    return null;
  }
}

/** Throws so the form can surface blocked/full storage rather than silently losing settings. */
export function saveMovementSettings(settings: MovementSettings): void {
  localStorage.setItem(KEY, JSON.stringify({
    pain: settings.pain, doctorLimit: settings.doctorLimit, location: settings.location,
  }));
}

export function movementOption(settings: MovementSettings): MovementType {
  if (settings.doctorLimit) return 'none';
  if (settings.pain) return 'gentle';
  if (settings.location === 'home') return 'home';
  if (settings.location === 'desk') return 'desk';
  return 'walk';
}
