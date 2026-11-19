import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import type { ChildProcess } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import type { QuestDoc, Week } from '../src/model/types'
import { weekRange } from '../src/model/week'

const ROOT = fileURLToPath(new URL('..', import.meta.url))

const freePort = (): Promise<number> =>
  new Promise((resolve, reject) => {
    const server = createServer()
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      if (address && typeof address === 'object') {
        const { port } = address
        server.close(() => resolve(port))
      } else {
        server.close(() => reject(new Error('拿不到空闲端口')))
      }
    })
  })

const waitExit = (child: ChildProcess, timeoutMs: number): Promise<boolean> => {
  if (child.exitCode !== null || child.signalCode) return Promise.resolve(true)
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), timeoutMs)
    child.once('exit', () => {
      clearTimeout(timer)
      resolve(true)
    })
  })
}

const stopServer = async (child: ChildProcess): Promise<void> => {
  if (child.exitCode !== null || child.signalCode) return
  child.kill('SIGTERM')
  if (await waitExit(child, 2_000)) return
  child.kill('SIGKILL')
  await waitExit(child, 2_000)
}

const waitServer = async (base: string): Promise<void> => {
  const deadline = Date.now() + 30_000
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${base}/api/doc`)
      if (response.ok) return
    } catch {
      // 还没起来
    }
    await new Promise((resolve) => setTimeout(resolve, 150))
  }
  throw new Error('API 测试服务未在期限内就绪')
}

const week: Week = {
  id: 'api-week',
  label: weekRange().label,
  kind: 'normal',
  note: '本周备注',
  review: '只读接口测试总结\n\n第二段原文',
  quadrants: [
    {
      key: 'urgent-important',
      children: [
        {
          id: 'api-task',
          title: '只读接口测试任务',
          note: '保留原始备注\n第二行备注',
          done: true,
          voided: false,
          children: [],
        },
        {
          id: 'api-parent',
          title: '父任务',
          children: [
            { id: 'api-child', title: '已完成后作废', done: true, voided: true, children: [] },
            { id: 'api-open', title: '待确认', done: false, voided: false, children: [] },
          ],
        },
      ],
    },
    { key: 'important', children: [] },
  ],
}

// 最新存档与本周不同；带后缀的周标题也不能靠拼接日期命中。
week.label += '（测试）'
const other: Week = { id: 'api-other', label: '2099 1.5-1.11', kind: 'holiday', quadrants: [] }
const doc: QuestDoc = { version: 1, header: ['API 测试'], weeks: [other, week] }
const dir = mkdtempSync(join(tmpdir(), 'questory-api-'))
writeFileSync(join(dir, 'quests.json'), `${JSON.stringify(doc, null, 2)}\n`)

const port = await freePort()
const base = `http://127.0.0.1:${port}`
const child = spawn(join(ROOT, 'node_modules', '.bin', 'tsx'), ['server/index.ts'], {
  cwd: ROOT,
  env: { ...process.env, PORT: String(port), QUESTORY_DATA_DIR: dir, QUESTORY_DISABLE_HMR: '1' },
  stdio: 'ignore',
})

try {
  await waitServer(base)

  const byLabel = await fetch(`${base}/api/weeks/${encodeURIComponent(week.label)}`)
  assert.equal(byLabel.status, 200, '按 week.label 应能读取周')
  assert.equal(byLabel.headers.get('content-type'), 'text/markdown; charset=utf-8')
  const markdown = await byLabel.text()
  assert.equal(markdown, [
    `# ${week.label}`,
    '',
    '> 本周备注',
    '',
    '## 重要且紧急',
    '',
    '- 已完成｜只读接口测试任务',
    '  > 保留原始备注',
    '  > 第二行备注',
    '- 未关闭｜父任务',
    '  - 已作废｜已完成后作废',
    '  - 未关闭｜待确认',
    '',
    '## 周总结',
    '',
    '> 只读接口测试总结',
    '>',
    '> 第二段原文',
    '',
  ].join('\n'), '一次返回任务层级、状态、备注和总结原文')

  const latest = await fetch(`${base}/api/weeks/latest`)
  assert.equal(latest.status, 404, 'latest 不作为公开周标识')

  const current = await fetch(`${base}/api/weeks/current`)
  assert.equal(current.status, 200)
  assert.equal(await current.text(), markdown, '本周按覆盖今天的标题范围匹配')

  const holiday = await fetch(`${base}/api/weeks/${encodeURIComponent(other.label)}`)
  assert.equal(holiday.status, 200)
  assert.equal(await holiday.text(), `# ${other.label}\n\n假期周\n\n本周没有任务。\n`)

  for (const view of ['overview', 'review']) {
    const removed = await fetch(`${base}/api/weeks/current?view=${view}`)
    assert.equal(removed.status, 400, '不再提供单独视图')
  }

  const byInternalId = await fetch(`${base}/api/weeks/${week.id}`)
  assert.equal(byInternalId.status, 404, '内部 id 不作为公开的周标识')

  const missing = await fetch(`${base}/api/weeks/missing`)
  assert.equal(missing.status, 404, '不存在的周返回 404')

  const list = await fetch(`${base}/api/weeks`)
  assert.equal(list.status, 404, '本版不提供周列表接口')

  const docResponse = await fetch(`${base}/api/doc`)
  assert.equal(docResponse.status, 200, 'UI 使用的文档接口仍应可用')

  const withoutCurrent: QuestDoc = { ...doc, weeks: [other] }
  writeFileSync(join(dir, 'quests.json'), JSON.stringify(withoutCurrent))
  const noCurrent = await fetch(`${base}/api/weeks/current`)
  assert.equal(noCurrent.status, 404, '本周缺失不回退到最新存档')
  assert.deepEqual(await noCurrent.json(), { error: 'current week not found' })
  assert.deepEqual(await (await fetch(`${base}/api/doc`)).json(), withoutCurrent, 'GET 不会建周')

  console.log('api: 本周/label/整周 Markdown/错误/只读 全部通过')
} finally {
  await stopServer(child)
  rmSync(dir, { recursive: true, force: true })
}
