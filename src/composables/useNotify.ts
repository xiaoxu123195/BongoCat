import { ref } from 'vue'

import { LISTEN_KEY } from '@/constants'
import { useNotifyStore } from '@/stores/notify'

import { useTauriListen } from './useTauriListen'

export interface NotifyPayload {
  source: string
  kind: string
  message: string
  title?: string
}

export interface NotifyEntry {
  id: number
  payload: NotifyPayload
  ts: number
}

const MAX_BUBBLES = 3

let seq = 0
export const bubbles = ref<NotifyEntry[]>([])

// Deck hover state: while expanded, expired bubbles are kept around (queued
// in pendingRemoval) so the user can read them; they are swept on collapse.
export const stackExpanded = ref(false)
const pendingRemoval = new Set<number>()

function removeBubble(id: number) {
  bubbles.value = bubbles.value.filter(b => b.id !== id)
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
    const entry: NotifyEntry = { id: ++seq, payload, ts: Date.now() }

    bubbles.value.push(entry)

    if (bubbles.value.length > MAX_BUBBLES) {
      bubbles.value.shift()
    }

    const lifeMs = (notifyStore.bubble.durationSec || 8) * 1000

    setTimeout(() => {
      if (stackExpanded.value) {
        pendingRemoval.add(entry.id)
        return
      }

      removeBubble(entry.id)
    }, lifeMs)
  }

  useTauriListen<NotifyPayload>(LISTEN_KEY.PIXO_NOTIFY, ({ payload }) => {
    pushBubble(payload)

    // Preview bubbles (fired from the preference page) never enter history.
    if (payload.source === 'preview') return

    notifyStore.addHistory({
      source: payload.source,
      kind: payload.kind,
      message: payload.message,
      title: payload.title,
    })
  })

  return { bubbles }
}
