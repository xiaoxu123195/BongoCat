<script setup lang="ts">
import type { MotionInfo } from 'easy-live2d'

import { convertFileSrc } from '@tauri-apps/api/core'
import { PhysicalSize } from '@tauri-apps/api/dpi'
import { Menu, PredefinedMenuItem } from '@tauri-apps/api/menu'
import { sep } from '@tauri-apps/api/path'
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow'
import { exists, readDir } from '@tauri-apps/plugin-fs'
import { useDebounceFn, useEventListener } from '@vueuse/core'
import dayjs from 'dayjs'
import { round } from 'es-toolkit'
import { nth } from 'es-toolkit/compat'
import { onMounted, onUnmounted, ref, watch } from 'vue'

import type { NotifyEntry } from '@/composables/useNotify'

import { useAppMenu } from '@/composables/useAppMenu'
import { useDevice } from '@/composables/useDevice'
import { useGamepad } from '@/composables/useGamepad'
import { useModel } from '@/composables/useModel'
import { collapseStack, dismissBubble, expandStack, snoozeBubble, stackExpanded, statusBadge, useNotify } from '@/composables/useNotify'
import { useTauriListen } from '@/composables/useTauriListen'
import { LISTEN_KEY } from '@/constants'
import { hideWindow, setAlwaysOnTop, setTaskbarVisibility, showWindow } from '@/plugins/window'
import { useCatStore } from '@/stores/cat'
import { useGeneralStore } from '@/stores/general.ts'
import { useModelStore } from '@/stores/model'
import { useNotifyStore } from '@/stores/notify'
import { isImage } from '@/utils/is'
import live2d from '@/utils/live2d'
import { join } from '@/utils/path'
import { isWindows } from '@/utils/platform'
import { clearObject, projectColor } from '@/utils/shared'

const { startListening } = useDevice()
const appWindow = getCurrentWebviewWindow()
const { modelSize, handleLoad, handleDestroy, handleResize, handleKeyChange } = useModel()
const catStore = useCatStore()
const { getBaseMenu, getExitMenu } = useAppMenu()
const modelStore = useModelStore()
const generalStore = useGeneralStore()
const resizing = ref(false)
const backgroundImagePath = ref<string>()
const { stickActive } = useGamepad()
const { bubbles } = useNotify()
const notifyStore = useNotifyStore()

onMounted(startListening)

onUnmounted(handleDestroy)

const debouncedResize = useDebounceFn(async () => {
  await handleResize()

  resizing.value = false
}, 100)

useEventListener('resize', () => {
  resizing.value = true

  debouncedResize()
})

watch(() => modelStore.currentModel, async (model) => {
  if (!model) return

  await handleLoad()

  const path = join(model.path, 'resources', 'background.png')

  const existed = await exists(path)

  backgroundImagePath.value = existed ? convertFileSrc(path) : void 0

  clearObject([modelStore.supportKeys, modelStore.pressedKeys])

  const resourcePath = join(model.path, 'resources')
  const groups = ['left-keys', 'right-keys']

  for await (const groupName of groups) {
    const groupDir = join(resourcePath, groupName)
    const files = await readDir(groupDir).catch(() => [])
    const imageFiles = files.filter(file => isImage(file.name))

    for (const file of imageFiles) {
      const fileName = file.name.split('.')[0]

      modelStore.supportKeys[fileName] = join(groupDir, file.name)
    }
  }

  modelStore.modelReady = true
}, { deep: true, immediate: true })

watch([() => catStore.window.scale, modelSize], async ([scale, modelSize]) => {
  if (!modelSize) return

  const { width, height } = modelSize

  appWindow.setSize(
    new PhysicalSize({
      width: Math.round(width * (scale / 100)),
      height: Math.round(height * (scale / 100)),
    }),
  )
}, { immediate: true })

watch([modelStore.pressedKeys, stickActive], ([keys, stickActive]) => {
  const dirs = Object.values(keys).map((path) => {
    return nth(path.split(sep()), -2)!
  })

  const hasLeft = dirs.some(dir => dir.startsWith('left'))
  const hasRight = dirs.some(dir => dir.startsWith('right'))

  handleKeyChange(true, stickActive.left || hasLeft)
  handleKeyChange(false, stickActive.right || hasRight)
}, { deep: true })

watch(() => catStore.window.visible, async (value) => {
  value ? showWindow() : hideWindow()
})

watch(() => catStore.window.passThrough, (value) => {
  appWindow.setIgnoreCursorEvents(value)
}, { immediate: true })

