import { existsSync, readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

import type { QuestDoc } from './types'
import { validateQuestDoc } from './validate'

/** 真实数据不进仓库：本地存在时顺手校验一遍，全新 clone 上跳过 */
const LIVE_DATA = new URL('../../data/quests.json', import.meta.url)
const liveDoc: QuestDoc | null = existsSync(LIVE_DATA)
  ? (JSON.parse(readFileSync(LIVE_DATA, 'utf8')) as QuestDoc)
  : null

const makeDoc = (): QuestDoc => ({
  version: 1,
  header: ['待办清单'],
  weeks: [
    {
      id: 'w-1',
      label: '2026 10.26-11.1',
      kind: 'normal',
      quadrants: [
        {
          key: 'urgent-important',
          children: [{ id: 'q-1', title: '任务', status: 'open', children: [] }],
        },
      ],
    },
  ],
})

describe('validateQuestDoc', () => {
  it.skipIf(!liveDoc)('本地的 data/quests.json 通过', () => {
    expect(validateQuestDoc(liveDoc as QuestDoc)).toEqual([])
  })

  it('版本、页头、周数组的形状', () => {
    const doc = makeDoc() as unknown as Record<string, unknown>
    doc.version = 2
    doc.header = ['ok', 1]
    doc.weeks = {}
    expect(validateQuestDoc(doc)).toEqual([
      { path: 'version', message: '必须是 1' },
      { path: 'header', message: '必须是字符串数组' },
      { path: 'weeks', message: '必须是数组' },
    ])
  })

  it('任务 id 全局唯一', () => {
    const doc = makeDoc()
    doc.weeks[0].quadrants[0].children.push({
      id: 'q-1',
      title: '重复',
      status: 'open',
      children: [],
    })
    expect(validateQuestDoc(doc)).toContainEqual({
      path: 'weeks[0].quadrants[0].children[1].id',
      message: '任务 id 重复',
    })
  })

  it('父任务不能存 status', () => {
    const doc = makeDoc()
    doc.weeks[0].quadrants[0].children = [
      {
        id: 'p',
        title: '父',
        status: 'open',
        children: [{ id: 'c', title: '子', status: 'done', children: [] }],
      },
    ]
    expect(validateQuestDoc(doc)).toContainEqual({
      path: 'weeks[0].quadrants[0].children[0].status',
      message: '父任务不存 status，状态由子任务推导',
    })
  })

  it('父任务可以带 voided；叶子不行；类型必须是布尔', () => {
    const doc = makeDoc()
    doc.weeks[0].quadrants[0].children = [
      {
        id: 'p',
        title: '父',
        voided: true,
        children: [{ id: 'c', title: '子', status: 'done', children: [] }],
      },
    ]
    expect(validateQuestDoc(doc)).toEqual([])

    doc.weeks[0].quadrants[0].children[0].voided = 'yes' as never
    expect(validateQuestDoc(doc)).toContainEqual({
      path: 'weeks[0].quadrants[0].children[0].voided',
      message: '必须是布尔值',
    })

    const leafDoc = makeDoc()
    leafDoc.weeks[0].quadrants[0].children[0].voided = true
    expect(validateQuestDoc(leafDoc)).toContainEqual({
      path: 'weeks[0].quadrants[0].children[0].voided',
      message: '叶子任务不能有 voided，用 status 表示状态',
    })
  })

  it('叶子状态只允许三态；缺省按未完成处理', () => {
    const doc = makeDoc()
    doc.weeks[0].quadrants[0].children[0].status = 'doing' as never
    expect(validateQuestDoc(doc)).toContainEqual({
      path: 'weeks[0].quadrants[0].children[0].status',
      message: '必须是 open / done / void',
    })

    delete doc.weeks[0].quadrants[0].children[0].status
    expect(validateQuestDoc(doc)).toEqual([])
  })

  it('周级总结必须是字符串', () => {
    const doc = makeDoc()
    doc.weeks[0].review = 42 as never
    expect(validateQuestDoc(doc)).toContainEqual({
      path: 'weeks[0].review',
      message: '必须是字符串',
    })
    doc.weeks[0].review = '总结'
    expect(validateQuestDoc(doc)).toEqual([])
  })

  it('象限 key 合法且同一周不重复', () => {
    const doc = makeDoc()
    doc.weeks[0].quadrants[0].key = 'nope' as never
    doc.weeks[0].quadrants.push({
      key: 'nope' as never,
      children: [],
    })
    const issues = validateQuestDoc(doc)
    expect(issues).toContainEqual({
      path: 'weeks[0].quadrants[0].key',
      message: '必须是 urgent-important / important / urgent / neither 之一',
    })
    expect(issues).toContainEqual({
      path: 'weeks[0].quadrants[1].key',
      message: '必须是 urgent-important / important / urgent / neither 之一',
    })

    const dup = makeDoc()
    dup.weeks[0].quadrants.push({ key: 'urgent-important', children: [] })
    expect(validateQuestDoc(dup)).toContainEqual({
      path: 'weeks[0].quadrants[1].key',
      message: '同一周内象限重复',
    })
  })

  it('周标签唯一，普通周必须能解析，假期周可以例外', () => {
    const doc = makeDoc()
    doc.weeks.push({ ...structuredClone(doc.weeks[0]), id: 'w-2' })
    expect(validateQuestDoc(doc)).toContainEqual({
      path: 'weeks[1].label',
      message: '周标签重复',
    })

    const bad = makeDoc()
    bad.weeks[0].label = '假期'
    expect(validateQuestDoc(bad)).toContainEqual({
      path: 'weeks[0].label',
      message: '普通周的标签无法解析',
    })

    bad.weeks[0].kind = 'holiday'
    expect(validateQuestDoc(bad)).toEqual([])
  })

  it('周 id 重复、备注/复盘类型、空标题', () => {
    const doc = makeDoc()
    doc.weeks.push({ ...structuredClone(doc.weeks[0]), label: '2026 11.2-11.8' })
    expect(validateQuestDoc(doc)).toContainEqual({
      path: 'weeks[1].id',
      message: '周 id 重复',
    })

    const doc2 = makeDoc()
    doc2.weeks[0].note = 1 as never
    doc2.weeks[0].review = 1 as never
    doc2.weeks[0].quadrants[0].children[0].title = ''
    expect(validateQuestDoc(doc2)).toEqual([
      { path: 'weeks[0].note', message: '必须是字符串' },
      { path: 'weeks[0].review', message: '必须是字符串' },
    ])
  })
})
