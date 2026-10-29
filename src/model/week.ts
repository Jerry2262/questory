import { hashId } from './ids'
import type { Quadrant, Quest, QuestDoc, Week } from './types'

/**
 * 周继承：当本周缺失时，用「最后一个填过的周」把整棵任务树复制过来。
 * 只复制任务（含完成/失效），不复制复盘；中间缺失的周不补空周；假期周跳过。
 * 规则见 DESIGN.md「周」。
 */

const TIME_ZONE = 'Asia/Shanghai'
const DAY_MS = 86_400_000

interface Ymd {
  year: number
  month: number
  day: number
}

export interface WeekRange {
  start: Date
  end: Date
  label: string
}

export interface RolloverInfo {
  created: boolean
  /** 从哪一周继承；null 表示之前没有可继承的周 */
  source: string | null
  /** 新周里的任务节点总数（含子任务） */
  inherited: number
  /** 找继承源时跳过了几个假期周 */
  skippedHolidays: number
  /** 当前的周标签 */
  label: string
}

export interface EnsureResult {
  doc: QuestDoc
  info: RolloverInfo
}

function ymdInTimeZone(date: Date): Ymd {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date)

  const value = (type: string) => Number(parts.find((part) => part.type === type)?.value)
  return { year: value('year'), month: value('month'), day: value('day') }
}

function toUtcDate({ year, month, day }: Ymd): Date {
  return new Date(Date.UTC(year, month - 1, day))
}

/** 当前周的周一 00:00 到周日 24:00（以 Asia/Shanghai 的日历为准） */
export function weekRange(now: Date = new Date()): WeekRange {
  const today = toUtcDate(ymdInTimeZone(now))
  const offset = (today.getUTCDay() + 6) % 7 // 周一 = 0
  const start = new Date(today.getTime() - offset * DAY_MS)
  const end = new Date(start.getTime() + 6 * DAY_MS)

  return {
    start,
    end,
    label: `${start.getUTCFullYear()} ${start.getUTCMonth() + 1}.${start.getUTCDate()}-${end.getUTCMonth() + 1}.${end.getUTCDate()}`,
  }
}

/** `2024 10.26-11.1` / `2024 12.29-1.4` / `2024 9.28-10.25` → 起止日期 */
export function parseWeekLabel(label: string): { start: Date; end: Date } | null {
  const clean = label.replace(/（[^）]*）\s*$/, '').trim()
  const match = clean.match(/^(\d{4})\s+(\d{1,2})\.(\d{1,2})-(\d{1,2})\.(\d{1,2})$/)
  if (!match) return null

  const year = Number(match[1])
  const startMonth = Number(match[2])
  const startDay = Number(match[3])
  const endMonth = Number(match[4])
  const endDay = Number(match[5])
  if (startMonth < 1 || startMonth > 12 || endMonth < 1 || endMonth > 12) return null
  if (startDay < 1 || startDay > 31 || endDay < 1 || endDay > 31) return null

  const start = new Date(Date.UTC(year, startMonth - 1, startDay))
  const endYear = endMonth < startMonth ? year + 1 : year
  const end = new Date(Date.UTC(endYear, endMonth - 1, endDay))
  if (end < start) return null

  return { start, end }
}

function covers(week: Week, today: Date): boolean {
  const range = parseWeekLabel(week.label)
  return !!range && today >= range.start && today <= range.end
}

/** 这个周有没有「填过」：有任务，或者写了复盘 */
function isFilled(week: Week): boolean {
  const hasReview = (week.review ?? '').trim().length > 0
  return hasReview || countQuests(week) > 0
}

export function countQuests(week: Week): number {
  const walk = (quests: Quest[]): number =>
    quests.reduce((sum, quest) => sum + 1 + walk(quest.children), 0)
  return week.quadrants.reduce((sum, quadrant) => sum + walk(quadrant.children), 0)
}

