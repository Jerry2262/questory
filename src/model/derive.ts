import type { Quest, QuestStatus } from './types'

/**
 * 没有子任务时状态就是自己；有子任务时由子任务推导（父任务的 status 不落盘）。
 * 规则见 DESIGN.md「状态与父推导」：
 *   1. 只要还有一个未完成 → 未完成
 *   2. 没有未完成、至少有一个完成 → 完成
 *   3. 全部失效 → 失效
 */
export function statusOf(quest: Quest): QuestStatus {
  if (!quest.children.length) return quest.status ?? 'open'
  if (quest.voided) return 'void'
  return deriveStatus(quest.children.map(statusOf))
}

function deriveStatus(children: QuestStatus[]): QuestStatus {
  if (children.includes('open')) return 'open'
  if (children.includes('done')) return 'done'
  return 'void'
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
      progress[statusOf(node)] += 1
      progress.total += 1
      return
    }
    for (const child of node.children) walk(child)
  }
  walk(quest)
  return progress
}
