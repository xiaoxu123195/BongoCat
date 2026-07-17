<script setup lang="ts">
import { emit } from '@tauri-apps/api/event'
import { useDebounceFn } from '@vueuse/core'
import { Button, Empty, Flex, Segmented, Slider, Tag } from 'antdv-next'
import dayjs from 'dayjs'
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import ProListItem from '@/components/pro-list-item/index.vue'
import ProList from '@/components/pro-list/index.vue'
import { LISTEN_KEY } from '@/constants'
import { useNotifyStore } from '@/stores/notify'

const notifyStore = useNotifyStore()
const { t } = useI18n()

const styleOptions = computed(() => [
  { label: t('pages.preference.notify.labels.styleComic'), value: 'comic' },
  { label: t('pages.preference.notify.labels.styleDark'), value: 'dark' },
  { label: t('pages.preference.notify.labels.styleNeon'), value: 'neon' },
])

const KIND_COLOR: Record<string, string> = {
  'done': 'green',
  'need-input': 'gold',
  'error': 'red',
  'warn': 'orange',
}

function sendPreview() {
  emit(LISTEN_KEY.PIXO_NOTIFY, {
    source: 'preview',
    kind: 'done',
    message: t('pages.preference.notify.hints.previewMessage'),
  })
}

const debouncedPreview = useDebounceFn(sendPreview, 300)

// Live preview: any bubble setting change pops a sample bubble on the cat.
watch(() => ({ ...notifyStore.bubble }), (val, old) => {
  if (JSON.stringify(val) === JSON.stringify(old)) return

  debouncedPreview()
})

function fmtTime(ts: number) {
  return dayjs(ts).format('MM-DD HH:mm:ss')
}

// History view: filter by kind, show the latest few, expand on demand.
const HISTORY_PREVIEW = 10

const kindFilter = ref('all')
const historyExpanded = ref(false)

const kindOptions = computed(() => {
  const kinds = [...new Set(notifyStore.history.map(item => item.kind))]

  return [
    { label: t('pages.preference.notify.labels.filterAll'), value: 'all' },
    ...kinds.map(kind => ({ label: kind, value: kind })),
  ]
})

const filteredHistory = computed(() => {
  if (kindFilter.value === 'all') return notifyStore.history

  return notifyStore.history.filter(item => item.kind === kindFilter.value)
})

const visibleHistory = computed(() => {
  if (historyExpanded.value) return filteredHistory.value

  return filteredHistory.value.slice(0, HISTORY_PREVIEW)
})

// A cleared or shrunken filter result may no longer overflow — reset the
// toggle so the button label stays truthful.
watch(filteredHistory, (items) => {
  if (items.length <= HISTORY_PREVIEW) {
    historyExpanded.value = false
  }
})
</script>

<template>
  <ProList :title="$t('pages.preference.notify.labels.bubbleSettings')">
    <ProListItem
      :description="$t('pages.preference.notify.hints.preview')"
      :title="$t('pages.preference.notify.labels.preview')"
    >
      <Button
        type="primary"
        @click="sendPreview"
      >
        {{ $t('pages.preference.notify.buttons.preview') }}
      </Button>
    </ProListItem>

    <ProListItem :title="$t('pages.preference.notify.labels.style')">
      <Segmented
        v-model:value="notifyStore.bubble.style"
        :options="styleOptions"
      />
    </ProListItem>

    <ProListItem
      :description="`${notifyStore.bubble.width}px`"
      :title="$t('pages.preference.notify.labels.width')"
    >
      <Slider
        v-model:value="notifyStore.bubble.width"
        class="w-50"
        :max="400"
        :min="160"
        :step="10"
      />
    </ProListItem>

    <ProListItem
      :description="`${notifyStore.bubble.fontSize}px`"
      :title="$t('pages.preference.notify.labels.fontSize')"
    >
      <Slider
        v-model:value="notifyStore.bubble.fontSize"
        class="w-50"
        :max="20"
        :min="10"
        :step="1"
      />
    </ProListItem>

    <ProListItem
      :description="`${notifyStore.bubble.durationSec}s`"
      :title="$t('pages.preference.notify.labels.duration')"
    >
      <Slider
        v-model:value="notifyStore.bubble.durationSec"
        class="w-50"
        :max="30"
        :min="3"
        :step="1"
      />
    </ProListItem>
  </ProList>

  <ProList :title="$t('pages.preference.notify.labels.history')">
    <ProListItem
      :description="$t('pages.preference.notify.hints.history')"
      :title="$t('pages.preference.notify.labels.historyCount', { count: notifyStore.history.length })"
    >
      <Button
        danger
        :disabled="!notifyStore.history.length"
        @click="notifyStore.clearHistory()"
      >
        {{ $t('pages.preference.notify.buttons.clear') }}
      </Button>
    </ProListItem>

    <Segmented
      v-if="notifyStore.history.length"
      v-model:value="kindFilter"
      :options="kindOptions"
    />

    <Empty
      v-if="!filteredHistory.length"
      :description="$t('pages.preference.notify.hints.historyEmpty')"
    />

    <Flex
      v-for="item in visibleHistory"
      :key="item.id"
      class="b-1 b-solid p-3 bg-elevated b-border-sec rounded-lg"
      gap="small"
      vertical
    >
      <Flex
        align="center"
        gap="small"
      >
        <Tag :color="KIND_COLOR[item.kind] ?? 'default'">
          {{ item.kind }}
        </Tag>

        <span class="text-3 color-text-tertiary">{{ item.source }}</span>

        <span class="ml-auto text-3 color-text-tertiary">{{ fmtTime(item.ts) }}</span>
      </Flex>

      <div class="break-all text-3.5">
        {{ item.message }}
      </div>

      <div
        v-if="item.title"
        class="break-all text-3 color-text-tertiary"
      >
        {{ item.title }}
      </div>
    </Flex>

    <Button
      v-if="filteredHistory.length > HISTORY_PREVIEW"
      block
      type="text"
      @click="historyExpanded = !historyExpanded"
    >
      {{ historyExpanded
        ? $t('pages.preference.notify.buttons.collapse')
        : $t('pages.preference.notify.buttons.showAll', { count: filteredHistory.length }) }}
    </Button>
  </ProList>
</template>