watch(() => catStore.window.alwaysOnTop, setAlwaysOnTop, { immediate: true })

watch(() => generalStore.app.taskbarVisible, setTaskbarVisibility, { immediate: true })

watch(() => catStore.model.motionSound, live2d.setMotionSoundEnabled, { immediate: true })

watch(() => catStore.model.maxFPS, live2d.setMaxFPS, { immediate: true })

useTauriListen<MotionInfo>(LISTEN_KEY.START_MOTION, ({ payload }) => {
  live2d.startMotion(payload)
})

useTauriListen<number>(LISTEN_KEY.SET_EXPRESSION, ({ payload }) => {
  live2d.setExpression(payload)
})

function handleMouseDown() {
  appWindow.startDragging()
}

async function handleContextmenu(event: MouseEvent) {
  event.preventDefault()

  if (event.shiftKey) return

  const menu = await Menu.new({
    items: [
      ...await getBaseMenu(),
      await PredefinedMenuItem.new({ item: 'Separator' }),
      ...await getExitMenu(),
    ],
  })

  // Temporarily disable always-on-top on Windows so the context menu is not covered
  if (isWindows && catStore.window.alwaysOnTop) {
    setAlwaysOnTop(false)
  }

  await menu.popup()

  // Restore always-on-top after the menu is closed
  if (!isWindows || !catStore.window.alwaysOnTop) return

  setAlwaysOnTop(true)
}

function handleMouseMove(event: MouseEvent) {
  const { buttons, shiftKey, movementX, movementY } = event

  if (buttons !== 2 || !shiftKey) return

  const delta = (movementX + movementY) * 0.5
  const nextScale = Math.max(10, Math.min(catStore.window.scale + delta, 500))

  catStore.window.scale = round(nextScale)
}

function fmtBubbleTime(ts: number) {
  return dayjs(ts).format('HH:mm:ss')
}

// iOS-style deck: the newest bubble hugs the top edge (above the cat's ear),
// older ones peek out below it, progressively smaller and more transparent.
// While hover-expanded, inline styles are dropped so the CSS column layout
// takes over and every bubble is fully readable.
function deckStyle(index: number) {
  if (stackExpanded.value) return void 0

  const depth = Math.min(bubbles.value.length - 1 - index, 2)

  return {
    top: `${depth * 12}px`,
    zIndex: 10 - depth,
    opacity: [1, 0.8, 0.6][depth],
    scale: String(1 - depth * 0.05),
  }
}

// Auto-expiring bubbles dismiss on click (read it, tap it, gone); sticky
// ones require an explicit button so they can't be swatted by accident.
function handleBubbleClick(b: NotifyEntry) {
  if (!b.sticky) dismissBubble(b.id)
}

// Known agent status codes → badge icon; unknown codes render their raw text.
const STATUS_ICONS: Record<string, string> = {
  thinking: '💭',
  editing: '✍️',
  testing: '🧪',
  waiting: '⏸',
}
</script>