/** 文档里已占用的全部 id（周 + 任务），新生成的 id 必须避开它们 */
function usedIds(doc: QuestDoc): Set<string> {
  const used = new Set<string>()
  const walk = (quests: Quest[]): void => {
    for (const quest of quests) {
      used.add(quest.id)
      walk(quest.children)
    }
  }
  for (const week of doc.weeks) {
    used.add(week.id)
    for (const quadrant of week.quadrants) walk(quadrant.children)
  }
  return used
}

/**
 * 内容哈希 id 是确定的，但历史可能留下「同 label 的旧周」（例如自动建的本周被改名成别的区间），
 * 这时重新继承会算出同一个 id。冲突就加数字后缀，保证 id 在文档内唯一。
 */
function uniqueId(used: Set<string>, base: string): string {
  let id = base
  for (let attempt = 1; used.has(id); attempt += 1) id = `${base}${attempt}`
  used.add(id)
  return id
}

/** 深拷贝整棵子树：新 id、叶子状态/备注保留，父任务不写状态 */
function cloneQuests(quests: Quest[], path: (string | number)[], used: Set<string>): Quest[] {
  return quests.map((quest, index) => {
    const here = [...path, index]
    return {
      id: uniqueId(used, hashId('quest', ...here)),
      title: quest.title,
      ...(quest.children.length
        ? quest.voided
          ? { voided: true }
          : {}
        : { status: quest.status ?? 'open' }),
      ...(quest.note ? { note: quest.note } : {}),
      children: cloneQuests(quest.children, here, used),
    }
  })
}

function inheritWeek(source: Week, label: string, used: Set<string>): Week {
  const quadrants: Quadrant[] = source.quadrants
    .map((quadrant) => ({
      key: quadrant.key,
      children: cloneQuests(quadrant.children, [label, quadrant.key], used),
    }))
    .filter((quadrant) => quadrant.children.length > 0)

  // 复盘不继承：经验属于过去那一周
  return { id: uniqueId(used, hashId('week', label)), label, kind: 'normal', quadrants }
}

function emptyWeek(label: string, used: Set<string>): Week {
  return { id: uniqueId(used, hashId('week', label)), label, kind: 'normal', quadrants: [] }
}

/**
 * 保证 doc 里有「本周」：
 * - 已有覆盖今天的周 → 原样返回（含合并过的长周）
 * - 有比今天更晚的周 → 不动，避免把本周插到未来周后面
 * - 否则新建本周，从最新一个「填过」的非假期周整棵继承
 */
export function ensureCurrentWeek(doc: QuestDoc, now: Date = new Date()): EnsureResult {
  const current = weekRange(now)
  const today = toUtcDate(ymdInTimeZone(now))
  const info: RolloverInfo = {
    created: false,
    source: null,
    inherited: 0,
    skippedHolidays: 0,
    label: current.label,
  }

  if (doc.weeks.some((week) => covers(week, today))) return { doc, info }

  const starts = doc.weeks
    .map((week) => parseWeekLabel(week.label)?.start)
    .filter((start): start is Date => start != null)
  if (starts.some((start) => start > current.start)) return { doc, info }

  const weeks = [...doc.weeks]
  let source: Week | null = null
  for (const week of weeks) {
    const range = parseWeekLabel(week.label)
    if (!range || range.start > current.start) continue
    if (week.kind === 'holiday') {
      info.skippedHolidays += 1
      continue
    }
    if (isFilled(week)) {
      source = week
      break
    }
  }

  const used = usedIds(doc)
  const created = source
    ? inheritWeek(source, current.label, used)
    : emptyWeek(current.label, used)
  info.created = true
  info.source = source?.label ?? null
  info.inherited = countQuests(created)

  return { doc: { ...doc, weeks: [created, ...weeks] }, info }
}

/** 数据里覆盖今天的周；没有就返回 null（合并过的长周也算覆盖） */
export function currentWeekOf(doc: QuestDoc, now: Date = new Date()): Week | null {
  const today = toUtcDate(ymdInTimeZone(now))
  return doc.weeks.find((week) => covers(week, today)) ?? null
}
