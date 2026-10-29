import { current, produce } from 'immer'

import { newId } from './ids'
import { parseWeekLabel } from './week'
import { QUADRANT_KEYS } from './types'
import type {
  Quadrant,
  QuadrantKey,
  Quest,
  QuestDoc,
  QuestStatus,
  Week,
} from './types'

/**
 * 结构化任务树的唯一写入口。
 *
 * 规则见 DESIGN.md「编辑层」：
 * - 输入 doc 不被修改，返回新 doc；UI 只渲染返回的 doc。
 * - 结构操作（增删/缩进/移动）只在这里做；标题/备注/复盘只是字符串赋值。
 * - 父任务不写 status；叶子只用 status；父任务作废用 voided。
 * - 同一状态只有一个入口：勾选框 open↔done，作废走 setVoid；
 *   标题 Enter 和「+ 添加任务」都调用 addTask。
 *
 * 实现用 Immer 的 produce：草稿上直接改，未改动的子树与旧文档共享，
 * 所以「整文档快照」的历史栈实际只多占改动路径那一点内存。
 */

export type OpResult<T extends object = object> = (T & { doc: QuestDoc }) | null

export interface QuestLocation {
  week: Week
  quadrant: Quadrant
  parent: Quest | null
  siblings: Quest[]
  index: number
  quest: Quest
}

/**
 * 所有写操作的统一外壳：在草稿上改，返回新文档与附加信息；回调返回 null 表示没有改动。
 * 回调里抛错或返回 null 时草稿会被丢弃，输入文档不受影响。
 */
function edit<T extends object>(doc: QuestDoc, mutate: (draft: QuestDoc) => T | null): OpResult<T> {
  const holder: { value: T | null } = { value: null }
  const next = produce(doc, (draft) => {
    holder.value = mutate(draft as unknown as QuestDoc)
  })
  const value = holder.value
  if (!value) return null
  return { ...value, doc: next }
}

export function findWeek(doc: QuestDoc, weekId: string): Week | null {
  return doc.weeks.find((week) => week.id === weekId) ?? null
}

export function findQuadrant(week: Week, key: QuadrantKey): Quadrant | null {
  return week.quadrants.find((quadrant) => quadrant.key === key) ?? null
}

/**
 * 空象限在数据里可能根本不存在：界面会为当前周/最新周补出四个空象限来展示。
 * 写入前先补出真实的象限，并保持固定顺序，否则 addTask/moveTask
 * 会在 findQuadrant 这里拿到 null，界面表现为“点了没反应”。
 */
function ensureQuadrant(week: Week, key: QuadrantKey): Quadrant | null {
  if (!QUADRANT_KEYS.includes(key)) return null
  const existing = findQuadrant(week, key)
  if (existing) return existing

  const created: Quadrant = { key, children: [] }
  const order = QUADRANT_KEYS.indexOf(key)
  const index = week.quadrants.findIndex((quadrant) => QUADRANT_KEYS.indexOf(quadrant.key) > order)
  if (index === -1) week.quadrants.push(created)
  else week.quadrants.splice(index, 0, created)
  return created
}

function findQuestIn(
  week: Week,
  quadrant: Quadrant,
  quests: Quest[],
  parent: Quest | null,
  questId: string,
): QuestLocation | null {
  for (let index = 0; index < quests.length; index += 1) {
    const quest = quests[index]
    if (quest.id === questId) return { week, quadrant, parent, siblings: quests, index, quest }
    const found = findQuestIn(week, quadrant, quest.children, quest, questId)
    if (found) return found
  }
  return null
}

export function findQuest(doc: QuestDoc, weekId: string, questId: string): QuestLocation | null {
  const week = findWeek(doc, weekId)
  if (!week) return null
  for (const quadrant of week.quadrants) {
    const found = findQuestIn(week, quadrant, quadrant.children, null, questId)
    if (found) return found
  }
  return null
}

function makeQuest(): Quest {
  return { id: newId(), title: '', status: 'open', children: [] }
}