<template>
  <div
    class="relative size-screen overflow-hidden children:(absolute size-full)"
    :class="{ '-scale-x-100': catStore.model.mirror }"
    :style="{
      opacity: catStore.window.opacity / 100,
      borderRadius: `${catStore.window.radius}%`,
    }"
    @contextmenu="handleContextmenu"
    @mousedown="handleMouseDown"
    @mousemove="handleMouseMove"
  >
    <img
      v-if="backgroundImagePath"
      class="object-cover"
      :src="backgroundImagePath"
    >

    <canvas id="live2dCanvas" />

    <img
      v-for="path in modelStore.pressedKeys"
      :key="path"
      class="object-cover"
      :src="convertFileSrc(path)"
    >

    <div
      v-show="resizing || !modelStore.modelReady"
      class="flex items-center justify-center bg-black"
    >
      <span class="text-center text-[10vw] text-[#fff]">
        {{ resizing ? $t('pages.main.hints.redrawing') : $t('pages.main.hints.switching') }}
      </span>
    </div>
  </div>

  <!-- Notification bubbles from Claude Code / external tools. Kept OUTSIDE the
       cat container: it gets mirrored (-scale-x-100) and opacity-faded, which
       would flip the bubble text / dim it. -->
  <div
    class="notify-stack"
    :class="{ expanded: stackExpanded }"
    :style="{
      '--nb-width': `${notifyStore.bubble.width}px`,
      '--nb-font': `${notifyStore.bubble.fontSize}px`,
    }"
    @mouseenter="expandStack"
    @mouseleave="collapseStack"
  >
    <transition-group name="notify-bubble">
      <div
        v-for="(b, index) in bubbles"
        :key="b.id"
        class="notify-bubble"
        :class="[`kind-${b.payload.kind}`, `style-${notifyStore.bubble.style}`, { clickable: !b.sticky }]"
        :style="deckStyle(index)"
        @click="handleBubbleClick(b)"
      >
        <div class="notify-source">
          <span>{{ b.payload.source }}</span>
          <span
            v-if="b.payload.project"
            class="notify-project"
          >
            <i
              class="notify-project-dot"
              :style="{ background: projectColor(b.payload.project) }"
            />{{ b.payload.project }}
          </span>
          <span class="notify-time">{{ fmtBubbleTime(b.ts) }}</span>
        </div>
        <div class="notify-msg">
          {{ b.payload.message }}
        </div>
        <div
          v-if="b.payload.title"
          class="notify-title"
        >
          {{ b.payload.title }}
        </div>
        <div
          v-if="b.sticky"
          class="notify-actions"
        >
          <button
            class="notify-btn"
            @click.stop="dismissBubble(b.id)"
          >
            {{ $t('pages.main.bubble.gotIt') }}
          </button>
          <button
            class="notify-btn"
            @click.stop="snoozeBubble(b.id)"
          >
            {{ $t('pages.main.bubble.snooze') }}
          </button>
        </div>
      </div>
    </transition-group>
  </div>

  <!-- Ambient status badge: what the agent is doing right now. Outside the
       mirrored cat container for the same reason as the bubble stack. -->
  <Transition name="status-badge">
    <div
      v-if="statusBadge"
      class="status-badge"
      :class="`badge-${notifyStore.badge.style}`"
    >
      <span>{{ STATUS_ICONS[statusBadge.code] ?? '⚙️' }}</span>
      <span>{{ STATUS_ICONS[statusBadge.code] ? $t(`pages.main.status.${statusBadge.code}`) : statusBadge.code }}</span>
      <span
        v-if="statusBadge.project"
        class="status-badge-project"
      >· {{ statusBadge.project }}</span>
    </div>
  </Transition>
</template>

<style scoped>
/* Notification bubbles. Size (--nb-width / --nb-font) and the visual preset
   (style-comic / style-dark / style-neon) are driven by the notify store,
   adjustable live from the preference window.

   Stacking is an iOS-style deck: the newest bubble hugs the top edge, older
   ones peek out below it (smaller + faded). Per-bubble top/z-index/opacity/
   scale come from deckStyle() inline styles; mount/leave play via keyframe
   animations (which override inline styles while running). Hovering the deck
   expands it into a fully readable column and pauses removals. */
.notify-stack {
  position: fixed;
  top: 6px;
  left: 6px;
  z-index: 100;
  width: var(--nb-width, 240px);
  height: 0;
  overflow: visible;
  pointer-events: none;
}
.notify-stack.expanded {
  height: auto;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 6px;
}
.notify-stack.expanded .notify-bubble {
  position: relative;
}
.notify-bubble {
  position: absolute;
  left: 0;
  width: fit-content;
  max-width: 100%;
  padding: 0.6em 1em 0.7em;
  border-radius: 1.2em;
  font-size: var(--nb-font, 12px);
  line-height: 1.45;
  transform-origin: top left;
  pointer-events: auto; /* hoverable so the deck can expand */
  transition:
    top 0.25s ease,
    opacity 0.25s ease,
    scale 0.25s ease;
  animation: nb-pop 0.28s cubic-bezier(0.34, 1.56, 0.64, 1);
}
@keyframes nb-pop {
  from {
    opacity: 0;
    translate: 0 -8px;
    scale: 0.85;
  }
}
.notify-bubble.clickable {
  cursor: pointer;
}
.notify-bubble-leave-active {
  animation: nb-bye 0.2s ease both;
}
@keyframes nb-bye {
  to {
    opacity: 0;
    translate: 0 -6px;
  }
}
.notify-source {
  display: flex;
  align-items: center;
  font-size: 0.75em;
  font-weight: 700;
  letter-spacing: 0.6px;
  text-transform: uppercase;
  margin-bottom: 2px;
}
/* Kind shows as a small outlined dot before the source label. */
.notify-source::before {
  content: '';
  display: inline-block;
  width: 0.6em;
  height: 0.6em;
  border-radius: 50%;
  margin-right: 5px;
  background: #9ca3af;
  flex-shrink: 0;
}
.kind-done .notify-source::before {
  background: #4ade80;
}
.kind-need-input .notify-source::before {
  background: #facc15;
}
.kind-error .notify-source::before {
  background: #f87171;
}
.kind-warn .notify-source::before {
  background: #fb923c;
}
.notify-time {
  margin-left: auto;
  padding-left: 12px;
  font-weight: 500;
  letter-spacing: 0;
  text-transform: none;
  opacity: 0.75;
}
.notify-project {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  margin-left: 6px;
  font-weight: 600;
  text-transform: none;
  letter-spacing: 0;
}
.notify-project-dot {
  width: 0.55em;
  height: 0.55em;
  border-radius: 50%;
  flex-shrink: 0;
}
.notify-msg {
  font-weight: 600;
  word-break: break-word;
}
.notify-actions {
  display: flex;
  gap: 6px;
  margin-top: 6px;
}
.notify-btn {
  cursor: pointer;
  font: inherit;
  font-size: 0.85em;
  line-height: 1.4;
  padding: 1px 9px;
  border-radius: 999px;
  border: 1px solid currentColor;
  background: transparent;
  color: inherit;
  opacity: 0.75;
}
.notify-btn:hover {
  opacity: 1;
  background: rgba(127, 127, 127, 0.15);
}
.notify-title {
  font-size: 0.9em;
  opacity: 0.65;
  margin-top: 1px;
  word-break: break-word;
}

