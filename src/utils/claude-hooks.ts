// Canonical Claude Code hook set for BongoCat notifications. The preference
// page previews this and merges it into ~/.claude/settings.json. Keep this the
// single source of truth for hook content — never hand-edit installed copies.
//
// PowerShell `$` is written as `\$` because Claude Code runs hook commands
// through a POSIX shell on Windows, which strips the backslash.

export const NOTIFY_MARKER = '127.0.0.1:7077/notify'

export interface ClaudeHookCommand {
  type: 'command'
  async: boolean
  timeout: number
  command: string
}

export interface ClaudeHookGroup {
  matcher: string
  hooks: ClaudeHookCommand[]
}

const PRELUDE = '[Net.ServicePointManager]::Expect100Continue=\\$false'

// Read the hook's stdin JSON as UTF-8 (PowerShell 5.1 defaults to GBK) and
// derive the project name from cwd for per-session bubble chips.
const READ_STDIN
  = '\\$h=(New-Object IO.StreamReader([Console]::OpenStandardInput(),[Text.Encoding]::UTF8)).ReadToEnd()|ConvertFrom-Json;'
    + '\\$p=\'\';if(\\$h.cwd){\\$p=Split-Path ([string]\\$h.cwd) -Leaf}'

const POST
  = '\\$j=\\$b|ConvertTo-Json -Compress -Depth 3;'
    + `Invoke-RestMethod -Uri 'http://${NOTIFY_MARKER}' -Method Post -Headers @{'X-Pixo-Notify'='1'} -ContentType 'application/json' -Body ([Text.Encoding]::UTF8.GetBytes(\\$j)) -TimeoutSec 2|Out-Null`

const ENRICH = 'if(\\$h.transcript_path){\\$b.enrich=@{claudeTranscript=\\$h.transcript_path}};'

const TEST_CMD_PATTERN
  = 'pytest|vitest|jest|playwright|cargo test|go test|node --test|npm (run )?test|pnpm (run )?test|yarn (run )?test'

function psCommand(inner: string): string {
  return `powershell -NoProfile -Command "try{${PRELUDE};${READ_STDIN};${inner}}catch{};exit 0"`
}

function body(kind: string, message: string, badge?: string): string {
  const badgeField = badge ? `;badge='${badge}'` : ''

  return `\\$b=@{source='claude-code';kind='${kind}';message='${message}';project=\\$p${badgeField}};`
}

function entry(matcher: string, inner: string): ClaudeHookGroup {
  return {
    matcher,
    hooks: [{ type: 'command', async: true, timeout: 5, command: psCommand(inner) }],
  }
}

export function buildClaudeHooks(): Record<string, ClaudeHookGroup[]> {
  return {
    UserPromptSubmit: [
      entry('', `${body('status', 'thinking')}${POST}`),
    ],
    PreToolUse: [
      entry('Edit|Write|MultiEdit', `${body('status', 'editing')}${POST}`),
      entry(
        'Bash',
        `\\$c=[string]\\$h.tool_input.command;if(\\$c -match '${TEST_CMD_PATTERN}'){${body('status', 'testing')}${POST}}`,
      ),
    ],
    Notification: [
      // Permission prompts get the sticky bubble (a "waiting" badge would
      // just duplicate it, so it only clears any stale busy badge). Idle
      // prompts are silent: the user already knows they walked away — their
      // one job is sweeping the stale badge after an Esc-interrupted turn,
      // which fires no Stop hook.
      entry('permission_prompt', `${body('need-input', '🔐 需要授权', 'clear')}${ENRICH}${POST}`),
      entry('idle_prompt', `${body('status', 'clear')}${POST}`),
    ],
    Stop: [
      entry(
        '',
        `if(-not \\$h.agent_id -and \\$h.cwd -notlike '*\\AppData\\Local\\Temp*'){${body('done', '✅ 已完成')}${ENRICH}${POST}}`,
      ),
    ],
    // Session over (exit, /clear, logout) → drop the status badge immediately.
    SessionEnd: [
      entry('', `${body('status', 'clear')}${POST}`),
    ],
  }
}

// Merge our hooks into an existing settings.json object: BongoCat-owned
// entries (recognized by the notify URL) are replaced, everything else —
// other hooks, other top-level settings — is preserved. Idempotent.
export function mergeClaudeHooks(settings: Record<string, any>): Record<string, any> {
  const hooks: Record<string, any> = { ...(settings.hooks ?? {}) }

  for (const [event, groups] of Object.entries(buildClaudeHooks())) {
    const existing: any[] = Array.isArray(hooks[event]) ? hooks[event] : []

    const kept = existing
      .map(group => ({
        ...group,
        hooks: (Array.isArray(group?.hooks) ? group.hooks : []).filter(
          (h: any) => !String(h?.command ?? '').includes(NOTIFY_MARKER),
        ),
      }))
      .filter(group => group.hooks.length > 0)

    hooks[event] = [...kept, ...groups]
  }

  return { ...settings, hooks }
}
