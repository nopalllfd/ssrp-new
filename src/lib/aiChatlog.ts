/**
 * Pipeline AI Chatlog Tools — logika murni (tanpa React).
 *
 * Alur (hybrid sesuai spesifikasi):
 * 1. Parse chatlog menjadi baris dengan indeks asli dipertahankan.
 * 2. Deteksi deterministik: timestamp, pesan sistem/server, OOC struktural.
 * 3. Kirim potongan (chunk) ke OpenAI untuk klasifikasi kontekstual.
 * 4. Gabungkan keputusan berdasarkan indeks asli (urutan terjaga).
 * 5. Hapus timestamp dari baris tersisa (default), kecuali Keep Timestamps.
 * 6. Kembalikan output + statistik.
 *
 * Integritas: AI hanya mengklasifikasi (keep/drop), tidak pernah menulis ulang
 * teks. Baris yang gagal diklasifikasi atau ambigu DIPERTAHANKAN.
 */

export interface ChatlogLine {
  id: number
  text: string
}

export type ModeKey = 'clean' | 'extract' | 'custom'

export type FilterKey =
  | 'advertisements'
  | 'serverNotifications'
  | 'systemMessages'
  | 'ooc'
  | 'spam'
  | 'unrelatedScenes'
  | 'customKeywords'

export type RemoveReason =
  | 'timestamp'
  | 'empty'
  | 'server_notification'
  | 'system_message'
  | 'ooc'
  | 'advertisement'
  | 'spam'
  | 'unrelated_scene'
  | 'outside_actors'
  | 'custom_exclusion'
  | 'irrelevant'

export interface ProcessSettings {
  mode: ModeKey
  filters: Record<FilterKey, boolean>
  /** Key kategori RP yang dipilih (lihat RP_CATEGORIES). */
  categories: string[]
  customTopic: string
  /** Instruksi natural language bebas dari user. */
  instruction: string
  /** Nama actor yang dipilih user. */
  actors: string[]
  /** Sertakan balasan pihak lain dalam percakapan yang sama. */
  includeReplies: boolean
  /** Hanya pesan yang dibuat oleh actor terpilih. */
  onlySelectedActors: boolean
  /** Kata kunci/pola yang ingin dikecualikan (custom filtering). */
  customExclusions: string[]
  keepTimestamps: boolean
}

export interface RemovedLine {
  id: number
  text: string
  reason: RemoveReason
  /** Alasan tambahan dari AI (opsional). */
  note?: string
}

export interface Decision {
  id: number
  keep: boolean
  category?: string
  reason?: string
}

export interface PipelineStats {
  originalLines: number
  retainedLines: number
  removedLines: number
  actorsDetected: number
  status: 'complete' | 'partial'
}

export interface PipelineResult {
  output: string
  retainedTexts: string[]
  stats: PipelineStats
  removed: RemovedLine[]
  warnings: string[]
}

export const MAX_INPUT_CHARS = 300_000

export const MODE_OPTIONS: { key: ModeKey; title: string; description: string }[] = [
  {
    key: 'clean',
    title: 'Clean Chatlog',
    description: 'Hapus konten tidak relevan, pertahankan dialog & adegan RP bermakna.',
  },
  {
    key: 'extract',
    title: 'Extract Specific RP',
    description: 'Ekstrak hanya baris yang relevan dengan actor, kategori, atau instruksi Anda.',
  },
  {
    key: 'custom',
    title: 'Custom Filtering',
    description: 'Atur sendiri aturan inklusi dan eksklusi secara manual.',
  },
]

export const FILTER_OPTIONS: { key: FilterKey; label: string; hint: string }[] = [
  { key: 'advertisements', label: 'Advertisements', hint: 'Iklan, promosi, dan penawaran.' },
  {
    key: 'serverNotifications',
    label: 'Server notifications',
    hint: 'Player join, quit, disconnect, dan login.',
  },
  { key: 'systemMessages', label: 'System messages', hint: 'Broadcast dan notifikasi sistem.' },
  { key: 'ooc', label: 'OOC conversations', hint: 'Chat di luar karakter.' },
  { key: 'spam', label: 'Spam & repetitive', hint: 'Pesan berulang dan spam.' },
  { key: 'unrelatedScenes', label: 'Unrelated RP scenes', hint: 'Adegan di luar topik.' },
  { key: 'customKeywords', label: 'Custom keywords', hint: 'Kecualikan kata kunci milik Anda.' },
]

