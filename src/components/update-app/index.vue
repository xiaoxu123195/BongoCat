<script setup lang="ts">
import { openUrl } from '@tauri-apps/plugin-opener'
import { useIntervalFn } from '@vueuse/core'
import { Flex, message, Modal } from 'antdv-next'
import dayjs from 'dayjs'
import utc from 'dayjs/plugin/utc'
import { reactive, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import VueMarkdown from 'vue-markdown-render'

import { useTauriListen } from '@/composables/useTauriListen'
import { GITHUB_LINK, LISTEN_KEY } from '@/constants'
import { showWindow } from '@/plugins/window'
import { useAppStore } from '@/stores/app'
import { useGeneralStore } from '@/stores/general'

dayjs.extend(utc)

// Fork note: releases on this repo carry no signed latest.json (updater
// artifacts are disabled), so the Tauri updater cannot be used. Version checks
// go through the GitHub API instead, and "update" opens the release page.
const RELEASE_API = 'https://api.github.com/repos/xiaoxu123195/BongoCat/releases/latest'

interface State {
  open: boolean
  version?: string
  currentVersion?: string
  body?: string
  date?: string
  htmlUrl?: string
}

const appStore = useAppStore()
const generalStore = useGeneralStore()
const state = reactive<State>({ open: false })
const MESSAGE_KEY = 'updatable'
const { t } = useI18n()

const { pause, resume } = useIntervalFn(checkUpdate, 1000 * 60 * 60 * 24)

watch(() => generalStore.update.autoCheck, (value) => {
  pause()

  if (!value) return

  checkUpdate()

  resume()
}, { immediate: true })

useTauriListen<boolean>(LISTEN_KEY.UPDATE_APP, () => {
  checkUpdate(true)

  message.loading({
    key: MESSAGE_KEY,
    duration: 0,
    content: t('components.updateApp.hints.checkingUpdates'),
  })
})

async function checkUpdate(visibleMessage = false) {
  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 8000)

    const resp = await fetch(RELEASE_API, {
      signal: controller.signal,
      headers: { Accept: 'application/vnd.github+json' },
    })

    clearTimeout(timer)

    if (!resp.ok) throw new Error(`GitHub API ${resp.status}`)

    const release = await resp.json()

    const latest = String(release.tag_name ?? '').replace(/^v/, '')

    if (latest && latest !== appStore.version) {
      Object.assign(state, {
        version: `v${latest}`,
        currentVersion: `v${appStore.version}`,
        body: release.body ?? '',
        date: release.published_at
          ? dayjs.utc(release.published_at).local().format('YYYY-MM-DD HH:mm:ss')
          : '',
        htmlUrl: release.html_url ?? `${GITHUB_LINK}/releases/latest`,
      })

      showWindow()

      state.open = true

      message.destroy(MESSAGE_KEY)
    } else if (visibleMessage) {
      message.success({ key: MESSAGE_KEY, content: t('components.updateApp.hints.alreadyLatest') })
    }
  } catch (error) {
    if (!visibleMessage) return

    message.error({ key: MESSAGE_KEY, content: String(error) })
  }
}

function handleOk() {
  openUrl(state.htmlUrl ?? `${GITHUB_LINK}/releases/latest`)

  state.open = false
}
</script>

<template>
  <Modal
    v-model:open="state.open"
    :cancel-text="$t('components.updateApp.buttons.updateLater')"
    centered
    :closable="false"
    :mask-closable="false"
    :ok-text="$t('components.updateApp.buttons.goDownload')"
    :title="$t('components.updateApp.title')"
    @ok="handleOk"
  >
    <Flex
      class="pt-1"
      gap="small"
      vertical
    >
      <Flex align="center">
        <span>{{ $t('components.updateApp.labels.updateVersion') }}</span>
        <span>
          <span>{{ state.currentVersion }} 👉 </span>
          <a :href="`${GITHUB_LINK}/releases/tag/${state.version}`">
            {{ state.version }}
          </a>
        </span>
      </Flex>

      <Flex align="center">
        <span>{{ $t('components.updateApp.labels.updateTime') }}</span>
        <span>{{ state.date }}</span>
      </Flex>

      <Flex vertical>
        <span>{{ $t('components.updateApp.labels.changelog') }}</span>

        <VueMarkdown
          class="update-note max-h-40 overflow-auto"
          :source="state.body ?? ''"
        />
      </Flex>
    </Flex>
  </Modal>
</template>

<style lang="scss" scoped>
.update-note {
  :not(a) {
    all: revert;
  }
}
</style>
