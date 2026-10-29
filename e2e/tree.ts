import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import type { ChildProcess } from 'node:child_process'
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { chromium } from 'playwright'
import type { Browser } from 'playwright'

import type { Quest, QuestDoc, Week } from '../src/model/types'
import { weekRange } from '../src/model/week'

const ROOT = fileURLToPath(new URL('..', import.meta.url))

/**
 * 数据隔离：在临时目录里播种一份小数据，用独立端口起一个新实例。
 * 测试只读写临时数据，结束后整目录删除——不读取、不覆盖真实 data/quests.json。
 */
function seedDoc(): QuestDoc {
  const current = weekRange()
  const weeks: Week[] = []
  const total = 12
  for (let index = 0; index < total; index += 1) {
    const start = new Date(current.start.getTime() - index * 7 * 86_400_000)
    const end = new Date(start.getTime() + 6 * 86_400_000)
    const label =
      index === 7
        ? '2026 3.16-3.22'
        : `${start.getUTCFullYear()} ${start.getUTCMonth() + 1}.${start.getUTCDate()}-${end.getUTCMonth() + 1}.${end.getUTCDate()}`
    weeks.push({
      id: `e2e-week-${index}`,
      label,
      kind: 'normal',
      quadrants: [
        {
          key: 'urgent-important',
          children: Array.from({ length: 8 }, (_, task) => ({
            id: `e2e-task-${index}-${task}`,
            title: `示例任务 ${index}-${task}`,
            status: 'open' as const,
            children: [],
          })),
        },
        {
          key: 'urgent',
          children: Array.from({ length: 3 }, (_, task) => ({
            id: `e2e-urgent-${index}-${task}`,
            title: `紧急示例 ${index}-${task}`,
            status: 'open' as const,
            children: [],
          })),
        },
      ],
    })
  }
  return { version: 1, header: ['E2E 临时数据'], weeks }
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
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
}

/** 等进程退出；超时返回 false，交由调用方决定是否升级信号 */
function waitExit(child: ChildProcess, timeoutMs: number): Promise<boolean> {
  if (child.exitCode !== null || child.signalCode) return Promise.resolve(true)
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), timeoutMs)
    child.once('exit', () => {
      clearTimeout(timer)
      resolve(true)
    })
  })
}

/** 先 SIGTERM，超时升级 SIGKILL；确认退出后才允许删除临时目录 */
async function stopServer(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode) return
  child.kill('SIGTERM')
  if (await waitExit(child, 2_000)) return
  child.kill('SIGKILL')
  await waitExit(child, 2_000)
}

async function waitServer(
  child: ChildProcess,
  base: string,
  spawnError: { error: Error | null },
): Promise<void> {
  const deadline = Date.now() + 30_000
  while (Date.now() < deadline) {
    if (spawnError.error) throw spawnError.error
    if (child.exitCode !== null || child.signalCode) throw new Error('E2E 服务启动即退出')
    try {
      const response = await fetch(`${base}/api/doc`)
      if (response.ok) return
    } catch {
      // 还没起来
    }
    await new Promise((resolve) => setTimeout(resolve, 150))
  }
  throw new Error('E2E 服务未在期限内就绪')
}

let workDir: string | null = null
const read = (): QuestDoc => {
  if (!workDir) throw new Error('临时数据目录尚未建立')
  return JSON.parse(readFileSync(join(workDir, 'quests.json'), 'utf8')) as QuestDoc
}


function walk(quests: Quest[], out: Quest[] = []): Quest[] {
  for (const quest of quests) {
    out.push(quest)
    walk(quest.children, out)
  }
  return out
}

function allQuests(doc: QuestDoc): Quest[] {
  return doc.weeks.flatMap((week) => week.quadrants.flatMap((quadrant) => walk(quadrant.children)))
}

function find(doc: QuestDoc, part: string): Quest | undefined {
  return allQuests(doc).find((quest) => quest.title.includes(part))
}