export const RP_CATEGORIES: { key: string; label: string }[] = [
  { key: 'character_interactions', label: 'Character interactions' },
  { key: 'conversations', label: 'Conversations & dialogue' },
  { key: 'street_racing', label: 'Street racing & drifting' },
  { key: 'police_crime', label: 'Police, investigations & crime' },
  { key: 'combat', label: 'Combat & shooting' },
  { key: 'business', label: 'Business & negotiations' },
  { key: 'medical', label: 'Medical & injury' },
  { key: 'meetings', label: 'Meetings, confrontations & alliances' },
]

export const REASON_LABELS: Record<RemoveReason, string> = {
  timestamp: 'Timestamp',
  empty: 'Empty line',
  server_notification: 'Server notification',
  system_message: 'System message',
  ooc: 'OOC conversation',
  advertisement: 'Advertisement',
  spam: 'Spam',
  unrelated_scene: 'Unrelated scene',
  outside_actors: 'Outside selected actors',
  custom_exclusion: 'Custom exclusion',
  irrelevant: 'Not relevant',
}

export function defaultFilters(): Record<FilterKey, boolean> {
  return {
    advertisements: true,
    serverNotifications: true,
    systemMessages: true,
    ooc: true,
    spam: true,
    unrelatedScenes: true,
    customKeywords: false,
  }
}

export function defaultSettings(): ProcessSettings {
  return {
    mode: 'clean',
    filters: defaultFilters(),
    categories: [],
    customTopic: '',
    instruction: '',
    actors: [],
    includeReplies: true,
    onlySelectedActors: false,
    customExclusions: [],
    keepTimestamps: false,
  }
}

// ---------------------------------------------------------------------------
// 1. Parsing
// ---------------------------------------------------------------------------

/** Pecah input menjadi baris; id = indeks baris ASLI dipertahankan. */
export function splitChatlogLines(input: string): ChatlogLine[] {
  const normalized = input.replace(/\r\n?/g, '\n')
  const parts = normalized.split('\n')
  // Buang baris kosong terakhir akibat newline penutup file.
  if (parts.length > 1 && parts[parts.length - 1] === '') parts.pop()
  return parts.map((text, i) => ({ id: i, text }))
}

// ---------------------------------------------------------------------------
// 2. Timestamp (deterministik, default AKTIF)
// ---------------------------------------------------------------------------

/** Pola prefix timestamp yang dikenali (hanya di awal baris). */
const TIMESTAMP_PATTERNS: RegExp[] = [
  // [2026-10-15 20:10:01] atau [2026-10-15T20:10:01]
  /^\[?\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(?::\d{2})?(?:\.\d+)?\]?\s*/,
  // [20:10:01] atau [20:10]
  /^\[\d{2}:\d{2}(?::\d{2})?\]\s*/,
  // 2026-10-15 20:10:01 (tanpa kurung)
  /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(?::\d{2})?\s+/,
  // 20:10:01 (tanpa kurung, wajib diikuti whitespace atau akhir baris)
  /^\d{2}:\d{2}:\d{2}(?:\s+|$)/,
]

export interface StripResult {
  text: string
  removed: boolean
}

/**
 * Hapus prefix timestamp dari satu baris.
 * Hanya menghapus di awal baris sehingga angka di dalam dialog
 * (mis. "balapan jam 20:10") tidak tersentuh.
 */
export function stripLeadingTimestamp(text: string): StripResult {
  let current = text
  let removed = false
  // Maksimal 3 prefix berurutan (mis. tanggal + jam terpisah bracket).
  for (let i = 0; i < 3; i++) {
    const match = TIMESTAMP_PATTERNS.find((p) => p.test(current))
    if (!match) break
    const next = current.replace(match, '')
    if (next === current) break
    current = next
    removed = true
    if (current === '') break
  }
  return { text: current, removed }
}

