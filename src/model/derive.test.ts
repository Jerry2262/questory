import { describe, expect, it } from 'vitest'

import { progressOf, statusOf } from './derive'
import type { Quest, QuestStatus } from './types'

const leaf = (id: string, status: QuestStatus): Quest => ({ id, title: id, status, children: [] })

const parent = (id: string, children: Quest[]): Quest => ({ id, title: id, children })

describe('父状态推导', () => {
  it('有未完成子任务时父未完成', () => {
    expect(statusOf(parent('A', [leaf('1', 'done'), leaf('2', 'done'), leaf('3', 'open')]))).toBe('open')
  })

  it('没有未完成、至少一个完成时父完成', () => {
    expect(statusOf(parent('A', [leaf('1', 'done'), leaf('2', 'void')]))).toBe('done')
  })

  it('子任务全失效时父失效', () => {
    expect(statusOf(parent('A', [leaf('1', 'void'), leaf('2', 'void')]))).toBe('void')
  })

  it('多层嵌套一路推导到最里层', () => {
    const tree = parent('A', [parent('B', [leaf('1', 'done'), leaf('2', 'open')]), leaf('3', 'done')])
    expect(statusOf(tree)).toBe('open')
    expect(statusOf(tree.children[0])).toBe('open')
  })

  it('叶子任务没有名字里的 status 时按未完成算', () => {
    expect(statusOf({ id: 'x', title: 'x', children: [] })).toBe('open')
  })

  it('父任务显式作废时整条失效，子任务状态保留', () => {
    const quest = { ...parent('A', [leaf('1', 'open'), leaf('2', 'done')]), voided: true }
    expect(statusOf(quest)).toBe('void')
    expect(quest.children.map(statusOf)).toEqual(['open', 'done'])
    expect(statusOf({ ...quest, voided: false })).toBe('open')
  })

  it('删除最后一个未完成子任务后父自动完成', () => {
    const quest = parent('A', [leaf('1', 'done'), leaf('2', 'open')])
    expect(statusOf(quest)).toBe('open')
    quest.children.pop()
    expect(statusOf(quest)).toBe('done')
  })
})

describe('父任务进度', () => {
  it('只统计叶子，嵌套层会摊平', () => {
    const tree = parent('A', [
      parent('B', [leaf('1', 'done'), leaf('2', 'open')]),
      leaf('3', 'void'),
    ])
    expect(progressOf(tree)).toEqual({ done: 1, open: 1, void: 1, total: 3 })
  })
})
