import type { IncomingMessage } from 'node:http'
import path from 'node:path'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import type { Plugin } from 'vite'
import { loadEnv } from 'vite'
import { defineConfig } from 'vitest/config'
import aiChatlogHandler from './api/ai-chatlog.ts'

/** Baca body JSON dari request dev server. */
async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = []
  for await (const chunk of req) chunks.push(chunk as Buffer)
  const raw = Buffer.concat(chunks).toString('utf8')
  return raw ? JSON.parse(raw) : undefined
}

/**
 * Endpoint /api/ai-chatlog untuk mode development lokal.
 *
 * Meniru serverless Vercel (api/ai-chatlog.ts) supaya fitur AI Chatlog bisa
 * dicoba lewat `npm run dev` tanpa deploy. API key tetap dibaca HANYA dari
 * env server (.env) — tidak pernah masuk bundle frontend.
 */
function aiChatlogDevEndpoint(env: Record<string, string>): Plugin {
  return {
    name: 'ai-chatlog-dev-endpoint',
    configureServer(server) {
      server.middlewares.use('/api/ai-chatlog', (req, res) => {
        void (async () => {
          const method = req.method
          if (method !== 'POST') {
            res.statusCode = 405
            res.setHeader('Allow', 'POST')
            res.setHeader('Content-Type', 'application/json; charset=utf-8')
            res.end(
              JSON.stringify({ error: 'Gunakan POST untuk endpoint ini.', code: 'method_not_allowed' }),
            )
            return
          }

          let body: unknown
          try {
            body = await readJsonBody(req)
          } catch {
            res.statusCode = 400
            res.setHeader('Content-Type', 'application/json; charset=utf-8')
            res.end(JSON.stringify({ error: 'Body JSON tidak valid.', code: 'invalid_payload' }))
            return
          }

          // Samakan kondisi dengan Vercel: handler selalu baca dari process.env.
          if (!process.env.OPENAI_API_KEY && env.OPENAI_API_KEY) {
            process.env.OPENAI_API_KEY = env.OPENAI_API_KEY
          }
          if (!process.env.OPENAI_BASE_URL && env.OPENAI_BASE_URL) {
            process.env.OPENAI_BASE_URL = env.OPENAI_BASE_URL
          }
          if (!process.env.OPENAI_MODEL && env.OPENAI_MODEL) {
            process.env.OPENAI_MODEL = env.OPENAI_MODEL
          }

          const apiRes = {
            status(code: number) {
              res.statusCode = code
              return apiRes
            },
            setHeader(name: string, value: string) {
              res.setHeader(name, value)
            },
            json(payload: unknown) {
              res.setHeader('Content-Type', 'application/json; charset=utf-8')
              res.end(JSON.stringify(payload))
            },
          }
          await aiChatlogHandler({ method, headers: req.headers, body }, apiRes)
        })().catch(() => {
          if (!res.headersSent) {
            res.statusCode = 500
            res.setHeader('Content-Type', 'application/json; charset=utf-8')
            res.end(JSON.stringify({ error: 'Kesalahan endpoint lokal.', code: 'internal_error' }))
          }
        })
      })
    },
  }
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, __dirname, '')
  return {
    plugins: [react(), tailwindcss(), aiChatlogDevEndpoint(env)],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src'),
      },
    },
    test: {
      environment: 'jsdom',
      globals: true,
      setupFiles: ['./src/test/setup.ts'],
      css: false,
    },
  }
})
