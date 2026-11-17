import { describe, expect, it } from 'vitest'

import { progressOf, stateOf } from './derive'
import type { Quest } from './types'

const leaf = (id: string, done = false, voided = false, title = id): Quest => ({
  id,
  title,
  done,
  voided,
  children: [],
})

const parent = (id: string, children: Quest[], title = id): Quest => ({
  id,
  title,
  children,
})

describe('两布尔状态与父任务归约', () => {
  it('有未完成子任务时父未完成', () => {
    expect(stateOf(parent('A', [leaf('1', true), leaf('2', true), leaf('3')]))).toEqual({
      done: false,
      voided: false,
    })
  })

  it('存在完成子项且其余子项都已关闭时父完成', () => {
    expect(stateOf(parent('A', [leaf('1', true), leaf('2', false, true)]))).toEqual({
      done: true,
      voided: false,
    })
  })

  it('没有完成子项时，全部作废的父任务不算完成', () => {
    expect(stateOf(parent('A', [leaf('1', false, true), leaf('2', false, true)]))).toEqual({
      done: false,
      voided: true,
    })
  })

  it('全部作废且存在完成子项时父任务完成 + 作废', () => {
    expect(stateOf(parent('A', [leaf('1', true, true), leaf('2', false, true)]))).toEqual({
      done: true,
      voided: true,
    })
  })

  it('多层嵌套逐层归约', () => {
    const tree = parent('A', [parent('B', [leaf('1', true), leaf('2')]), leaf('3', true)])
    expect(stateOf(tree)).toEqual({ done: false, voided: false })
    expect(stateOf(tree.children[0])).toEqual({ done: false, voided: false })
  })

  it('缺省字段按 false 读取', () => {
    expect(stateOf({ id: 'x', title: 'x', children: [] })).toEqual({ done: false, voided: false })
  })

  it('删除最后一个未完成子任务后父自动完成', () => {
    const quest = parent('A', [leaf('1', true), leaf('2')])
    expect(stateOf(quest)).toEqual({ done: false, voided: false })
    quest.children.pop()
    expect(stateOf(quest)).toEqual({ done: true, voided: false })
  })
})

describe('父任务进度', () => {
  it('只统计叶子，作废优先于完成计数', () => {
    const tree = parent('A', [
      parent('B', [leaf('1', true), leaf('2')]),
      leaf('3', false, true),
      leaf('4', true, true),
    ])
    expect(progressOf(tree)).toEqual({ done: 1, open: 1, void: 2, total: 4 })
  })
})
