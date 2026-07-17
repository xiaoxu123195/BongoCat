import { defineStore } from 'pinia'
import { reactive, ref } from 'vue'

export type BubbleStyle = 'comic' | 'dark' | 'neon'

export interface NotifyHistoryItem {
  id: number
  ts: number
  source: string
  kind: string
  message: string
  title?: string
  project?: string
}

export interface NotifyStore {
  bubble: {
    style: BubbleStyle
    width: number
    fontSize: number
    durationSec: number
  }
  badge: {
    style: BubbleStyle
  }
}

const MAX_HISTORY = 100

export const useNotifyStore = defineStore('notify', () => {
  const bubble = reactive<NotifyStore['bubble']>({
    style: 'comic',
    width: 240,
    fontSize: 12,
    durationSec: 8,
  })

  const badge = reactive<NotifyStore['badge']>({
    style: 'dark',
  })

  const history = ref<NotifyHistoryItem[]>([])

  const addHistory = (item: Omit<NotifyHistoryItem, 'id' | 'ts'>) => {
    history.value.unshift({ ...item, id: Date.now() + Math.random(), ts: Date.now() })

    if (history.value.length > MAX_HISTORY) {
      history.value.length = MAX_HISTORY
    }
  }

  const clearHistory = () => {
    history.value = []
  }

  return {
    bubble,
    badge,
    history,
    addHistory,
    clearHistory,
  }
})