/** Baris yang seluruh isinya hanya timestamp. */
export function isTimestampOnlyLine(text: string): boolean {
  const stripped = stripLeadingTimestamp(text.trim())
  return stripped.removed && stripped.text.trim() === ''
}

// ---------------------------------------------------------------------------
// 3. Deteksi deterministik pesan sistem / notifikasi / OOC
// ---------------------------------------------------------------------------

/** Tanda baris jelas-jelas dialog RP (jadi aturan sistem tidak boleh menghapusnya). */
const SPEECH_MARKER_RE =
  /\b(?:says|tells|shouts|exclaims|whispers|asks|replies|stutters|mumbles)\b|^\/(?:me|do|say|b)\b|:\s+\S/

const SYSTEM_BROADCAST_RE =
  /^(?:\[?\s*(?:server|system|notice|info|announcement)\s*\]?|<\s*(?:server|system|notice)\s*>|!\s*(?:notice|server))\s*[:\-–]\s*/i

const SERVER_NOTIFICATION_PATTERNS: RegExp[] = [
  /\b(?:has|have)\s+(?:just\s+)?(?:joined|connected)\s+(?:the\s+)?server\b/i,
  /\b(?:left|disconnected from|quit|exited)\s+(?:the\s+)?server\b/i,
  /\bhas disconnected\b/i,
  /\b(?:lost connection|connection (?:timed out|lost|refused))\b/i,
  /\b(?:logged in|logged out|logging in|logging out|login (?:successful|failed))\b/i,
  /\bkicked (?:from|out of) (?:the\s+)?server\b/i,
  /\b(?:is now connected|now connected(?: to the server)?)\b/i,
]

export interface SystemMatch {
  reason: RemoveReason
  label: string
}

/**
 * Deteksi pesan sistem yang bisa dikenali secara deterministik.
 * Mengembalikan null jika baris kemungkinan dialog RP (biarkan AI yang putuskan).
 */
export function detectSystemLine(text: string): SystemMatch | null {
  const stripped = stripLeadingTimestamp(text.trim()).text.trim()
  if (!stripped) return null

  if (SYSTEM_BROADCAST_RE.test(stripped)) {
    return { reason: 'system_message', label: REASON_LABELS.system_message }
  }
  // OOC struktural: "(OOC) Nama: ...", "/ooc ...", "(( ... ))" utuh.
  if (/^\(ooc\)\s*/i.test(stripped) || /^\/ooc\b/i.test(stripped)) {
    return { reason: 'ooc', label: REASON_LABELS.ooc }
  }
  if (/^\(\(.*\)\)$/.test(stripped)) {
    return { reason: 'ooc', label: REASON_LABELS.ooc }
  }
  if (SPEECH_MARKER_RE.test(stripped)) return null
  if (SERVER_NOTIFICATION_PATTERNS.some((p) => p.test(stripped))) {
    return { reason: 'server_notification', label: REASON_LABELS.server_notification }
  }
  return null
}

// ---------------------------------------------------------------------------
// 4. Deteksi nama actor
// ---------------------------------------------------------------------------

export interface ActorInfo {
  name: string
  count: number
}

/** Kata-kata umum yang sering terdeteksi salah sebagai nama. */
const NOT_A_NAME = new Set(
  [
    'says',
    'tell',
    'tells',
    'shout',
    'shouts',
    'ask',
    'asks',
    'exclaim',
    'exclaims',
    'whisper',
    'whispers',
    'reply',
    'replies',
    'ooc',
    'me',
    'do',
    'say',
    'the',
    'you',
    'he',
    'she',
    'they',
    'we',
    'it',
    'and',
    'but',
    'god',
    'admin',
    'server',
    'system',
    'notice',
    'everyone',
    'nobody',
    'somebody',
    'someone',
    'anyone',
    'advertisement',
  ].map((w) => w.toLowerCase()),
)

const SPEAKER_COLON_RE =
  /^([A-Z][A-Za-z0-9_'’-]*(?:\s[A-Z][A-Za-z0-9_'’-]*){0,2}):(?=\s|$)/
