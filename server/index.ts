import { createHash } from 'node:crypto'
import { createServer } from 'node:http'
import { readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

import { serve } from '@hono/node-server'
import { getRequestListener } from '@hono/node-server'
import { serveStatic } from '@hono/node-server/serve-static'
import { Hono } from 'hono'

import type { QuestDoc } from '../src/model/types'
import { validateQuestDoc } from '../src/model/validate'
import { ensureCurrentWeek } from '../src/model/week'
import { backupToday } from './backup'
import { ensureDataFile } from './data'
import { isLocalHost, isTrustedWrite } from './guard'

const ROOT = resolve(import.meta.dirname, '..')
// 数据目录可覆盖：E2E 用临时目录跑独立实例，绝不碰真实数据
const DATA_DIR = process.env.QUESTORY_DATA_DIR
  ? resolve(process.env.QUESTORY_DATA_DIR)
  : resolve(ROOT, 'data')
const DATA = resolve(DATA_DIR, 'quests.json')
const PORT = Number(process.env.PORT ?? 5199)
const DEV = process.env.NODE_ENV !== 'production'

// 首次运行还没有数据文件：先创建一个合法空文档，保证 clone 后能直接启动
if (await ensureDataFile(DATA)) console.log('首次运行：已创建空数据文件', DATA)

// 上次写盘被中断时可能留下半截临时文件：里面是完整私人数据，启动即清掉
await unlink(`${DATA}.tmp`).catch(() => undefined)

// 每次启动先留一份；同一天只保留第一次的快照
await backupToday(DATA).catch((cause) => {
  console.warn('启动备份失败：', cause instanceof Error ? cause.message : cause)
})

const app = new Hono()

// 只接受本机访问；写请求要求同源，避免恶意页面/DNS rebinding 读写本地数据
app.use('/api/*', async (c, next) => {
  const host = c.req.header('host')
  const isWrite = c.req.method !== 'GET' && c.req.method !== 'HEAD'
  const allowed = isWrite
    ? isTrustedWrite({
        host,
        origin: c.req.header('origin'),
        secFetchSite: c.req.header('sec-fetch-site'),
      })
    : isLocalHost(host)
  if (!allowed) return c.text('forbidden', 403)
  await next()
})

function revisionOf(raw: string): string {
  return createHash('sha1').update(raw).digest('hex')
}

/** If-Match 可能带引号或 W/ 前缀，统一成裸 hash */
function normalizeRevision(value: string | undefined): string | null {
  if (!value) return null
  return value.trim().replace(/^W\//, '').replace(/^"|"$/g, '')
}

app.get('/api/doc', async (c) => {
  const raw = await readFile(DATA, 'utf8')
  c.header('ETag', `"${revisionOf(raw)}"`)
  return c.body(raw, 200, { 'content-type': 'application/json; charset=utf-8' })
})

/** 写盘串行、先写临时文件再原子替换：半截文件比报错更难查 */
let writes: Promise<unknown> = Promise.resolve()

/** 前一次写失败也不要卡住后面的写 */
function enqueue<T>(task: () => Promise<T>): Promise<T> {
  const run = writes.then(
    () => task(),
    () => task(),
  )
  writes = run.catch(() => undefined)
  return run
}

async function writeText(text: string): Promise<void> {
  const tmp = `${DATA}.tmp`
  try {
    await writeFile(tmp, text, 'utf8')
    await rename(tmp, DATA)
  } catch (cause) {
    await unlink(tmp).catch(() => undefined)
    throw cause
  }
}

/**
 * 统一写盘入口：任何来源的文档（客户端保存、自动继承）都先过校验再落盘，
 * 保证「生成出来的非法文档」不会写进 data/quests.json。
 * 返回写进去的内容的版本号，客户端下次保存拿它做 If-Match。
 */
async function writeDoc(doc: QuestDoc): Promise<string> {
  const issues = validateQuestDoc(doc)
  if (issues.length) {
    const first = issues[0]
    throw new Error(`invalid doc: ${first.path || 'document'} ${first.message}`)
  }
  const text = `${JSON.stringify(doc, null, 2)}\n`
  await writeText(text)
  return revisionOf(text)
}

function isQuestDoc(value: unknown): value is QuestDoc {
  return !!value && typeof value === 'object' && Array.isArray((value as { weeks?: unknown }).weeks)
}

function assertValidDoc(doc: QuestDoc): void {
  const issues = validateQuestDoc(doc)
  if (!issues.length) return
  const first = issues[0]
  throw new Error(`invalid doc: ${first.path || 'document'} ${first.message}`)
}

app.put('/api/doc', async (c) => {
  const body = await c.req.text()
  let parsed: unknown
  try {
    parsed = JSON.parse(body)
  } catch {
    return c.json({ error: 'invalid json' }, 400)
  }
  if (!isQuestDoc(parsed)) return c.json({ error: 'not a quest doc' }, 400)
  const issues = validateQuestDoc(parsed)
  if (issues.length) {
    return c.json({ error: 'invalid doc', details: issues.slice(0, 20) }, 422)
  }

  const ifMatch = normalizeRevision(c.req.header('if-match'))

  try {
    const result = await enqueue(async () => {
      const raw = await readFile(DATA, 'utf8')
      const current = revisionOf(raw)
      if (!ifMatch) return { status: 428 as const, revision: current }
      if (ifMatch !== current) return { status: 409 as const, revision: current }

      // 当天第一次写盘前留一份改动前的快照；失败不拦着保存
      await backupToday(DATA, raw).catch((cause) => {
        console.warn('写盘前备份失败：', cause instanceof Error ? cause.message : cause)
      })
      const revision = await writeDoc(parsed)
      return { status: 200 as const, revision }
    })

    if (result.status === 428) {
      return c.json({ error: 'missing if-match', revision: result.revision }, 428)
    }
    if (result.status === 409) {
      return c.json({ error: 'conflict', revision: result.revision }, 409)
    }
    return c.json({ ok: true, revision: result.revision })
  } catch (cause) {
    return c.json({ error: cause instanceof Error ? cause.message : String(cause) }, 500)
  }
})

/**
 * 打开应用时先走这里：本周缺失就从上一个填过的周继承。
 * 读、判断、写回都在同一个队列里，避免两个请求各建一周。
 */
app.post('/api/rollover', async (c) => {
  try {
    const payload = await enqueue(async () => {
      const raw = await readFile(DATA, 'utf8')
      const doc = JSON.parse(raw) as unknown
      if (!isQuestDoc(doc)) throw new Error('not a quest doc')
      assertValidDoc(doc)
      const result = ensureCurrentWeek(doc)
      let revision = revisionOf(raw)
      if (result.info.created) {
        await backupToday(DATA, raw).catch((cause) => {
          console.warn('继承前备份失败：', cause instanceof Error ? cause.message : cause)
        })
        revision = await writeDoc(result.doc)
      }
      return { doc: result.doc, rollover: result.info, revision }
    })
    return c.json(payload)
  } catch (cause) {
    return c.json({ error: cause instanceof Error ? cause.message : String(cause) }, 500)
  }
})

if (DEV) {
  const { createServer: createViteServer } = await import('vite')
  const vite = await createViteServer({
    server: {
      middlewareMode: true,
      // HMR 只绑本机；E2E 起独立实例时关掉 hmr 与 ws，避免与常驻 dev server 抢端口
      hmr: process.env.QUESTORY_DISABLE_HMR ? false : { host: '127.0.0.1' },
      ws: process.env.QUESTORY_DISABLE_HMR ? false : undefined,
    },
    appType: 'spa',
  })
  const api = getRequestListener(app.fetch)

  createServer((req, res) => {
    if (req.url?.startsWith('/api/')) {
      void api(req, res)
      return
    }
    vite.middlewares(req, res, () => {
      res.statusCode = 404
      res.end('Not found')
    })
  }).listen(PORT, '127.0.0.1', () => {
    console.log(`Questory dev → http://127.0.0.1:${PORT}`)
  })
} else {
  app.use('/*', serveStatic({ root: './dist' }))
  serve({ fetch: app.fetch, port: PORT, hostname: '127.0.0.1' }, (info) => {
    console.log(`Questory → http://127.0.0.1:${info.port}`)
  })
}
