import { describe, expect, it } from 'vitest'

import { progressOf, stateOf } from './derive'
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
  reorderTask,
  setHeader,
  setNote,
  setReview,
  setTitle,
  setVoid,
  setWeekKind,
  setWeekLabel,
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
                  { id: 'a1', title: 'A1', done: false, voided: false, note: 'n', children: [] },
                  { id: 'a2', title: 'A2', done: true, voided: false, children: [] },
                ],
              },
              { id: 'b', title: 'B', done: false, voided: false, children: [] },
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
  it('adds a new leaf to the end of an empty quadrant', () => {
    const doc = makeDoc()
    const result = addTask(doc, 'w2', 'important')
    expect(result).not.toBeNull()
    const next = result!.doc
    checked(next)
    expect(next.weeks[0].review).toBe('经验')
    expect(next.weeks[0].quadrants[1].children).toHaveLength(1)
    expect(next.weeks[0].quadrants[1].children[0]).toMatchObject({
      title: '',
      done: false,
      voided: false,
    })
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
    expect(indented.doc.weeks[0].quadrants[0].children[0]).not.toHaveProperty('done')
    expect(indented.doc.weeks[0].quadrants[0].children[0]).not.toHaveProperty('voided')
    expect(indentTask(doc, 'w2', 'a')).toBeNull()

    const outdented = outdentTask(doc, 'w2', 'a1')!
    checked(outdented.doc)
    expect(outdented.doc.weeks[0].quadrants[0].children.map((q) => q.id)).toEqual(['a', 'a1', 'b'])
    expect(outdented.doc.weeks[0].quadrants[0].children[0].children.map((q) => q.id)).toEqual(['a2'])
    expect(outdentTask(doc, 'w2', 'a')).toBeNull()
  })

  it('toggles only non-void leaves', () => {
    const doc = makeDoc()
    const done = toggleStatus(doc, 'w2', 'a1')!
    checked(done.doc)
    expect(done.done).toBe(true)
    expect(findQuest(done.doc, 'w2', 'a1')!.quest).toMatchObject({ done: true, voided: false })

    expect(toggleStatus(doc, 'w2', 'a')).toBeNull()

    const voided = setVoid(doc, 'w2', 'a1', true)!
    checked(voided.doc)
    expect(findQuest(voided.doc, 'w2', 'a1')!.quest).toMatchObject({ done: false, voided: true })
    expect(toggleStatus(voided.doc, 'w2', 'a1')).toBeNull()

    const restored = setVoid(voided.doc, 'w2', 'a1', false)!
    checked(restored.doc)
    expect(findQuest(restored.doc, 'w2', 'a1')!.quest).toMatchObject({ done: false, voided: false })
  })

  it('作废完成叶子时保留完成，恢复后回到完成', () => {
    const done = toggleStatus(makeDoc(), 'w2', 'a1')!
    const voided = setVoid(done.doc, 'w2', 'a1', true)!
    checked(voided.doc)
    expect(findQuest(voided.doc, 'w2', 'a1')!.quest).toMatchObject({ done: true, voided: true })

    const restored = setVoid(voided.doc, 'w2', 'a1', false)!
    checked(restored.doc)
    expect(findQuest(restored.doc, 'w2', 'a1')!.quest).toMatchObject({ done: true, voided: false })
  })

  it('voids a parent recursively and restores every leaf', () => {
    const doc = makeDoc()
    const voided = setVoid(doc, 'w2', 'a', true)!
    checked(voided.doc)
    const parent = findQuest(voided.doc, 'w2', 'a')!.quest
    expect(parent).not.toHaveProperty('voided')
    expect(parent.children.map((quest) => [quest.done, quest.voided])).toEqual([
      [false, true],
      [true, true],
    ])
    expect(stateOf(parent)).toEqual({ done: true, voided: true })

    const restored = setVoid(voided.doc, 'w2', 'a', false)!
    checked(restored.doc)
    const back = findQuest(restored.doc, 'w2', 'a')!.quest
    expect(back.children.map((quest) => [quest.done, quest.voided])).toEqual([
      [false, false],
      [true, false],
    ])
    expect(stateOf(back)).toEqual({ done: false, voided: false })
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

  it('deleting the last child turns the parent into a leaf with its state', () => {
    const doc = makeDoc()
    const withVoid = setVoid(doc, 'w2', 'a', true)!
    const one = deleteTask(withVoid.doc, 'w2', 'a1')!
    const two = deleteTask(one.doc, 'w2', 'a2')!
    checked(two.doc)
    const parent = findQuest(two.doc, 'w2', 'a')!.quest
    expect(parent.children).toHaveLength(0)
    expect(parent).toMatchObject({ done: true, voided: true })
    expect(stateOf(parent)).toEqual({ done: true, voided: true })
  })

  it('moves only a top-level subtree to another quadrant; same quadrant is a no-op', () => {
    const doc = makeDoc()
    const moved = moveTask(doc, 'w2', 'a', 'important')!
    checked(moved.doc)
    expect(moved.doc.weeks[0].quadrants[1].children.map((q) => q.id)).toEqual(['a'])
    expect(moved.doc.weeks[0].review).toBe('经验')
    expect(moved.doc.weeks[0].quadrants[0].children.map((q) => q.id)).toEqual(['b'])
    expect(moved.doc.weeks[0].quadrants[1].children[0].children).toHaveLength(2)
    expect(moveTask(doc, 'w2', 'b', 'urgent-important')).toBeNull()
    expect(moveTask(doc, 'w2', 'a1', 'important')).toBeNull()
  })

  it('reorders a top-level subtree by one slot inside its quadrant', () => {
    const doc = makeDoc()
    const [a, b] = doc.weeks[0].quadrants[0].children
    const lower = reorderTask(doc, 'w2', 'a', 1)!
    expect(lower.id).toBe('a')
    expect(lower.doc.weeks[0].quadrants[0].children).toEqual([b, a])
    expect(lower.doc.weeks[0].quadrants.slice(1)).toEqual(doc.weeks[0].quadrants.slice(1))
    expect(doc.weeks[0].quadrants[0].children).toEqual([a, b])
    expect(reorderTask(lower.doc, 'w2', 'a', -1)?.doc).toEqual(doc)
    checked(lower.doc)
  })

  it('does not reorder children, unknown tasks or tasks past a boundary', () => {
    const doc = makeDoc()
    expect(reorderTask(doc, 'w2', 'a1', 1)).toBeNull()
    expect(reorderTask(doc, 'w2', 'missing', 1)).toBeNull()
    expect(reorderTask(doc, 'w2', 'a', -1)).toBeNull()
    expect(reorderTask(doc, 'w2', 'b', 1)).toBeNull()
  })

  it('sets title/note/review/header and clears empty note/review', () => {
    const doc = makeDoc()
    const titled = setTitle(doc, 'w2', 'a', 'A changed')!
    checked(titled.doc)
    expect(titled.doc.weeks[0].quadrants[0].children[0].title).toBe('A changed')

    const multiline = setTitle(doc, 'w2', 'b', '第一行\r\n第二行')!
    checked(multiline.doc)
    expect(findQuest(multiline.doc, 'w2', 'b')!.quest.title).toBe('第一行 第二行')

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

  it('keeps counts and derived state in sync', () => {
    const doc = makeDoc()
    expect(countQuests(doc.weeks[0])).toBe(4)
    expect(stateOf(doc.weeks[0].quadrants[0].children[0])).toEqual({ done: false, voided: false })
    expect(progressOf(doc.weeks[0].quadrants[0].children[0])).toEqual({
      done: 1,
      open: 1,
      void: 0,
      total: 2,
    })
  })
})

describe('结构转换与作废限制', () => {
  it('Tab 缩进到叶子后面：前一个任务变父任务并清掉状态字段', () => {
    const doc = makeDoc()
    const withSibling = addSibling(doc, 'w2', 'b')!
    const indented = indentTask(withSibling.doc, 'w2', withSibling.id)!
    checked(indented.doc)
    const previous = findQuest(indented.doc, 'w2', 'b')!.quest
    expect(previous.children.map((quest) => quest.id)).toEqual([withSibling.id])
    expect(previous).not.toHaveProperty('done')
    expect(previous).not.toHaveProperty('voided')
  })

  it('作废目标下不能缩进', () => {
    const doc = makeDoc()
    const voided = setVoid(doc, 'w2', 'b', true)!
    const withSibling = addSibling(voided.doc, 'w2', 'b')!
    expect(indentTask(withSibling.doc, 'w2', withSibling.id)).toBeNull()
    expect(findQuest(withSibling.doc, 'w2', withSibling.id)!.parent).toBeNull()
  })

  it('作废父任务下不能新增同级任务', () => {
    const doc = makeDoc()
    const voided = setVoid(doc, 'w2', 'a', true)!
    expect(addSibling(voided.doc, 'w2', 'a1')).toBeNull()
    expect(addTask(voided.doc, 'w2', 'urgent-important', { afterId: 'a1' })).toBeNull()
  })

  it('完成或未完成的父任务仍可新增；新增后父任务重新归约', () => {
    const doneChild = toggleStatus(makeDoc(), 'w2', 'a1')!
    expect(stateOf(findQuest(doneChild.doc, 'w2', 'a')!.quest)).toEqual({
      done: true,
      voided: false,
    })

    const added = addSibling(doneChild.doc, 'w2', 'a1')!
    checked(added.doc)
    expect(findQuest(added.doc, 'w2', 'a')!.quest.children).toHaveLength(3)
    expect(stateOf(findQuest(added.doc, 'w2', 'a')!.quest)).toEqual({
      done: false,
      voided: false,
    })
    expect(findQuest(added.doc, 'w2', added.id)!.quest).toMatchObject({
      done: false,
      voided: false,
    })
  })

  it('升级最后一个子任务：父任务退回叶子并保留作废状态', () => {
    const doc = makeDoc()
    const voided = setVoid(doc, 'w2', 'a', true)!
    const onlyChild = deleteTask(voided.doc, 'w2', 'a2')!
    const outdented = outdentTask(onlyChild.doc, 'w2', 'a1')!
    checked(outdented.doc)
    const parent = findQuest(outdented.doc, 'w2', 'a')!.quest
    expect(parent.children).toHaveLength(0)
    expect(parent).toMatchObject({ done: false, voided: true })
  })
})
