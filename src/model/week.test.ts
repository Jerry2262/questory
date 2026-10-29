import { describe, expect, it } from 'vitest'

import { currentWeekOf, ensureCurrentWeek, parseWeekLabel, weekRange } from './week'
import type { Quest, QuestDoc, QuestStatus, Week } from './types'

const leaf = (id: string, status: QuestStatus, title = id): Quest => ({
  id,
  title,
  status,
  children: [],
})

const parent = (id: string, quests: Quest[], title = id): Quest => ({
  id,
  title,
  children: quests,
})

const makeWeek = (label: string, quests: Quest[], extra: Partial<Week> = {}): Week => ({
  id: `week-${label}`,
  label,
  kind: 'normal',
  quadrants: [{ key: 'urgent-important', children: quests }],
  ...extra,
})

const reviewWeek = (label: string, review = '这周的经验'): Week => ({
  id: `week-${label}`,
  label,
  kind: 'normal',
  review,
  quadrants: [{ key: 'urgent-important', children: [] }],
})

const makeDoc = (...weeks: Week[]): QuestDoc => ({ version: 1, header: ['页头'], weeks })

const allIds = (doc: QuestDoc): string[] => {
  const ids: string[] = []
  const walk = (quests: Quest[]) => {
    for (const quest of quests) {
      ids.push(quest.id)
      walk(quest.children)
    }
  }
  for (const week of doc.weeks) for (const quadrant of week.quadrants) walk(quadrant.children)
  return ids
}

describe('周计算', () => {
  it('按 Asia/Shanghai 的周一切周', () => {
    expect(weekRange(new Date('2026-10-25T16:30:00Z')).label).toBe('2026 10.26-11.1')
    expect(weekRange(new Date('2026-10-28T12:00:00+08:00')).label).toBe('2026 10.26-11.1')
    expect(weekRange(new Date('2026-11-01T23:59:00+08:00')).label).toBe('2026 10.26-11.1')
  })

  it('跨年周用起始年份', () => {
    expect(weekRange(new Date('2025-12-31T12:00:00+08:00')).label).toBe('2025 12.29-1.4')
  })

  it('能解析旧数据里的周标签，包括合并的长周和跨年', () => {
    const merged = parseWeekLabel('2026 9.28-10.25')
    expect(merged?.start.toISOString().slice(0, 10)).toBe('2026-09-28')
    expect(merged?.end.toISOString().slice(0, 10)).toBe('2026-10-25')

    const cross = parseWeekLabel('2025 12.29-1.4')
    expect(cross?.end.toISOString().slice(0, 10)).toBe('2026-01-04')

    expect(parseWeekLabel('假期')).toBeNull()
  })
})

