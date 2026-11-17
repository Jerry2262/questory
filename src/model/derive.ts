import type { Quest, TaskState } from './types'

/**
 * 任务的当前状态就是两个布尔：done 和 voided。
 * 叶子的两个布尔直接存在任务上；父任务不存状态，只读取直接子任务归约。
 *
 * 规则见 DESIGN.md「状态与父推导」：
 *   parent.done = (存在子任务 done) && (所有子任务 closed)
 *   parent.voided = 所有子任务 voided
 *   closed = done || voided
 */
export function stateOf(quest: Quest): TaskState {
  if (!quest.children.length) {
    return { done: quest.done === true, voided: quest.voided === true }
  }

  const children = quest.children.map(stateOf)
  return {
    done: children.some((child) => child.done) && children.every((child) => child.done || child.voided),
    voided: children.every((child) => child.voided),
  }
}

export interface Progress {
  done: number
  open: number
  void: number
  total: number
}

/** 统计一棵子树里叶子任务的状态，用来显示父任务进度 */
export function progressOf(quest: Quest): Progress {
  const progress: Progress = { done: 0, open: 0, void: 0, total: 0 }
  const walk = (node: Quest) => {
    if (!node.children.length) {
      const state = stateOf(node)
      if (state.voided) progress.void += 1
      else if (state.done) progress.done += 1
      else progress.open += 1
      progress.total += 1
      return
    }
    for (const child of node.children) walk(child)
  }
  walk(quest)
  return progress
}