const SPEECH_VERB_RE =
  /^([A-Z][A-Za-z0-9_'’-]*(?:\s[A-Z][A-Za-z0-9_'’-]*){0,2}?)\s+(?:says|tells|shouts|exclaims|whispers|asks|replies|stutters|mumbles)\b/

function pushActor(map: Map<string, number>, name: string): void {
  const trimmed = name.trim()
  if (trimmed.length < 2 || trimmed.length > 40) return
  if (NOT_A_NAME.has(trimmed.toLowerCase())) return
  map.set(trimmed, (map.get(trimmed) ?? 0) + 1)
}

/**
 * Deteksi nama karakter dari chatlog (heuristik, format bebas).
 * Mendukung pola "Nama: pesan" dan "Nama says/tells/…".
 */
export function detectActors(lines: ChatlogLine[], limit = 50): ActorInfo[] {
  const map = new Map<string, number>()
  for (const line of lines) {
    if (map.size >= limit * 2) break
    const text = stripLeadingTimestamp(line.text.trim()).text.trim()
    if (!text) continue
    const colon = SPEAKER_COLON_RE.exec(text)
    if (colon?.[1]) {
      pushActor(map, colon[1])
      continue
    }
    const verb = SPEECH_VERB_RE.exec(text)
    if (verb?.[1]) pushActor(map, verb[1])
  }
  return [...map.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, limit)
}

// ---------------------------------------------------------------------------
// 5. Chunking
// ---------------------------------------------------------------------------

export interface LineChunk {
  /** Baris yang harus diklasifikasi (keputusan valid hanya untuk id ini). */
  target: ChatlogLine[]
  /** Konteks sebelum (tanpa keputusan). */
  before: ChatlogLine[]
  /** Konteks sesudah (tanpa keputusan). */
  after: ChatlogLine[]
}

export const CHUNK_MAX_CHARS = 6_000
export const CHUNK_OVERLAP = 2

/**
 * Bagi baris menjadi potongan berukuran aman untuk konteks model,
 * dengan beberapa baris konteks di setiap sisi untuk percakapan
 * yang melintasi batas potongan.
 */
export function chunkLines(
  lines: ChatlogLine[],
  maxChars = CHUNK_MAX_CHARS,
  overlap = CHUNK_OVERLAP,
): LineChunk[] {
  const groups: ChatlogLine[][] = []
  let current: ChatlogLine[] = []
  let currentChars = 0
  for (const line of lines) {
    const size = line.text.length + 1
    if (current.length > 0 && currentChars + size > maxChars) {
      groups.push(current)
      current = []
      currentChars = 0
    }
    current.push(line)
    currentChars += size
  }
  if (current.length > 0) groups.push(current)

  return groups.map((target, i) => {
    const prev = i > 0 ? groups[i - 1] : undefined
    const next = i < groups.length - 1 ? groups[i + 1] : undefined
    return {
      target,
      before: prev ? prev.slice(-overlap) : [],
      after: next ? next.slice(0, overlap) : [],
    }
  })
}

// ---------------------------------------------------------------------------
// 6. Prompt
// ---------------------------------------------------------------------------

const CATEGORY_HINTS: Record<string, string> = {
  advertisements: 'advertisements and promotional messages',
  serverNotifications: 'server notifications (join, quit, disconnect, login)',
  systemMessages: 'system messages and unrelated notifications',
  ooc: 'OOC (out-of-character) conversations',
  spam: 'spam and repetitive messages',
  unrelatedScenes: 'unrelated RP scenes',
}

export interface Prompt {
  system: string
  user: string
}