/**
 * 在象限末尾（「+ 添加任务」）或某个任务后面（同级）加一条空任务。
 * 缩进成子任务走 indentTask，不在这里造子级。
 */
export function addTask(
  doc: QuestDoc,
  weekId: string,
  quadrantKey: QuadrantKey,
  options: { afterId?: string } = {},
): OpResult<{ id: string }> {
  return edit(doc, (draft) => {
    const week = findWeek(draft, weekId)
    if (!week) return null
    const quadrant = ensureQuadrant(week, quadrantKey)
    if (!quadrant) return null

    const created = makeQuest()
    if (options.afterId) {
      const after = findQuestIn(week, quadrant, quadrant.children, null, options.afterId)
      if (!after) return null
      after.siblings.splice(after.index + 1, 0, created)
    } else {
      quadrant.children.push(created)
    }

    return { id: created.id }
  })
}

/** 标题里按 Enter：在同一个父级下加下一条 */
export function addSibling(doc: QuestDoc, weekId: string, questId: string): OpResult<{ id: string }> {
  const location = findQuest(doc, weekId, questId)
  if (!location) return null
  return addTask(doc, weekId, location.quadrant.key, { afterId: questId })
}

export function setTitle(doc: QuestDoc, weekId: string, questId: string, title: string): OpResult<{ id: string }> {
  return edit(doc, (draft) => {
    const location = findQuest(draft, weekId, questId)
    if (!location) return null
    location.quest.title = title
    return { id: questId }
  })
}

export function setNote(doc: QuestDoc, weekId: string, questId: string, note: string): OpResult<{ id: string }> {
  return edit(doc, (draft) => {
    const location = findQuest(draft, weekId, questId)
    if (!location) return null
    if (note.trim()) location.quest.note = note
    else delete location.quest.note
    return { id: questId }
  })
}

export function setReview(doc: QuestDoc, weekId: string, review: string): OpResult<{ weekId: string }> {
  return edit(doc, (draft) => {
    const week = findWeek(draft, weekId)
    if (!week) return null
    if (review.trim()) week.review = review
    else delete week.review
    return { weekId }
  })
}

export function setHeader(doc: QuestDoc, header: string[]): OpResult {
  return edit(doc, (draft) => {
    draft.header = [...header]
    return {}
  })
}

export function setWeekKind(doc: QuestDoc, weekId: string, kind: Week['kind']): OpResult<{ weekId: string }> {
  return edit(doc, (draft) => {
    const week = findWeek(draft, weekId)
    if (!week) return null
    // 假期周标签可以随便写；恢复成普通周时必须能解析成日期区间，否则会被写盘校验拒绝
    if (kind === 'normal' && !parseWeekLabel(week.label)) return null
    week.kind = kind
    return { weekId }
  })
}

/**
 * 改周标题。普通周必须能解析成日期区间（和后端校验、rollover 判周一致），
 * 否则当前周检测会失效、下次打开会重复建周；假期周标签不限格式。
 */
export function setWeekLabel(doc: QuestDoc, weekId: string, label: string): OpResult<{ weekId: string }> {
  const trimmed = label.trim()
  if (!trimmed) return null
  return edit(doc, (draft) => {
    const week = findWeek(draft, weekId)
    if (!week) return null
    if (week.kind === 'normal' && !parseWeekLabel(trimmed)) return null
    // 周标签是继承与「本周」判定的依据，重复会让两周一模一样
    if (draft.weeks.some((item) => item.id !== weekId && item.label === trimmed)) return null
    week.label = trimmed
    return { weekId }
  })
}

export function setWeekNote(doc: QuestDoc, weekId: string, note: string): OpResult<{ weekId: string }> {
  return edit(doc, (draft) => {
    const week = findWeek(draft, weekId)
    if (!week) return null
    if (note.trim()) week.note = note
    else delete week.note
    return { weekId }
  })
}

