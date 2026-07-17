<script setup lang="ts">
import { emit } from '@tauri-apps/api/event'
import { useDebounceFn } from '@vueuse/core'
import { Button, Empty, Flex, Segmented, Slider, Tag } from 'antdv-next'
import dayjs from 'dayjs'
import { computed, watch } from 'vue'
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

    <Empty
      v-if="!notifyStore.history.length"
      :description="$t('pages.preference.notify.hints.historyEmpty')"
    />

    <Flex
      v-for="item in notifyStore.history"
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
  </ProList>
</template>