/** Susun prompt klasifikasi untuk satu chunk. */
export function buildPrompt(chunk: LineChunk, settings: ProcessSettings): Prompt {
  const rules: string[] = []

  if (settings.mode === 'clean') {
    rules.push('MODE: Clean Chatlog — drop irrelevant content, keep meaningful RP dialogue and events.')
  } else if (settings.mode === 'extract') {
    rules.push('MODE: Extract Specific RP — keep ONLY lines relevant to the configured actors, RP categories, or custom instruction.')
  } else {
    rules.push('MODE: Custom Filtering — apply the configured inclusion and exclusion rules.')
  }

  const activeFilters = FILTER_OPTIONS.filter(
    (f) => settings.filters[f.key] && f.key !== 'customKeywords',
  )
    .map((f) => CATEGORY_HINTS[f.key] ?? f.label)
    .filter(Boolean)
  if (activeFilters.length > 0) {
    rules.push(`DROP these content types (when enabled by the user): ${activeFilters.join('; ')}.`)
  }

  if (settings.actors.length > 0) {
    const names = settings.actors.join(', ')
    if (settings.onlySelectedActors) {
      rules.push(`Selected actors (keep ONLY messages authored by them): ${names}.`)
    } else if (settings.includeReplies) {
      rules.push(
        `Selected actors: ${names}. Keep their lines AND relevant replies from other participants in the same conversation.`,
      )
    } else {
      rules.push(`Selected actors: ${names}. Keep lines involving them; other participants may be dropped.`)
    }
  }

  if (settings.categories.length > 0) {
    const labels = RP_CATEGORIES.filter((c) => settings.categories.includes(c.key)).map(
      (c) => c.label,
    )
    if (labels.length > 0) rules.push(`RP categories to prioritize: ${labels.join(', ')}.`)
  }
  if (settings.customTopic.trim()) {
    rules.push(`Custom topic: ${settings.customTopic.trim()}`)
  }
  if (settings.instruction.trim()) {
    rules.push(`User instruction (follow the intent, not just keywords): "${settings.instruction.trim()}"`)
  }
  if (settings.filters.customKeywords && settings.customExclusions.length > 0) {
    rules.push(
      `Custom exclusion keywords (weak signal — do not drop a meaningful RP line only because it contains one): ${settings.customExclusions.join(', ')}`,
    )
  }

  const system = [
    'You are a classifier for GTA SA-MP roleplay chatlogs.',
    'You ONLY decide whether each target line is kept or removed. You never rewrite, invent, summarize, translate, reorder, or fabricate text.',
    'Keep the original wording of every line exactly as given — your output is only decisions, never line text.',
    'Preserve /me, /do, /say and other RP commands, speaker attribution, punctuation, and chronology.',
    'Retain ambiguous lines: if dropping a line could remove important RP context, keep it.',
    'Never drop a line only because it looks unimportant in isolation or contains a filter keyword.',
    'Categories for removed lines: advertisement, server_notification, system_message, ooc, spam, unrelated_scene, outside_actors, custom_exclusion, irrelevant. For kept lines use category "kept".',
    'Respond with STRICT JSON only: {"decisions":[{"id":<number>,"keep":true|false,"category":"<category>","reason":"<short reason>"}]}.',
    'Include an entry for EVERY target id exactly once, and nothing for context ids.',
    ...rules,
  ].join('\n')

  const contextLines = [...chunk.before, ...chunk.after]
  const parts: string[] = []
  parts.push('Target lines (classify each id):')
  parts.push(JSON.stringify(chunk.target.map((l) => ({ id: l.id, text: l.text }))))
  if (contextLines.length > 0) {
    parts.push('Context only (do NOT include these ids in your decisions):')
    parts.push(JSON.stringify(contextLines.map((l) => ({ id: l.id, text: l.text }))))
  }
  return { system, user: parts.join('\n') }
}

// ---------------------------------------------------------------------------
// 7. Parsing respons AI
// ---------------------------------------------------------------------------

const CATEGORY_TO_REASON: Record<string, RemoveReason> = {
  advertisement: 'advertisement',
  server_notification: 'server_notification',
  system_message: 'system_message',
  ooc: 'ooc',
  spam: 'spam',
  unrelated_scene: 'unrelated_scene',
  outside_actors: 'outside_actors',
  custom_exclusion: 'custom_exclusion',
  irrelevant: 'irrelevant',
}