/** 叶子勾选框：open↔done。父任务、失效任务不在这里改。 */
export function toggleStatus(doc: QuestDoc, weekId: string, questId: string): OpResult<{ status: QuestStatus }> {
  return edit(doc, (draft) => {
    const location = findQuest(draft, weekId, questId)
    if (!location || location.quest.children.length) return null
    if (location.quest.status === 'void') return null
    location.quest.status = location.quest.status === 'done' ? 'open' : 'done'
    return { status: location.quest.status }
  })
}

/**
 * 菜单「作废 / 恢复」：叶子写 status=void，父任务写 voided。
 * 取消作废时叶子回到 open，父任务恢复按子任务推导。
 */
export function setVoid(doc: QuestDoc, weekId: string, questId: string, voided: boolean): OpResult<{ id: string }> {
  return edit(doc, (draft) => {
    const location = findQuest(draft, weekId, questId)
    if (!location) return null

    if (location.quest.children.length) {
      if (voided) location.quest.voided = true
      else delete location.quest.voided
    } else {
      delete location.quest.voided
      location.quest.status = voided ? 'void' : 'open'
    }
    return { id: questId }
  })
}

/**
 * 叶子 → 父任务：状态改由子任务推导，必须清掉叶子期写下的 status。
 * 漏了就会被写盘校验拒绝（父任务不存 status），界面表现为保存失败并锁住。
 */
function markParent(quest: Quest): void {
  if (quest.children.length > 0) delete quest.status
}

/** 父任务 → 叶子：voided 覆盖失去意义，清掉；status 缺省按未完成。 */
function markLeafIfEmpty(quest: Quest): void {
  if (quest.children.length === 0) delete quest.voided
}

/**
 * 删除一条任务（含子树），返回被删的子树供界面提示使用（撤销走历史快照）。
 * 删到父任务没有子任务时，父任务退回叶子，清掉父任务作废覆盖。
 */
export function deleteTask(doc: QuestDoc, weekId: string, questId: string): OpResult<{ removed: Quest }> {
  return edit(doc, (draft) => {
    const location = findQuest(draft, weekId, questId)
    if (!location) return null

    // 草稿在 produce 结束后会被收回，这里要取一份独立的普通对象
    const removed = current(location.quest) as Quest
    location.siblings.splice(location.index, 1)

    if (location.parent) markLeafIfEmpty(location.parent)

    return { removed }
  })
}

/** 菜单「移动到」：把整棵子树移到同一周另一个象限末尾。 */
export function moveTask(
  doc: QuestDoc,
  weekId: string,
  questId: string,
  targetQuadrant: QuadrantKey,
): OpResult<{ id: string }> {
  return edit(doc, (draft) => {
    const location = findQuest(draft, weekId, questId)
    if (!location) return null
    if (targetQuadrant === location.quadrant.key) return null
    const target = ensureQuadrant(location.week, targetQuadrant)
    if (!target) return null

    location.siblings.splice(location.index, 1)
    target.children.push(location.quest)
    if (location.parent) markLeafIfEmpty(location.parent)
    return { id: questId }
  })
}

/** Tab：变成前一个同级任务最后一个子任务。第一个同级不能缩进。 */
export function indentTask(doc: QuestDoc, weekId: string, questId: string): OpResult<{ id: string }> {
  return edit(doc, (draft) => {
    const location = findQuest(draft, weekId, questId)
    if (!location || location.index === 0) return null

    const previous = location.siblings[location.index - 1]
    location.siblings.splice(location.index, 1)
    previous.children.push(location.quest)
    markParent(previous)
    return { id: questId }
  })
}

/** Shift+Tab：升级到父任务的下一行；顶层任务不能升级。 */
export function outdentTask(doc: QuestDoc, weekId: string, questId: string): OpResult<{ id: string }> {
  return edit(doc, (draft) => {
    const location = findQuest(draft, weekId, questId)
    if (!location || !location.parent) return null
    const parent = findQuest(draft, weekId, location.parent.id)
    if (!parent) return null

    location.siblings.splice(location.index, 1)
    parent.siblings.splice(parent.index + 1, 0, location.quest)
    markLeafIfEmpty(parent.quest)
    return { id: questId }
  })
}
