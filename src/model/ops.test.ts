import { describe, expect, it } from 'vitest'
import { progressOf, statusOf } from './derive'
import {
  addSibling,
  addTask,
  deleteTask,
  findQuadrant,
  findQuest,
  findWeek,
  indentTask,
  moveTask,
  outdentTask,
  setHeader,
  setNote,
  setWeekLabel,
  setReview,
  setTitle,
  setVoid,
  setWeekKind,
  setWeekNote,
  toggleStatus,
} from './ops'
import { validateQuestDoc } from './validate'
import { countQuests } from './week'
import type { QuestDoc } from './types'

function makeDoc(): QuestDoc {
  return {
    version: 1,
    header: ['待办清单'],
    weeks: [
      {
        id: 'w2',
        label: '2026 10.26-11.1',
        kind: 'normal',
        review: '经验',
        quadrants: [
          {
            key: 'urgent-important',
            children: [
              {
                id: 'a',
                title: 'A',
                children: [
                  { id: 'a1', title: 'A1', status: 'open', note: 'n', children: [] },
                  { id: 'a2', title: 'A2', status: 'done', children: [] },
                ],
              },
              { id: 'b', title: 'B', status: 'open', children: [] },
            ],
          },
          { key: 'important', children: [] },
          { key: 'urgent', children: [] },
          { key: 'neither', children: [] },
        ],
      },
      { id: 'w1', label: '2026 10.19-10.25', kind: 'normal', quadrants: [] },
    ],
  }
}

function checked(doc: QuestDoc): void {
  expect(validateQuestDoc(doc)).toEqual([])
}

describe('setWeekLabel', () => {
  it('重命名后 id 不变，数据合法', () => {
    const doc = makeDoc()
    const result = setWeekLabel(doc, 'w2', '2026 10.27-11.2')
    expect(result).not.toBeNull()
    const week = findWeek(result!.doc, 'w2')!
    expect(week.label).toBe('2026 10.27-11.2')
    expect(week.id).toBe('w2')
    checked(result!.doc)
  })

  it('普通周拒绝解析不了的标签且不改输入', () => {
    const doc = makeDoc()
    const snapshot = JSON.stringify(doc)
    expect(setWeekLabel(doc, 'w2', '随便写的')).toBeNull()
    expect(setWeekLabel(doc, 'w2', '')).toBeNull()
    expect(setWeekLabel(doc, 'w2', '2026 13.1-13.7')).toBeNull()
    expect(setWeekLabel(doc, 'missing', '2026 10.27-11.2')).toBeNull()
    expect(JSON.stringify(doc)).toBe(snapshot)
  })

  it('假期周标签不限格式', () => {
    const doc = makeDoc()
    findWeek(doc, 'w1')!.kind = 'holiday'
    const result = setWeekLabel(doc, 'w1', '假期')
    expect(result).not.toBeNull()
    expect(findWeek(result!.doc, 'w1')!.label).toBe('假期')
    checked(result!.doc)
  })
})

describe('missing quadrants', () => {
  it('创建缺失象限后 addTask / setReview / moveTask 都生效，并保持顺序', () => {
    const doc = makeDoc()
    const week = findWeek(doc, 'w2')!
    week.quadrants = week.quadrants.filter((quadrant) => quadrant.key !== 'urgent')

    const added = addTask(doc, 'w2', 'urgent')
    expect(added).not.toBeNull()
    const afterAdd = findWeek(added!.doc, 'w2')!
    expect(afterAdd.quadrants.map((quadrant) => quadrant.key)).toEqual([
      'urgent-important',
      'important',
      'urgent',
      'neither',
    ])
    expect(findQuadrant(afterAdd, 'urgent')!.children).toHaveLength(1)
    checked(added!.doc)

    const reviewed = setReview(added!.doc, 'w2', '复盘')
    expect(reviewed).not.toBeNull()
    expect(findWeek(reviewed!.doc, 'w2')!.review).toBe('复盘')

    const moved = moveTask(reviewed!.doc, 'w2', 'b', 'urgent')
    expect(moved).not.toBeNull()
    const target = findQuadrant(findWeek(moved!.doc, 'w2')!, 'urgent')!
    expect(target.children.some((quest) => quest.id === 'b')).toBe(true)
    checked(moved!.doc)
  })
})

