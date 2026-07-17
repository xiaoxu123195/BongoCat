import { ref } from 'vue'

import { LISTEN_KEY } from '@/constants'
import { useNotifyStore } from '@/stores/notify'

import { useTauriListen } from './useTauriListen'

export interface NotifyPayload {
  source: string
  kind: string
  message: string
  title?: string
  project?: string | null
  badge?: string | null
}

export interface NotifyEntry {
  id: number
  payload: NotifyPayload
  ts: number
  sticky?: boolean
}

const MAX_BUBBLES = 3

// Ambient status badge (kind === 'status'): shows what the agent is doing
// right now (thinking/editing/testing/waiting) without spawning bubbles.
// Last-write-wins across sources. The TTL is the only backstop for sessions
// interrupted with Esc — Claude Code fires no hook on a user interrupt — so
// keep it short enough that a stale badge doesn't linger.
const BADGE_TTL_MS = 60 * 1000

export interface StatusBadge {
  source: string
  code: string
  ts: number
  project?: string | null
}

export const statusBadge = ref<StatusBadge | null>(null)
let badgeTimer: ReturnType<typeof setTimeout> | undefined

function setBadge(source: string, code: string, project?: string | null, ttlMs = BADGE_TTL_MS) {
  statusBadge.value = { source, code, ts: Date.now(), project }

  clearTimeout(badgeTimer)

  badgeTimer = setTimeout(() => {
    statusBadge.value = null
  }, ttlMs)
}

function clearBadge() {
  clearTimeout(badgeTimer)

  statusBadge.value = null
}

let seq = 0
export const bubbles = ref<NotifyEntry[]>([])

// Deck hover state: while expanded, expired bubbles are kept around (queued
// in pendingRemoval) so the user can read them; they are swept on collapse.
export const stackExpanded = ref(false)
const pendingRemoval = new Set<number>()

function removeBubble(id: number) {
  bubbles.value = bubbles.value.filter(b => b.id !== id)
}

// Sticky (need-input) bubbles carry action buttons; snooze re-pops the same
// payload a few minutes later so a busy user can defer instead of forgetting.
const SNOOZE_MS = 5 * 60 * 1000

let pushBubbleFn: ((payload: NotifyPayload) => void) | undefined

export function dismissBubble(id: number) {
  pendingRemoval.delete(id)

  removeBubble(id)
}

export function snoozeBubble(id: number) {
  const entry = bubbles.value.find(b => b.id === id)

  if (!entry) return

  dismissBubble(id)

  setTimeout(() => pushBubbleFn?.(entry.payload), SNOOZE_MS)
}

export function expandStack() {
  stackExpanded.value = true
}

export function collapseStack() {
  stackExpanded.value = false

  for (const id of pendingRemoval) {
    removeBubble(id)
  }

  pendingRemoval.clear()
}

export function useNotify() {
  const notifyStore = useNotifyStore()

  const pushBubble = (payload: NotifyPayload) => {
    const sticky = payload.kind === 'need-input'
    const entry: NotifyEntry = { id: ++seq, payload, ts: Date.now(), sticky }

    bubbles.value.push(entry)

    if (bubbles.value.length > MAX_BUBBLES) {
      // Prefer evicting an auto-expiring bubble; sticky ones hold their spot.
      const idx = bubbles.value.findIndex(b => !b.sticky)

      bubbles.value.splice(idx === -1 ? 0 : idx, 1)
    }

    if (sticky) return

    const lifeMs = (notifyStore.bubble.durationSec || 8) * 1000

    setTimeout(() => {
      if (stackExpanded.value) {
        pendingRemoval.add(entry.id)
        return
      }

      removeBubble(entry.id)
    }, lifeMs)
  }

  pushBubbleFn = pushBubble

  useTauriListen<NotifyPayload>(LISTEN_KEY.PIXO_NOTIFY, ({ payload }) => {
    // Status ticks only drive the badge — no bubble, no history. The special
    // code "clear" drops the badge (sent by the SessionEnd hook). Preview
    // badges (from the preference page) linger just long enough to be seen.
    if (payload.kind === 'status') {
      if (payload.message === 'clear') clearBadge()
      else setBadge(payload.source, payload.message, payload.project, payload.source === 'preview' ? 4000 : undefined)
      return
    }

    pushBubble(payload)

    // Badge side effects are sender-declared via payload.badge; done/error
    // clear implicitly since the agent is no longer busy.
    if (payload.badge === 'clear') {
      clearBadge()
    } else if (payload.badge) {
      setBadge(payload.source, payload.badge, payload.project)
    } else if (payload.kind === 'done' || payload.kind === 'error') {
      clearBadge()
    }

    // Preview bubbles (fired from the preference page) never enter history.
    if (payload.source === 'preview') return

    notifyStore.addHistory({
      source: payload.source,
      kind: payload.kind,
      message: payload.message,
      title: payload.title,
      project: payload.project ?? undefined,
    })
  })

  return { bubbles }
}