/** Parse respons JSON model (menghapus bal ```json bila ada). */
export function parseDecisions(content: string, validIds: Set<number>): Decision[] {
  let raw = content.trim()
  raw = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')
  const start = raw.indexOf('{')
  const end = raw.lastIndexOf('}')
  if (start >= 0 && end > start) raw = raw.slice(start, end + 1)

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new Error('Respons AI tidak dapat dibaca (bukan JSON valid).')
  }
  const decisions = (parsed as { decisions?: unknown }).decisions
  if (!Array.isArray(decisions)) throw new Error('Respons AI tidak memuat daftar keputusan.')

  const result: Decision[] = []
  const seen = new Set<number>()
  for (const item of decisions) {
    if (typeof item !== 'object' || item === null) continue
    const d = item as { id?: unknown; keep?: unknown; category?: unknown; reason?: unknown }
    if (typeof d.id !== 'number' || typeof d.keep !== 'boolean') continue
    if (!validIds.has(d.id) || seen.has(d.id)) continue
    seen.add(d.id)
    result.push({
      id: d.id,
      keep: d.keep,
      category: typeof d.category === 'string' ? d.category : undefined,
      reason: typeof d.reason === 'string' ? d.reason : undefined,
    })
  }
  if (result.length === 0) throw new Error('Respons AI tidak memuat keputusan yang valid.')
  return result
}

export function reasonFromCategory(category: string | undefined): RemoveReason {
  if (category && category in CATEGORY_TO_REASON) {
    return CATEGORY_TO_REASON[category] as RemoveReason
  }
  return 'irrelevant'
}

// ---------------------------------------------------------------------------
// 8. Panggilan endpoint
// ---------------------------------------------------------------------------

/**
 * Kirim prompt ke endpoint serverless /api/ai-chatlog.
 * API key TIDAK pernah menyentuh frontend — hanya server yang memanggil OpenAI.
 */
export async function requestClassification(system: string, user: string): Promise<string> {
  let resp: Response
  try {
    resp = await fetch('/api/ai-chatlog', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
      }),
    })
  } catch {
    throw new Error('Gagal menghubungi endpoint AI. Periksa koneksi Anda.')
  }

  let data: unknown
  try {
    data = await resp.json()
  } catch {
    throw new Error(
      'Endpoint AI tidak merespons dengan benar. Pastikan server berjalan (npm run dev dengan OPENAI_API_KEY di .env) atau deployment Vercel sudah mengonfigurasi OPENAI_API_KEY.',
    )
  }
  const body = data as { content?: unknown; error?: unknown }
  if (!resp.ok || typeof body.content !== 'string') {
    throw new Error(
      typeof body.error === 'string' && body.error
        ? body.error
        : `Permintaan AI gagal (HTTP ${resp.status}).`,
    )
  }
  return body.content
}

// ---------------------------------------------------------------------------
// 9. Pipeline
// ---------------------------------------------------------------------------

export type ClassifyChunk = (chunk: LineChunk, settings: ProcessSettings) => Promise<Decision[]>

/** Klasifikasi default: bangun prompt → endpoint → parse keputusan. */
export const classifyChunk: ClassifyChunk = async (chunk, settings) => {
  const { system, user } = buildPrompt(chunk, settings)
  const content = await requestClassification(system, user)
  return parseDecisions(content, new Set(chunk.target.map((l) => l.id)))
}

interface DeterministicPass {
  removed: Map<number, RemoveReason>
  remaining: ChatlogLine[]
}

/** Deteksi deterministik: timestamp-only, baris kosong, pesan sistem/OOC. */
export function deterministicPass(
  lines: ChatlogLine[],
  settings: ProcessSettings,
): DeterministicPass {
  const removed = new Map<number, RemoveReason>()
  const remaining: ChatlogLine[] = []

  for (const line of lines) {
    const trimmed = line.text.trim()
    if (trimmed === '') {
      removed.set(line.id, 'empty')
      continue
    }
    if (!settings.keepTimestamps && isTimestampOnlyLine(trimmed)) {
      removed.set(line.id, 'timestamp')
      continue
    }
    const system = detectSystemLine(line.text)
    if (system) {
      const enabled =
        (system.reason === 'server_notification' && settings.filters.serverNotifications) ||
        (system.reason === 'system_message' && settings.filters.systemMessages) ||
        (system.reason === 'ooc' && settings.filters.ooc)
      if (enabled) {
        removed.set(line.id, system.reason)
        continue
      }
    }
    remaining.push(line)
  }
  return { removed, remaining }
}