/* ---- preset: comic (hand-drawn white/black outline + speech tail) ---- */
.style-comic {
  background: #fff;
  border: 2px solid #1a1a1a;
  color: #1a1a1a;
  box-shadow: 2px 3px 0 rgba(26, 26, 26, 0.15);
}
.style-comic .notify-source {
  color: rgba(26, 26, 26, 0.45);
}
.style-comic .notify-source::before {
  border: 1.5px solid #1a1a1a;
}
.style-comic:last-child::after {
  content: '';
  position: absolute;
  right: 16px;
  bottom: -7px;
  width: 10px;
  height: 10px;
  background: #fff;
  border-right: 2px solid #1a1a1a;
  border-bottom: 2px solid #1a1a1a;
  transform: rotate(45deg);
}

/* ---- preset: dark (frosted glass) ---- */
.style-dark {
  background: rgba(20, 20, 24, 0.85);
  backdrop-filter: blur(8px);
  border: 1px solid rgba(255, 255, 255, 0.1);
  color: #f0f0f0;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.4);
}
.style-dark .notify-source {
  color: rgba(240, 240, 240, 0.5);
}

/* ---- preset: neon (cyberpunk glow) ---- */
.style-neon {
  background: rgba(10, 6, 20, 0.92);
  border: 1px solid #3dffb0;
  color: #eafff5;
  box-shadow:
    0 0 10px rgba(61, 255, 176, 0.35),
    inset 0 0 12px rgba(61, 255, 176, 0.08);
}
.style-neon .notify-source {
  color: rgba(61, 255, 176, 0.75);
}
.style-neon .notify-msg {
  text-shadow: 0 0 6px rgba(61, 255, 176, 0.5);
}

/* ---- ambient status badge (top-right pill, themeable like bubbles) ---- */
.status-badge {
  position: fixed;
  top: 6px;
  right: 6px;
  z-index: 99;
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 3px 10px;
  border-radius: 999px;
  font-size: 11px;
  line-height: 1.4;
  white-space: nowrap;
  pointer-events: none;
}
.badge-dark {
  background: rgba(20, 20, 24, 0.82);
  color: #f0f0f0;
  border: 1px solid rgba(255, 255, 255, 0.14);
  backdrop-filter: blur(6px);
}
.badge-comic {
  background: #fff;
  color: #1a1a1a;
  border: 1.5px solid #1a1a1a;
  box-shadow: 1px 2px 0 rgba(26, 26, 26, 0.15);
}
.badge-neon {
  background: rgba(10, 6, 20, 0.92);
  color: #eafff5;
  border: 1px solid #3dffb0;
  box-shadow: 0 0 8px rgba(61, 255, 176, 0.35);
  text-shadow: 0 0 5px rgba(61, 255, 176, 0.5);
}
.status-badge-project {
  opacity: 0.7;
  font-weight: 500;
}
.status-badge-enter-active,
.status-badge-leave-active {
  transition:
    opacity 0.2s ease,
    translate 0.2s ease;
}
.status-badge-enter-from,
.status-badge-leave-to {
  opacity: 0;
  translate: 0 -6px;
}
</style>
