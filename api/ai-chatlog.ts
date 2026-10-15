/**
 * Serverless proxy OpenAI untuk AI Chatlog Tools.
 *
 * Keamanan:
 * - API key dibaca HANYA dari environment variable server (`OPENAI_API_KEY`),
 *   tidak pernah dikirim ke frontend / bundle Vite.
 * - Model dikonfigurasi lewat `OPENAI_MODEL` (default: gpt-4o-mini).
 * - Provider dikonfigurasi lewat `OPENAI_BASE_URL`
 *   (default: https://ai.sumopod.com/v1 — proxy kompatibel OpenAI/SumoPod).
 * - Request divalidasi di server: jumlah pesan, panjang konten, dan metode.
 * - Isi chatlog TIDAK pernah ditulis ke log.
 *
 * Endpoint ini menerima { messages } dari frontend, meneruskannya ke
 * `{baseURL}/chat/completions` (OpenAI-compatible), lalu mengembalikan konten
 * teks hasil model (klasifikasi JSON) beserta nama model yang dipakai.
 */

type Role = 'system' | 'user' | 'assistant'

interface ChatMessage {
  role: Role
  content: string
}

/** Struktur minimal request yang dipahami endpoint ini. */
interface ApiRequest {
  method?: string
  headers: Record<string, string | string[] | undefined>
  body?: unknown
}

/** Struktur minimal response ala Vercel Node runtime. */
interface ApiResponse {
  status(code: number): ApiResponse
  setHeader(name: string, value: string): void
  json(body: unknown): void
}

interface ErrorBody {
  error: string
  code: string
}

const MAX_MESSAGES = 6
const MAX_CONTENT_CHARS = 50_000
const MAX_TOTAL_CHARS = 70_000
const REQUEST_TIMEOUT_MS = 55_000

/** Base URL provider kompatibel OpenAI (default: SumoPod). Diakhiri tanpa "/". */
const DEFAULT_BASE_URL = 'https://ai.sumopod.com/v1'

/** Batas durasi eksekusi fungsi (detik) — aman untuk paket Hobby & Pro Vercel. */
export const maxDuration = 60

function isChatMessage(v: unknown): v is ChatMessage {
  if (typeof v !== 'object' || v === null) return false
  const m = v as { role?: unknown; content?: unknown }
  return (
    (m.role === 'system' || m.role === 'user' || m.role === 'assistant') &&
    typeof m.content === 'string'
  )
}

function fail(res: ApiResponse, status: number, code: string, message: string): void {
  const body: ErrorBody = { error: message, code }
  res.status(status).json(body)
}

function extractOpenaiError(status: number, raw: string): { code: string; message: string } {
  let detail = ''
  try {
    const parsed = JSON.parse(raw) as { error?: { message?: unknown } }
    if (typeof parsed.error?.message === 'string') detail = parsed.error.message
  } catch {
    // Body bukan JSON — abaikan detailnya.
  }
  if (status === 400) {
    return {
      code: 'bad_request',
      message: detail
        ? `OpenAI menolak request: ${detail}`
        : 'OpenAI menolak request (permintaan tidak valid).',
    }
  }
  if (status === 401 || status === 403) {
    return {
      code: 'openai_auth',
      message: 'OpenAI menolak kredensial server. Periksa OPENAI_API_KEY.',
    }
  }
  if (status === 404) {
    return {
      code: 'model_not_found',
      message: detail
        ? `Model tidak ditemukan: ${detail}`
        : 'Model pada OPENAI_MODEL tidak tersedia.',
    }
  }
  if (status === 429) {
    return {
      code: 'rate_limit',
      message: 'Batas permintaan OpenAI tercapai. Coba lagi beberapa saat lagi.',
    }
  }
  if (status >= 500) {
    return {
      code: 'provider_unavailable',
      message: 'Layanan OpenAI sedang bermasalah. Coba lagi sebentar lagi.',
    }
  }
  return {
    code: 'openai_error',
    message: detail ? `Kesalahan OpenAI: ${detail}` : 'Terjadi kesalahan saat memanggil OpenAI.',
  }
}

interface OpenaiSuccess {
  ok: true
  content: string
}
interface OpenaiFailure {
  ok: false
  status: number
  raw: string
}

