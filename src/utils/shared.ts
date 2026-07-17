import { castArray } from 'es-toolkit/compat'

export function clearObject<T extends Record<string, unknown>>(targets: T | T[]) {
  for (const target of castArray<T>(targets)) {
    for (const key of Object.keys(target)) {
      delete target[key]
    }
  }
}

// Stable per-project accent color for notification chips: same name → same
// hue, so concurrent agent sessions are tellable at a glance.
export function projectColor(name: string) {
  let hash = 0

  for (let i = 0; i < name.length; i++) {
    hash = (hash * 31 + name.charCodeAt(i)) % 360
  }

  return `hsl(${hash}, 70%, 55%)`
}