describe('周继承', () => {
  it('本周已存在时原样返回', () => {
    const doc = makeDoc(makeWeek('2026 10.26-11.1', [leaf('a', 'open')]))
    const result = ensureCurrentWeek(doc, new Date('2026-10-26T09:00:00+08:00'))
    expect(result.info.created).toBe(false)
    expect(result.doc).toBe(doc)
  })

  it('本周缺失时从上一个填过的周全量继承', () => {
    const source = makeWeek('2026 10.19-10.25', [
      parent('p', [leaf('c1', 'done'), leaf('c2', 'open')], '父任务'),
      leaf('v', 'void', '作废的'),
      { id: 'n', title: '有备注的', status: 'done', note: '备注', children: [] },
    ])
    const result = ensureCurrentWeek(makeDoc(source), new Date('2026-11-02T09:00:00+08:00'))
    const created = result.doc.weeks[0]

    expect(result.info).toMatchObject({
      created: true,
      source: '2026 10.19-10.25',
      inherited: 5,
    })
    expect(created.label).toBe('2026 11.2-11.8')
    expect(created.quadrants[0].children).toHaveLength(3)
    expect(created.quadrants[0].children[0].title).toBe('父任务')
    expect(created.quadrants[0].children[0]).not.toHaveProperty('status')
    expect(created.quadrants[0].children[0].children.map((q) => q.status)).toEqual(['done', 'open'])
    expect(created.quadrants[0].children[1].status).toBe('void')
    expect(created.quadrants[0].children[2].note).toBe('备注')
    expect(result.doc.header).toEqual(['页头'])
    expect(result.doc.weeks).toHaveLength(2)
  })

  it('继承出来的任务有新且唯一的 id', () => {
    const doc = makeDoc(makeWeek('2026 10.19-10.25', [leaf('a', 'open'), leaf('b', 'done')]))
    const result = ensureCurrentWeek(doc, new Date('2026-11-02T09:00:00+08:00'))
    const ids = allIds(result.doc)
    expect(new Set(ids).size).toBe(ids.length)
    expect(result.doc.weeks[0].quadrants[0].children.map((q) => q.id)).not.toContain('a')
  })

  it('自动建出的周被改名后重新继承，不会复用周或任务的 id', () => {
    const first = ensureCurrentWeek(
      makeDoc(makeWeek('2026 10.19-10.25', [leaf('a', 'open'), leaf('b', 'done')])),
      new Date('2026-10-28T09:00:00+08:00'),
    )
    const autoWeek = first.doc.weeks[0]
    // 用户把这周改名成过去的区间：id 不变，label 变了
    const renamed: Week = { ...autoWeek, label: '2026 9.28-10.4' }
    const doc: QuestDoc = { ...first.doc, weeks: [renamed, ...first.doc.weeks.slice(1)] }

    const second = ensureCurrentWeek(doc, new Date('2026-10-29T09:00:00+08:00'))
    expect(second.info.created).toBe(true)
    const created = second.doc.weeks[0]
    expect(created.id).not.toBe(renamed.id)
    const ids = [...second.doc.weeks.map((week) => week.id), ...allIds(second.doc)]
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('中间隔了多周也只生成本周，不补空周', () => {
    const doc = makeDoc(makeWeek('2026 10.19-10.25', [leaf('a', 'open')]))
    const result = ensureCurrentWeek(doc, new Date('2026-11-16T09:00:00+08:00'))
    expect(result.doc.weeks).toHaveLength(2)
    expect(result.doc.weeks[0].label).toBe('2026 11.16-11.22')
    expect(result.doc.weeks[1].label).toBe('2026 10.19-10.25')
  })

  it('假期周不作为继承源', () => {
    const doc = makeDoc(
      makeWeek('2026 10.26-11.1', [leaf('a', 'open')], { kind: 'holiday' }),
      makeWeek('2026 10.19-10.25', [leaf('b', 'done')]),
    )
    const result = ensureCurrentWeek(doc, new Date('2026-11-02T09:00:00+08:00'))
    expect(result.info).toMatchObject({
      created: true,
      source: '2026 10.19-10.25',
      skippedHolidays: 1,
      inherited: 1,
    })
    expect(result.doc.weeks[0].quadrants[0].children[0].status).toBe('done')
  })

  it('上一周只写了复盘时继承为空，不翻更早的旧账', () => {
    const doc = makeDoc(
      reviewWeek('2026 10.26-11.1'),
      makeWeek('2026 10.19-10.25', [leaf('a', 'open')]),
    )
    const result = ensureCurrentWeek(doc, new Date('2026-11-02T09:00:00+08:00'))
    expect(result.info.source).toBe('2026 10.26-11.1')
    expect(result.info.inherited).toBe(0)
    expect(result.doc.weeks[0].quadrants).toHaveLength(0)
  })

  it('合并的长周覆盖今天时不新建', () => {
    const doc = makeDoc(makeWeek('2026 9.28-10.25', [leaf('a', 'open')]))
    const result = ensureCurrentWeek(doc, new Date('2026-10-20T09:00:00+08:00'))
    expect(result.info.created).toBe(false)
    expect(result.doc.weeks).toHaveLength(1)
  })

  it('重复调用不会重复建周', () => {
    const doc = makeDoc(makeWeek('2026 10.19-10.25', [leaf('a', 'open')]))
    const first = ensureCurrentWeek(doc, new Date('2026-11-02T09:00:00+08:00'))
    const second = ensureCurrentWeek(first.doc, new Date('2026-11-02T09:00:00+08:00'))
    expect(second.info.created).toBe(false)
    expect(second.doc.weeks).toHaveLength(2)
    expect(second.doc.weeks[0].label).toBe('2026 11.2-11.8')
  })

  it('没有任何周时也建出本周', () => {
    const result = ensureCurrentWeek(makeDoc(), new Date('2026-11-02T09:00:00+08:00'))
    expect(result.info).toMatchObject({ created: true, source: null, inherited: 0 })
    expect(result.doc.weeks[0].label).toBe('2026 11.2-11.8')
  })

  it('已有未来周时不把本周插到最前面', () => {
    const doc = makeDoc(makeWeek('2026 11.9-11.15', [leaf('a', 'open')]))
    const result = ensureCurrentWeek(doc, new Date('2026-10-26T09:00:00+08:00'))
    expect(result.info.created).toBe(false)
    expect(result.doc).toBe(doc)
  })

  it('currentWeekOf 能找到覆盖今天的周，包括合并长周', () => {
    const doc = makeDoc(makeWeek('2026 9.28-10.25', [leaf('a', 'open')]))
    expect(currentWeekOf(doc, new Date('2026-10-20T09:00:00+08:00'))?.label).toBe('2026 9.28-10.25')
    expect(currentWeekOf(doc, new Date('2026-10-26T09:00:00+08:00'))).toBeNull()
  })

  it('父任务的显式作废覆盖会继承，子任务状态不变', () => {
    const source = parent('p', [leaf('a', 'open'), leaf('b', 'done')])
    source.voided = true
    const doc = makeDoc(makeWeek('2026 10.26-11.1', [source]))
    const result = ensureCurrentWeek(doc, new Date('2026-11-03T09:00:00+08:00'))
    const inherited = result.doc.weeks[0].quadrants[0].children[0]

    expect(inherited.voided).toBe(true)
    expect(inherited.children.map((quest) => quest.status)).toEqual(['open', 'done'])
  })

  it('复盘不继承', () => {
    const source = makeWeek('2026 10.19-10.25', [leaf('a', 'open')])
    source.review = '上周的经验'
    const result = ensureCurrentWeek(makeDoc(source), new Date('2026-11-02T09:00:00+08:00'))
    expect(result.doc.weeks[0].review).toBeUndefined()
  })
})
