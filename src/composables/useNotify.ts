import { ref } from 'vue'

import { LISTEN_KEY } from '@/constants'

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
const BUBBLE_LIFE_MS = 8000

let seq = 0
export const bubbles = ref<NotifyEntry[]>([])

function pushBubble(payload: NotifyPayload) {
  const entry: NotifyEntry = { id: ++seq, payload, ts: Date.now() }
  bubbles.value.push(entry)
  if (bubbles.value.length > MAX_BUBBLES) {
    bubbles.value.shift()
  }
  setTimeout(() => {
    bubbles.value = bubbles.value.filter(b => b.id !== entry.id)
  }, BUBBLE_LIFE_MS)
}

export function useNotify() {
  useTauriListen<NotifyPayload>(LISTEN_KEY.PIXO_NOTIFY, ({ payload }) => {
    pushBubble(payload)
  })

  return { bubbles }
}