async function callOpenai(
  apiKey: string,
  model: string,
  messages: ChatMessage[],
  useJsonFormat: boolean,
): Promise<OpenaiSuccess | OpenaiFailure> {
  const payload: Record<string, unknown> = { model, messages }
  if (useJsonFormat) payload.response_format = { type: 'json_object' }

  // Setara dengan OpenAI SDK: new OpenAI({ baseURL, apiKey }) lalu
  // chat.completions.create() → POST {baseURL}/chat/completions
  const baseUrl = (process.env.OPENAI_BASE_URL?.trim() || DEFAULT_BASE_URL).replace(/\/+$/, '')
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  try {
    const resp = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    })
    const raw = await resp.text()
    if (!resp.ok) return { ok: false, status: resp.status, raw }
    try {
      const parsed = JSON.parse(raw) as {
        choices?: { message?: { content?: unknown } }[]
      }
      const content = parsed.choices?.[0]?.message?.content
      if (typeof content !== 'string' || content.length === 0) {
        return { ok: false, status: 502, raw: '' }
      }
      return { ok: true, content }
    } catch {
      return { ok: false, status: 502, raw: '' }
    }
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      // Ditandai status khusus 0 = timeout.
      return { ok: false, status: 0, raw: '' }
    }
    return { ok: false, status: -1, raw: '' }
  } finally {
    clearTimeout(timer)
  }
}

export default async function handler(req: ApiRequest, res: ApiResponse): Promise<void> {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    fail(res, 405, 'method_not_allowed', 'Gunakan POST untuk endpoint ini.')
    return
  }

  const apiKey = process.env.OPENAI_API_KEY?.trim()
  if (!apiKey) {
    fail(
      res,
      503,
      'missing_key',
      'OPENAI_API_KEY belum dikonfigurasi di server. Fitur AI belum aktif.',
    )
    return
  }
  const model = process.env.OPENAI_MODEL?.trim() || 'gpt-4o-mini'

  const body = req.body as { messages?: unknown } | null | undefined
  const messages = body?.messages
  if (!Array.isArray(messages) || messages.length === 0) {
    fail(res, 400, 'invalid_payload', 'Field "messages" wajib berupa array yang tidak kosong.')
    return
  }
  if (messages.length > MAX_MESSAGES) {
    fail(res, 400, 'invalid_payload', `Maksimal ${MAX_MESSAGES} pesan per permintaan.`)
    return
  }
  if (!messages.every(isChatMessage)) {
    fail(res, 400, 'invalid_payload', 'Setiap pesan harus memiliki role dan content string.')
    return
  }
  const totalChars = messages.reduce((sum, m) => sum + m.content.length, 0)
  if (messages.some((m) => m.content.length > MAX_CONTENT_CHARS) || totalChars > MAX_TOTAL_CHARS) {
    fail(res, 413, 'payload_too_large', 'Terlalu besar. Kurangi ukuran potongan chatlog.')
    return
  }
  if (!messages.some((m) => m.role === 'system') || !messages.some((m) => m.role === 'user')) {
    fail(res, 400, 'invalid_payload', 'Harus ada minimal satu pesan system dan satu user.')
    return
  }

  let result = await callOpenai(apiKey, model, messages, true)

  // Model pilihan mungkin tidak mendukung response_format → coba ulang tanpa itu.
  if (!result.ok && result.status === 400) {
    let mentionsFormat = false
    try {
      const parsed = JSON.parse(result.raw) as { error?: { message?: unknown } }
      const msg = typeof parsed.error?.message === 'string' ? parsed.error.message.toLowerCase() : ''
      mentionsFormat = msg.includes('response_format') || msg.includes('json_object')
    } catch {
      mentionsFormat = false
    }
    if (mentionsFormat) result = await callOpenai(apiKey, model, messages, false)
  }

  if (result.ok) {
    res.status(200).json({ content: result.content, model })
    return
  }
  if (result.status === 0) {
    fail(res, 504, 'timeout', 'Permintaan ke OpenAI melebihi batas waktu.')
    return
  }
  if (result.status === -1) {
    fail(res, 502, 'network', 'Gagal terhubung ke OpenAI. Periksa jaringan server.')
    return
  }
  if (result.status === 502 && result.raw === '') {
    fail(res, 502, 'malformed_response', 'Respons OpenAI tidak valid atau kosong.')
    return
  }
  const mapped = extractOpenaiError(result.status, result.raw)
  fail(res, result.status === 429 ? 429 : 502, mapped.code, mapped.message)
}