/** 等待数据文件达到预期状态：撤销/保存是异步落盘的，固定 sleep 会偶发读到旧文件 */
async function waitData(
  predicate: (doc: QuestDoc) => boolean,
  label: string,
  timeoutMs = 8_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (predicate(read())) return
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  throw new Error(`数据未在期限内达到预期状态：${label}`)
}

let browser: Browser | null = null
let server: ChildProcess | null = null
const errors: string[] = []
try {
  // 首次运行：没有数据文件时，服务应创建合法空文档并能建出本周
  const freshDir = mkdtempSync(join(tmpdir(), 'questory-e2e-fresh-'))
  const freshPort = await freePort()
  const freshBase = `http://127.0.0.1:${freshPort}`
  const freshError: { error: Error | null } = { error: null }
  const freshServer = spawn(join(ROOT, 'node_modules', '.bin', 'tsx'), ['server/index.ts'], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(freshPort), QUESTORY_DATA_DIR: freshDir, QUESTORY_DISABLE_HMR: '1' },
    stdio: 'ignore',
  })
  freshServer.on('error', (error) => {
    freshError.error = error
  })
  try {
    await waitServer(freshServer, freshBase, freshError)
    const emptyDoc = (await (await fetch(`${freshBase}/api/doc`)).json()) as QuestDoc
    assert.equal(emptyDoc.version, 1, '首次运行的数据版本应为 1')
    assert.deepEqual(emptyDoc.weeks, [], '首次运行应从空文档开始')
    assert.ok(existsSync(join(freshDir, 'quests.json')), '首次启动应创建数据文件')
    const response = await fetch(`${freshBase}/api/rollover`, { method: 'POST' })
    assert.equal(response.status, 200, '首次运行应能建立本周')
    const payload = (await response.json()) as {
      doc: QuestDoc
      rollover: { created: boolean }
    }
    assert.equal(payload.rollover.created, true, '首次运行应自动建立本周')
    assert.equal(payload.doc.weeks.length, 1, '首次运行后应有一周')
  } finally {
    await stopServer(freshServer)
    rmSync(freshDir, { recursive: true, force: true })
  }

  workDir = mkdtempSync(join(tmpdir(), 'questory-e2e-'))
  mkdirSync(join(workDir, 'backups'), { recursive: true })
  writeFileSync(join(workDir, 'quests.json'), `${JSON.stringify(seedDoc(), null, 2)}\n`, 'utf8')

  const port = await freePort()
  const BASE = `http://127.0.0.1:${port}`
  const spawnError: { error: Error | null } = { error: null }
  server = spawn(join(ROOT, 'node_modules', '.bin', 'tsx'), ['server/index.ts'], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(port), QUESTORY_DATA_DIR: workDir, QUESTORY_DISABLE_HMR: '1' },
    stdio: 'ignore',
  })
  server.on('error', (error) => {
    spawnError.error = error
  })

  await waitServer(server, BASE, spawnError)
  browser = await chromium.launch()
  const page = await browser.newPage({ viewport: { width: 1028, height: 1100 } })
  // 只收集应用自身错误：dev server 的 HMR 连接失败属于测试环境噪音
  const isNoise = (message: string) => /WebSocket|\[vite\]|HMR/i.test(message)
  page.on('pageerror', (error) => {
    if (!isNoise(error.message)) errors.push(error.message)
  })

  await page.goto(BASE, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('textarea.quest-title')

  // 空象限添加：先记录已有 id，用增量找出新建的那条，后续步骤都以它为素材
  const idsBefore = new Set(allQuests(read()).map((quest) => quest.id))
  await page.locator('section[data-quadrant="urgent"] > h3 .quest-add.is-current-week').first().click()
  await page.waitForTimeout(1_400)
  const created = allQuests(read()).find((quest) => !idsBefore.has(quest.id))
  assert.ok(created, '空象限的「+ 添加任务」应建出象限并加一条')
  assert.equal(created.title, '', '新建任务标题应为空')
  assert.equal(created.status, 'open', '新建叶子应为未完成')

  // 改标题
  const row = page.locator(`li[data-quest-id="${created.id}"]`)
  const title = row.locator(':scope > p > textarea.quest-title').first()
  await title.click()
  await title.type('E2E 标题')
  await page.waitForTimeout(1_400)
  assert.ok(find(read(), 'E2E 标题'), '标题修改应保存到 data/quests.json')

  await title.press('Enter')
  await page.waitForTimeout(400)
  await page.keyboard.type('E2E 子任务')
  await page.waitForTimeout(1_400)
  const child = find(read(), 'E2E 子任务')
  assert.ok(child, 'Enter 应新增一条任务')

  await page.keyboard.press('Tab')
  await page.waitForTimeout(1_400)
  const parent = find(read(), 'E2E 标题')
  assert.ok(parent, '缩进后父任务应仍在')
  assert.ok(parent?.children?.some((quest) => quest.id === child.id), 'Tab 应把这条件缩进为子任务')
  assert.equal(parent?.status, undefined, '叶子变父任务后不应残留 status（否则写盘校验会拒绝）')

  const childRow = page.locator(`li[data-quest-id="${child.id}"]`)
  await childRow.locator('.quest-check').click()
  await page.waitForTimeout(1_400)
  assert.equal(find(read(), 'E2E 子任务')?.status, 'done', '勾选应保存为完成')

  await childRow.locator('.quest-move').click()
  await page.getByRole('menuitem', { name: '添加备注' }).click()
  await childRow.locator('textarea.note-field').fill('E2E 备注')
  await page.waitForTimeout(1_400)
  assert.equal(find(read(), 'E2E 子任务')?.note, 'E2E 备注', '备注应保存')

  // 备注是条件渲染的：窗口变窄后长备注也不能被裁掉（观察器要挂在后出现的元素上）
  const taskNoteField = childRow.locator('textarea.note-field')
  await taskNoteField.fill('很长的备注'.repeat(20))
  await page.waitForTimeout(1_400)
  await page.setViewportSize({ width: 420, height: 900 })
  await page.waitForTimeout(500)
  const noteBox = (await page.evaluate(`(() => {
    const el = document.querySelector('textarea.note-field')
    return el ? { scroll: el.scrollHeight, client: el.clientHeight } : null
  })()`)) as { scroll: number; client: number } | null
  assert.ok(noteBox, '应能读到备注输入框尺寸')
  assert.ok(
    noteBox.scroll <= noteBox.client + 2,
    `窄窗口下备注不应被裁切（scrollHeight ${noteBox.scroll} > clientHeight ${noteBox.client}）`,
  )
  await page.setViewportSize({ width: 1028, height: 1100 })
  await taskNoteField.fill('E2E 备注')
  await page.waitForTimeout(1_400)

  await childRow.locator('.quest-move').click()
  await page.getByRole('menuitem', { name: '删除整条' }).click()
  await waitData((doc) => !find(doc, 'E2E 子任务'), '删除落盘')
  assert.equal(await page.locator('.quest-undo-toast').count(), 1, '删除后应出现可撤销提示')
  await page.getByRole('button', { name: '撤销' }).click()
  await waitData((doc) => find(doc, 'E2E 子任务') !== undefined, '撤销恢复任务')
  const focusAfterUndo = await page.evaluate(`(() => {
    const el = document.activeElement
    return el ? el.closest('li')?.getAttribute('data-quest-id') ?? null : null
  })()`)
  assert.equal(focusAfterUndo, child.id, '撤销后焦点应回到被恢复的任务')

  // 删除提示只是提示：做别的编辑后应自动收起（撤销统一走历史栈）
  await childRow.locator('.quest-move').click()
  await page.getByRole('menuitem', { name: '删除整条' }).click()
  await waitData((doc) => !find(doc, 'E2E 子任务'), '删除落盘')
  const otherTitle = page.locator('li[data-quest-id] textarea.quest-title').first()
  const beforeTitle = await otherTitle.inputValue()
  await otherTitle.click()
  // 长标题在窄视口会折行，End 只到当前显示行末尾，必须用 Control+End 到全文末尾
  await otherTitle.press('Control+End')
  await otherTitle.type(' Z')
  await waitData((doc) => find(doc, beforeTitle + ' Z') !== undefined, '文字落盘')
  assert.equal(await page.locator('.quest-undo-toast').count(), 0, '其它编辑后删除提示应收起')
  await page.keyboard.press('Control+z')
  await waitData((doc) => find(doc, beforeTitle + ' Z') === undefined, '第一次撤销回退文字')
  assert.equal(find(read(), 'E2E 子任务'), undefined, '第一次撤销只回退文字，任务仍处于删除状态')
  await page.keyboard.press('Control+z')
  await waitData((doc) => find(doc, 'E2E 子任务') !== undefined, '再撤销恢复被删任务')

  // 空行 Backspace：删除该行并给出可撤销提示，焦点落到别的行
  const idsBeforeBlank = new Set(allQuests(read()).map((quest) => quest.id))
  await page.locator('section[data-quadrant="urgent"] > h3 .quest-add.is-current-week').first().click()
  await page.waitForTimeout(1_400)
  const blank = allQuests(read()).find((quest) => !idsBeforeBlank.has(quest.id))
  assert.ok(blank, '应新建一条空任务')
  await page.keyboard.press('Backspace')
  await page.waitForTimeout(1_400)
  assert.equal(
    allQuests(read()).some((quest) => quest.id === blank.id),
    false,
    '空行 Backspace 应删除该行',
  )
  assert.equal(await page.locator('.quest-undo-toast').count(), 1, '空行删除应给可撤销提示')

  // 撤销只有一套：输入文字后新增一行，Ctrl+Z 应先撤销这一行，而不是回退文字
  const undoTitle = page.locator(`li[data-quest-id="${parent.id}"] textarea.quest-title`).first()
  await undoTitle.click()
  await undoTitle.press('End')
  await undoTitle.type(' 补充')
  await page.waitForTimeout(1_400)
  const rowsBeforeUndo = allQuests(read()).length
  await undoTitle.press('Enter')
  await page.waitForTimeout(1_200)
  assert.equal(allQuests(read()).length, rowsBeforeUndo + 1, 'Enter 应新增一行')
  await page.keyboard.press('Control+z')
  await page.waitForTimeout(1_200)
  assert.equal(allQuests(read()).length, rowsBeforeUndo, 'Ctrl+Z 应先撤销新增的行')
  assert.ok(find(read(), 'E2E 标题 补充'), '撤销新增行时不应回退已输入的文字')
  await page.keyboard.press('Control+z')
  await page.waitForTimeout(1_200)
  assert.ok(
    find(read(), 'E2E 标题') && !find(read(), 'E2E 标题 补充'),
    '再撤销一次才回退文字',
  )

  // 重做：Ctrl+Y 与 Ctrl+Shift+Z 走同一套快照栈
  await page.keyboard.press('Control+y')
  await page.waitForTimeout(1_200)
  assert.ok(find(read(), 'E2E 标题 补充'), 'Ctrl+Y 应重做回退的文字')
  await page.keyboard.press('Control+z')
  await page.waitForTimeout(1_200)
  await page.keyboard.press('Control+Shift+z')
  await page.waitForTimeout(1_200)
  assert.ok(find(read(), 'E2E 标题 补充'), 'Ctrl+Shift+Z 应重做回退的文字')

  // 周标题/周备注：备注可编辑；解析不了的标签不提交（不依赖具体周，取最后一个普通周）
  const week = read().weeks.filter((item) => item.kind === 'normal').at(-1)!
  const weekId = week.id
  const weekHead = page.locator(`.tree h2[data-week-id="${weekId}"]`)
  const noteField = weekHead.locator('textarea.week-note')
  await noteField.fill('周备注 E2E')
  await noteField.blur()
  await page.waitForTimeout(1_400)
  assert.equal(
    read().weeks.find((item) => item.id === weekId)?.note,
    '周备注 E2E',
    '周备注应保存',
  )
  const labelField = weekHead.locator('textarea.week-label')
  await labelField.fill('随便写的')
  await labelField.press('Enter')
  await page.waitForTimeout(600)
  assert.equal(
    read().weeks.find((item) => item.id === weekId)?.label,
    week.label,
    '解析不了的周标签不应提交',
  )

  // 假期选项：悬停周标题出现，标记后 kind 落盘，取消后还原
  const kindToggle = weekHead.locator('button.week-kind-toggle')
  await weekHead.hover()
  await kindToggle.click()
  await page.waitForTimeout(1_400)
  assert.equal(read().weeks.find((week) => week.id === weekId)?.kind, 'holiday', '设为假期应落盘')
  await weekHead.hover()
  await kindToggle.click()
  await page.waitForTimeout(1_400)
  assert.equal(read().weeks.find((week) => week.id === weekId)?.kind, 'normal', '取消假期应还原')

  // 只给周标题加首尾空格也算草稿：Ctrl+Z 应先撤草稿，而不是撤销文档里的其它改动
  const whitespaceTitle = page.locator('li[data-quest-id] textarea.quest-title').first()
  const whitespaceBase = await whitespaceTitle.inputValue()
  await whitespaceTitle.click()
  await whitespaceTitle.press('Control+End')
  await whitespaceTitle.type(' X')
  await page.waitForTimeout(1_400)
  await labelField.click()
  await labelField.press('Control+End')
  await labelField.type(' ')
  await page.keyboard.press('Control+z')
  await page.waitForTimeout(400)
  assert.equal(await labelField.inputValue(), week.label, '只改空格的草稿也应先被撤掉')
  assert.ok(
    allQuests(read()).some((quest) => quest.title === `${whitespaceBase} X`),
    '撤草稿不应撤销文档里的其它改动',
  )

  // 周标题草稿：Ctrl+Z 先撤草稿，不误伤文档里其它改动
  await page.waitForTimeout(1_400)
  await labelField.click()
  await labelField.press('Control+End')
  await labelField.type('草稿')
  const docBeforeDraftUndo = JSON.stringify(read())
  await page.keyboard.press('Control+z')
  // 等到超过自动保存的防抖窗口：如果草稿被误提交，这里能读出来
  await page.waitForTimeout(1_400)
  assert.equal(await labelField.inputValue(), week.label, 'Ctrl+Z 应先撤回周标题草稿')
  assert.equal(JSON.stringify(read()), docBeforeDraftUndo, '撤草稿不应改动已保存的数据')

  // 草稿态 Ctrl+S：先提交草稿，再立即保存（不等 700ms 防抖）
  const fastLabel = '2025 1.5-1.11'
  await labelField.fill(fastLabel)
  await page.keyboard.press('Control+s')
  await page.waitForTimeout(400)
  assert.equal(
    read().weeks.find((item) => item.id === weekId)?.label,
    fastLabel,
    'Ctrl+S 应先提交周标题草稿再立即保存',
  )
  assert.match((await page.locator('.page-save').first().textContent()) ?? '', /已保存/)
  await labelField.press('Escape')

  // 窗口变窄后长标题不应被裁掉
  const longTitle = page.locator('textarea.quest-title').first()
  await longTitle.click()
  await longTitle.press('Control+End')
  await longTitle.type(' 很长的标题'.repeat(12))
  await page.waitForTimeout(1_400)
  await page.setViewportSize({ width: 420, height: 900 })
  await page.waitForTimeout(500)
  const titleBox = (await page.evaluate(`(() => {
    const el = document.querySelector('textarea.quest-title')
    return el ? { scroll: el.scrollHeight, client: el.clientHeight } : null
  })()`)) as { scroll: number; client: number } | null
  assert.ok(titleBox, '应能读到标题输入框尺寸')
  assert.ok(
    titleBox.scroll <= titleBox.client + 2,
    `窄窗口下标题不应被裁切（scrollHeight ${titleBox.scroll} > clientHeight ${titleBox.client}）`,
  )
  await page.setViewportSize({ width: 1028, height: 1100 })

  // 父任务的菜单应贴着自己的行，而不是被推到整棵子树底部
  const parentQuest = allQuests(read()).find((quest) => quest.children.length > 0)
  assert.ok(parentQuest, '应存在带子任务的任务')
  const parentRow = page.locator(`li[data-quest-id="${parentQuest.id}"]`)
  const parentMenuBtn = parentRow.locator(':scope > p .quest-move').first()
  await parentMenuBtn.click()
  const menuBox = await parentRow.locator(':scope > div.quest-menu').boundingBox()
  const btnBox = await parentMenuBtn.boundingBox()
  assert.ok(menuBox && btnBox, '菜单应可见')
  assert.ok(
    menuBox.y - (btnBox.y + btnBox.height) < 30,
    `父任务菜单应贴着自己的行（间距 ${menuBox.y - (btnBox.y + btnBox.height)}px）`,
  )
  await parentRow.locator(':scope > p textarea.quest-title').first().click()

  await page.keyboard.press('Control+s')
  await page.waitForTimeout(600)
  assert.match((await page.locator('.page-save').first().textContent()) ?? '', /已保存/)

  // 周跳转：日历格子点击后目标周标题应贴到视口顶，面板关闭
  const jumpWeek = read().weeks[5]
  await page.click('.week-jump-trigger')
  await page.locator(`.week-jump-chip[title="${jumpWeek.label}"]`).click()
  await page.waitForFunction(
    `(() => {
      const head = document.querySelector('.tree h2[data-week-id="${jumpWeek.id}"]')
      return head ? Math.abs(head.getBoundingClientRect().top) <= 2 : false
    })()`,
    undefined,
    { timeout: 5_000 },
  )
  assert.equal(await page.locator('.week-jump-panel').count(), 0, '跳转后弹层应关闭')

  // 输入即筛 + Enter 跳到第一条匹配
  await page.click('.week-jump-trigger')
  await page.fill('.week-jump-input', '3.16')
  assert.ok((await page.locator('.week-jump-item').count()) >= 1, '输入应筛出匹配的周')
  await page.keyboard.press('Enter')
  await page.waitForTimeout(1_200)
  assert.equal(await page.locator('.week-jump-panel').count(), 0, 'Enter 跳转后弹层应关闭')

  // 回到顶部：滚过一屏后出现，点击回顶并自行消失
  await page.evaluate(`window.scrollTo(0, 2500)`)
  await page.waitForSelector('.back-to-top', { state: 'visible' })
  await page.click('.back-to-top')
  await page.waitForFunction(`window.scrollY === 0`, undefined, { timeout: 5_000 })
  await page.waitForTimeout(300)
  assert.equal(await page.locator('.back-to-top').count(), 0, '回到顶部后按钮应消失')

  assert.deepEqual(errors, [], '页面不应有运行时错误')
  console.log('e2e: 标题/Enter/Tab/勾选/备注/周标题备注/删除撤销/保存/周跳转/回到顶部 全部通过')
} finally {
  // 服务启动超时、浏览器崩溃、spawn 失败等路径也走这里：先确认进程退出，再删临时目录
  await browser?.close().catch(() => undefined)
  if (server) await stopServer(server).catch(() => undefined)
  if (workDir) rmSync(workDir, { recursive: true, force: true })
}
