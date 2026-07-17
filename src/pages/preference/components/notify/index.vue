<script setup lang="ts">
import { emit } from '@tauri-apps/api/event'
import { homeDir } from '@tauri-apps/api/path'
import { exists, readTextFile, writeTextFile } from '@tauri-apps/plugin-fs'
import { useDebounceFn } from '@vueuse/core'
import { Button, Empty, Flex, message, Modal, Segmented, Slider, Tag } from 'antdv-next'
import dayjs from 'dayjs'
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import type { NotifyHistoryItem } from '@/stores/notify'

import ProListItem from '@/components/pro-list-item/index.vue'
import ProList from '@/components/pro-list/index.vue'
import { LISTEN_KEY } from '@/constants'
import { useNotifyStore } from '@/stores/notify'
import { buildClaudeHooks, mergeClaudeHooks } from '@/utils/claude-hooks'
import { join } from '@/utils/path'
import { projectColor } from '@/utils/shared'

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

// Badge style change → flash a sample status badge on the cat (4s TTL).
watch(() => notifyStore.badge.style, () => {
  emit(LISTEN_KEY.PIXO_NOTIFY, {
    source: 'preview',
    kind: 'status',
    message: 'thinking',
  })
})

function fmtTime(ts: number) {
  return dayjs(ts).format('HH:mm:ss')
}

function dayLabel(ts: number) {
  const day = dayjs(ts)

  if (day.isSame(dayjs(), 'day')) return t('pages.preference.notify.labels.today')

  if (day.isSame(dayjs().subtract(1, 'day'), 'day')) return t('pages.preference.notify.labels.yesterday')

  return day.format('YYYY-MM-DD')
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

// Day headers: history is newest-first, so consecutive same-day runs group.
const groupedHistory = computed(() => {
  const groups: { label: string, items: NotifyHistoryItem[] }[] = []

  for (const item of visibleHistory.value) {
    const label = dayLabel(item.ts)
    const last = groups[groups.length - 1]

    if (last?.label === label) {
      last.items.push(item)
    } else {
      groups.push({ label, items: [item] })
    }
  }

  return groups
})

// A cleared or shrunken filter result may no longer overflow — reset the
// toggle so the button label stays truthful.
watch(filteredHistory, (items) => {
  if (items.length <= HISTORY_PREVIEW) {
    historyExpanded.value = false
  }
})

// Claude Code integration: preview the canonical hook set and merge it into
// ~/.claude/settings.json (original backed up as settings.json.bak first).
const hooksModalOpen = ref(false)
const hooksWriting = ref(false)

const hooksPreview = JSON.stringify({ hooks: buildClaudeHooks() }, null, 2)

async function settingsPath() {
  return join(await homeDir(), '.claude', 'settings.json')
}

async function handleWriteHooks() {
  hooksWriting.value = true

  try {
    const path = await settingsPath()

    if (!(await exists(path))) {
      message.error(t('pages.preference.notify.hints.hooksMissing'))
      return
    }

    const raw = await readTextFile(path)

    let parsed: Record<string, any>

    try {
      parsed = JSON.parse(raw)
    } catch {
      message.error(t('pages.preference.notify.hints.hooksInvalid'))
      return
    }

    await writeTextFile(`${path}.bak`, raw)

    await writeTextFile(path, `${JSON.stringify(mergeClaudeHooks(parsed), null, 2)}\n`)

    message.success(t('pages.preference.notify.hints.hooksWritten'))

    hooksModalOpen.value = false
  } catch (error) {
    message.error(String(error))
  } finally {
    hooksWriting.value = false
  }
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

    <ProListItem :title="$t('pages.preference.notify.labels.badgeStyle')">
      <Segmented
        v-model:value="notifyStore.badge.style"
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

  <ProList :title="$t('pages.preference.notify.labels.claude')">
    <ProListItem
      :description="$t('pages.preference.notify.hints.claude')"
      :title="$t('pages.preference.notify.labels.claudeHooks')"
    >
      <Button @click="hooksModalOpen = true">
        {{ $t('pages.preference.notify.buttons.previewHooks') }}
      </Button>
    </ProListItem>
  </ProList>

  <Modal
    v-model:open="hooksModalOpen"
    centered
    :confirm-loading="hooksWriting"
    :ok-text="$t('pages.preference.notify.buttons.writeHooks')"
    :title="$t('pages.preference.notify.labels.claudeHooks')"
    width="720px"
    @ok="handleWriteHooks"
  >
    <Flex
      gap="small"
      vertical
    >
      <span class="text-3 color-text-tertiary">
        {{ $t('pages.preference.notify.hints.hooksBackup') }}
      </span>

      <pre class="hooks-preview">{{ hooksPreview }}</pre>
    </Flex>
  </Modal>

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

    <template
      v-for="group in groupedHistory"
      :key="group.label"
    >
      <div class="text-3 font-bold color-text-tertiary">
        {{ group.label }}
      </div>

      <Flex
        v-for="item in group.items"
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

          <span
            v-if="item.project"
            class="text-3 font-bold"
            :style="{ color: projectColor(item.project) }"
          >{{ item.project }}</span>

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
    </template>

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

<style scoped>
.hooks-preview {
  max-height: 320px;
  margin: 0;
  padding: 10px;
  overflow: auto;
  border-radius: 8px;
  background: rgba(127, 127, 127, 0.08);
  font-size: 11px;
  line-height: 1.5;
}
</style>