/** Gabungkan hasil deteksi deterministik + keputusan AI menjadi hasil akhir. */
export function assembleResult(
  inputLines: ChatlogLine[],
  deterministic: Map<number, RemoveReason>,
  decisions: Map<number, Decision>,
  settings: ProcessSettings,
  actorsDetected: number,
  warnings: string[],
): PipelineResult {
  const removed: RemovedLine[] = []
  const retained: { id: number; text: string }[] = []

  for (const line of inputLines) {
    const detReason = deterministic.get(line.id)
    if (detReason) {
      removed.push({ id: line.id, text: line.text, reason: detReason })
      continue
    }
    const decision = decisions.get(line.id)
    // Baris tanpa keputusan (chunk gagal / ambigu) DIPERTAHANKAN.
    if (decision && !decision.keep) {
      removed.push({
        id: line.id,
        text: line.text,
        reason: reasonFromCategory(decision.category),
        note: decision.reason,
      })
      continue
    }

    let text = line.text
    if (!settings.keepTimestamps) {
      const stripped = stripLeadingTimestamp(text)
      if (stripped.removed) {
        text = stripped.text
        if (text.trim() === '') {
          removed.push({ id: line.id, text: line.text, reason: 'timestamp' })
          continue
        }
      }
    }
    retained.push({ id: line.id, text })
  }

  const stats: PipelineStats = {
    originalLines: inputLines.length,
    retainedLines: retained.length,
    removedLines: inputLines.length - retained.length,
    actorsDetected,
    status: warnings.length > 0 ? 'partial' : 'complete',
  }

  return {
    output: retained.map((l) => l.text).join('\n'),
    retainedTexts: retained.map((l) => l.text),
    stats,
    removed,
    warnings,
  }
}

/**
 * Pipeline utama: deterministik → chunk AI (progressif) → merge → timestamp.
 *
 * `onProgress` dipanggil dengan (selesai, total) berdasar chunk yang benar-benar
 * telah diproses. Chunk yang gagal memicu warning dan barisnya DIPERTAHANKAN.
 */
export async function runPipeline(
  input: string,
  settings: ProcessSettings,
  classify: ClassifyChunk = classifyChunk,
  onProgress?: (done: number, total: number) => void,
): Promise<PipelineResult> {
  const lines = splitChatlogLines(input)
  const deterministic = deterministicPass(lines, settings)
  const decisions = new Map<number, Decision>()
  const warnings: string[] = []

  const chunks = chunkLines(deterministic.remaining)
  let done = 0
  let failCount = 0
  let consecutiveFails = 0
  let stoppedEarly = false
  onProgress?.(0, chunks.length)

  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i]
    if (!chunk) continue
    try {
      const chunkDecisions = await classify(chunk, settings)
      const valid = new Set(chunk.target.map((l) => l.id))
      for (const d of chunkDecisions) {
        if (valid.has(d.id)) decisions.set(d.id, d)
      }
      consecutiveFails = 0
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Terjadi kesalahan tidak diketahui.'
      failCount += 1
      consecutiveFails += 1
      // Cukup 2 detail pertama agar UI tidak dibanjiri pesan serupa.
      if (failCount <= 2) warnings.push(`Potongan ${i + 1}/${chunks.length} gagal: ${message}`)
      if (consecutiveFails >= 3) {
        warnings.push(
          `Berhenti lebih awal setelah ${failCount} potongan berturut-turut gagal. Baris pada potongan yang gagal tetap dipertahankan.`,
        )
        stoppedEarly = true
        done += 1
        onProgress?.(done, chunks.length)
        break
      }
    }
    done += 1
    onProgress?.(done, chunks.length)
  }

  if (!stoppedEarly && failCount > 2) {
    warnings.push(
      `${failCount} dari ${chunks.length} potongan gagal. Beberapa baris tidak terklasifikasi dan tetap dipertahankan.`,
    )
  }

  const actors = settings.actors.length > 0 ? settings.actors.length : detectActors(lines).length
  return assembleResult(lines, deterministic.removed, decisions, settings, actors, warnings)
}