describe('task tree operations', () => {
  it('adds to the end of an empty quadrant and keeps the review', () => {
    const doc = makeDoc()
    const result = addTask(doc, 'w2', 'important')
    expect(result).not.toBeNull()
    const next = result!.doc
    checked(next)
    expect(next.weeks[0].review).toBe('经验')
    expect(next.weeks[0].quadrants[1].children).toHaveLength(1)
    expect(next.weeks[0].quadrants[1].children[0].title).toBe('')
    expect(result!.id).toBe(next.weeks[0].quadrants[1].children[0].id)
    expect(countQuests(next.weeks[0])).toBe(5)
    expect(doc.weeks[0].quadrants[1].children).toHaveLength(0)
  })

  it('adds a sibling after a top-level task and after a child', () => {
    const doc = makeDoc()
    const top = addSibling(doc, 'w2', 'a')!
    checked(top.doc)
    expect(top.doc.weeks[0].quadrants[0].children.map((q) => q.id)).toEqual(['a', top.id, 'b'])

    const child = addSibling(doc, 'w2', 'a1')!
    checked(child.doc)
    expect(child.doc.weeks[0].quadrants[0].children[0].children.map((q) => q.id)).toEqual([
      'a1',
      child.id,
      'a2',
    ])
  })

  it('拒绝重复的周标签', () => {
    const doc = makeDoc()
    expect(setWeekLabel(doc, 'w2', '2026 10.26-11.1')).not.toBeNull()
    expect(setWeekLabel(doc, 'w2', findWeek(doc, 'w1')!.label)).toBeNull()
  })

  it('假期周标签不可解析时不能恢复成普通周', () => {
    const doc = makeDoc()
    const holiday = setWeekKind(doc, 'w2', 'holiday')!
    const invalid = setWeekLabel(holiday.doc, 'w2', '随便写的')!
    expect(setWeekKind(invalid.doc, 'w2', 'normal')).toBeNull()
    // 标签改回日期区间后可以恢复
    const fixed = setWeekLabel(invalid.doc, 'w2', '2026 10.26-11.1')!
    expect(setWeekKind(fixed.doc, 'w2', 'normal')).not.toBeNull()
  })

  it('indents under the previous sibling and outdents beside the parent', () => {
    const doc = makeDoc()
    const indented = indentTask(doc, 'w2', 'b')!
    checked(indented.doc)
    expect(indented.doc.weeks[0].quadrants[0].children.map((q) => q.id)).toEqual(['a'])
    expect(indented.doc.weeks[0].quadrants[0].children[0].children.map((q) => q.id)).toEqual([
      'a1',
      'a2',
      'b',
    ])
    expect(indentTask(doc, 'w2', 'a')).toBeNull()

    const outdented = outdentTask(doc, 'w2', 'a1')!
    checked(outdented.doc)
    expect(outdented.doc.weeks[0].quadrants[0].children.map((q) => q.id)).toEqual(['a', 'a1', 'b'])
    expect(outdented.doc.weeks[0].quadrants[0].children[0].children.map((q) => q.id)).toEqual(['a2'])
    expect(outdentTask(doc, 'w2', 'a')).toBeNull()
  })

  it('toggles only leaves; a void leaf needs the menu', () => {
    const doc = makeDoc()
    const done = toggleStatus(doc, 'w2', 'a1')!
    checked(done.doc)
    expect(done.status).toBe('done')
    expect(statusOf(done.doc.weeks[0].quadrants[0].children[0])).toBe('done')

    expect(toggleStatus(doc, 'w2', 'a')).toBeNull()

    const voided = setVoid(doc, 'w2', 'a1', true)!
    checked(voided.doc)
    expect(voided.doc.weeks[0].quadrants[0].children[0].children[0].status).toBe('void')
    expect(toggleStatus(voided.doc, 'w2', 'a1')).toBeNull()

    const restored = setVoid(voided.doc, 'w2', 'a1', false)!
    checked(restored.doc)
    expect(restored.doc.weeks[0].quadrants[0].children[0].children[0].status).toBe('open')
  })

  it('voids a parent as an override and restores derivation', () => {
    const doc = makeDoc()
    const voided = setVoid(doc, 'w2', 'a', true)!
    checked(voided.doc)
    expect(voided.doc.weeks[0].quadrants[0].children[0].voided).toBe(true)
    expect(statusOf(voided.doc.weeks[0].quadrants[0].children[0])).toBe('void')
    expect(voided.doc.weeks[0].quadrants[0].children[0].children.map((q) => q.title)).toEqual(['A1', 'A2'])

    const restored = setVoid(voided.doc, 'w2', 'a', false)!
    checked(restored.doc)
    expect(restored.doc.weeks[0].quadrants[0].children[0].voided).toBeUndefined()
    expect(statusOf(restored.doc.weeks[0].quadrants[0].children[0])).toBe('open')
  })

  it('deletes a task with its subtree and returns the removed quest', () => {
    const doc = makeDoc()
    const result = deleteTask(doc, 'w2', 'a')!
    expect(result.doc.weeks[0].quadrants[0].children.map((q) => q.id)).toEqual(['b'])
    expect(result.removed.id).toBe('a')
    expect(result.removed.children).toHaveLength(2)
    checked(result.doc)
    expect(doc.weeks[0].quadrants[0].children).toHaveLength(2)
  })

  it('deleting the last child makes the parent a leaf and clears parent void', () => {
    const doc = makeDoc()
    const withVoid = setVoid(doc, 'w2', 'a', true)!
    const one = deleteTask(withVoid.doc, 'w2', 'a1')!
    const two = deleteTask(one.doc, 'w2', 'a2')!
    checked(two.doc)
    const parent = two.doc.weeks[0].quadrants[0].children[0]
    expect(parent.children).toHaveLength(0)
    expect(parent.voided).toBeUndefined()
    expect(parent.status).toBeUndefined()
    expect(statusOf(parent)).toBe('open')
  })

  it('moves a subtree to another quadrant; same quadrant is a no-op', () => {
    const doc = makeDoc()
    const moved = moveTask(doc, 'w2', 'a', 'important')!
    checked(moved.doc)
    expect(moved.doc.weeks[0].quadrants[1].children.map((q) => q.id)).toEqual(['a'])
    expect(moved.doc.weeks[0].review).toBe('经验')
    expect(moved.doc.weeks[0].quadrants[0].children.map((q) => q.id)).toEqual(['b'])
    expect(moved.doc.weeks[0].quadrants[1].children[0].children).toHaveLength(2)
    expect(moveTask(doc, 'w2', 'b', 'urgent-important')).toBeNull()
  })

  it('sets title/note/review/header and clears empty note/review', () => {
    const doc = makeDoc()
    const titled = setTitle(doc, 'w2', 'a', 'A changed')!
    checked(titled.doc)
    expect(titled.doc.weeks[0].quadrants[0].children[0].title).toBe('A changed')

    const noted = setNote(doc, 'w2', 'b', 'hello')!
    checked(noted.doc)
    expect(noted.doc.weeks[0].quadrants[0].children[1].note).toBe('hello')
    const cleared = setNote(noted.doc, 'w2', 'b', '   ')!
    checked(cleared.doc)
    expect(cleared.doc.weeks[0].quadrants[0].children[1].note).toBeUndefined()

    const reviewed = setReview(doc, 'w2', '新经验')!
    checked(reviewed.doc)
    expect(reviewed.doc.weeks[0].review).toBe('新经验')
    const reviewCleared = setReview(reviewed.doc, 'w2', '')!
    checked(reviewCleared.doc)
    expect(reviewCleared.doc.weeks[0].review).toBeUndefined()

    const headed = setHeader(doc, ['新说明', '第二行'])!
    expect(headed.doc.header).toEqual(['新说明', '第二行'])
  })

  it('sets week kind/note and keeps quadrants', () => {
    const doc = makeDoc()
    const holiday = setWeekKind(doc, 'w2', 'holiday')!
    checked(holiday.doc)
    expect(holiday.doc.weeks[0].kind).toBe('holiday')
    expect(holiday.doc.weeks[0].quadrants).toHaveLength(4)

    const noted = setWeekNote(doc, 'w2', '休息')!
    checked(noted.doc)
    expect(noted.doc.weeks[0].note).toBe('休息')
    const cleared = setWeekNote(noted.doc, 'w2', '')!
    checked(cleared.doc)
    expect(cleared.doc.weeks[0].note).toBeUndefined()
  })

  it('finds weeks, quadrants and nested quests', () => {
    const doc = makeDoc()
    expect(findWeek(doc, 'w2')?.label).toBe('2026 10.26-11.1')
    expect(findWeek(doc, 'missing')).toBeNull()
    expect(findWeek(doc, 'w2')?.review).toBe('经验')
    expect(findQuadrant(doc.weeks[0], 'nope' as never)).toBeNull()
    const location = findQuest(doc, 'w2', 'a1')!
    expect(location.parent?.id).toBe('a')
    expect(location.quadrant.key).toBe('urgent-important')
    expect(location.index).toBe(0)
    expect(findQuest(doc, 'w2', 'missing')).toBeNull()
  })

  it('returns null for missing targets and never mutates the input', () => {
    const doc = makeDoc()
    const snapshot = JSON.stringify(doc)
    expect(addTask(doc, 'missing', 'important')).toBeNull()
    expect(addTask(doc, 'w2', 'nope' as never)).toBeNull()
    expect(addSibling(doc, 'w2', 'missing')).toBeNull()
    expect(setTitle(doc, 'w2', 'missing', 'x')).toBeNull()
    expect(setNote(doc, 'w2', 'missing', 'x')).toBeNull()
    expect(setVoid(doc, 'w2', 'missing', true)).toBeNull()
    expect(deleteTask(doc, 'w2', 'missing')).toBeNull()
    expect(moveTask(doc, 'w2', 'missing', 'important')).toBeNull()
    expect(JSON.stringify(doc)).toBe(snapshot)
  })

  it('keeps counts and derived status in sync', () => {
    const doc = makeDoc()
    expect(countQuests(doc.weeks[0])).toBe(4)
    expect(statusOf(doc.weeks[0].quadrants[0].children[0])).toBe('open')
    expect(progressOf(doc.weeks[0].quadrants[0].children[0])).toEqual({
      done: 1,
      open: 1,
      void: 0,
      total: 2,
    })
  })
})

// 叶子与父任务的互相转换必须维护结构不变量：父任务不写 status，叶子不写 voided。
// 曾经漏掉这几处，用户「加任务后 Tab 缩进」就会产出非法文档，被写盘校验拒绝并锁住界面。
describe('叶子 ↔ 父任务转换', () => {
  it('Tab 缩进到叶子后面：前一个任务变父任务并清掉 status', () => {
    const doc = makeDoc()
    const withSibling = addSibling(doc, 'w2', 'b')!
    const indented = indentTask(withSibling.doc, 'w2', withSibling.id)!
    checked(indented.doc)
    const previous = findQuest(indented.doc, 'w2', 'b')!.quest
    expect(previous.children.map((quest) => quest.id)).toEqual([withSibling.id])
    expect(previous.status).toBeUndefined()
  })

  it('升级最后一个子任务：父任务退回叶子并清掉 voided', () => {
    const doc = makeDoc()
    const voided = setVoid(doc, 'w2', 'a', true)!
    const onlyChild = deleteTask(voided.doc, 'w2', 'a2')!
    const outdented = outdentTask(onlyChild.doc, 'w2', 'a1')!
    checked(outdented.doc)
    const parent = findQuest(outdented.doc, 'w2', 'a')!.quest
    expect(parent.children).toHaveLength(0)
    expect(parent.voided).toBeUndefined()
  })

  it('移走最后一个子任务：父任务退回叶子并清掉 voided', () => {
    const doc = makeDoc()
    const voided = setVoid(doc, 'w2', 'a', true)!
    const onlyChild = deleteTask(voided.doc, 'w2', 'a2')!
    const moved = moveTask(onlyChild.doc, 'w2', 'a1', 'important')!
    checked(moved.doc)
    const parent = findQuest(moved.doc, 'w2', 'a')!.quest
    expect(parent.children).toHaveLength(0)
    expect(parent.voided).toBeUndefined()
  })

})
