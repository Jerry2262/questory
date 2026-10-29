import { useCallback, useEffect, useRef, useState } from 'react'

import { currentWeekOf, weekRange } from './model/week'
import { deleteTask } from './model/ops'
import { weekCheckOutcome } from './saveGuard'
import type { QuestDoc } from './model/types'

const IDLE_MS = 700
const MAX_UNSAVED_MS = 5_000
const TICK_MS = 500
const RETRY_DELAYS = [2_000, 5_000, 15_000]
const HISTORY_LIMIT = 100
const COALESCE_MS = 900

export interface Meta {
  weeks: number
  ms: number
}

export type SaveState =
  | { kind: 'idle' }
  | { kind: 'loaded'; at: string }
  | { kind: 'dirty' }
  | { kind: 'saving' }
  | { kind: 'saved'; at: string }
  | { kind: 'error'; message: string }

export interface Blocker {
  kind: 'week' | 'conflict'
  text: string
}

export interface FocusRequest {
  id: string
  tick: number
}

export interface RunOptions {
  /** 同一字段连续输入时不要每次按键都压一条撤销记录 */
  coalesceKey?: string
  /** 撤销/重做这一步之后，把焦点还到这个任务的标题上（任务已不存在则忽略） */
  focusId?: string
}

/** 撤销栈的一项：某次修改之前的文档，以及该次修改涉及的任务 */
interface HistoryEntry {
  doc: QuestDoc
  focusId?: string
}

/** 删除提示：只是「最近一次删除」的展示，撤销统一走 undo() */
export interface Deleted {
  title: string
}

/**
 * QuestDoc 的唯一状态容器：加载、操作、撤销、保存、冲突、周切换。
 * 所有修改都通过 run()；它负责压栈、置脏、防抖保存。
 */
export function useQuestDoc() {
  const [doc, setDocState] = useState<QuestDoc | null>(null)
  const [save, setSave] = useState<SaveState>({ kind: 'idle' })
  const [blocker, setBlocker] = useState<Blocker | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [meta, setMeta] = useState<Meta | null>(null)
  const [currentWeekId, setCurrentWeekId] = useState<string | null>(null)
  const [deleted, setDeleted] = useState<Deleted | null>(null)
  const [canUndo, setCanUndo] = useState(false)
  const [focusRequest, setFocusRequest] = useState<FocusRequest | null>(null)

  const docRef = useRef<QuestDoc | null>(null)
  const dirtyRef = useRef(0)
  const savedDirtyRef = useRef(0)
  const revisionRef = useRef<string | null>(null)
  const savedAtRef = useRef(Date.now())
  const retryAtRef = useRef(0)
  const retryStepRef = useRef(0)
  const savingRef = useRef(false)
  const waitingRef = useRef(false)
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const historyRef = useRef<HistoryEntry[]>([])
  const redoRef = useRef<HistoryEntry[]>([])
  /** 每成功保存一次 +1：用来丢弃请求期间已经过期的响应 */
  const saveSeqRef = useRef(0)
  const coalesceRef = useRef<{ key: string; at: number } | null>(null)
  const blockerRef = useRef<Blocker | null>(null)
  const deletedTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const loadedWeekLabelRef = useRef('')

  const block = useCallback((kind: Blocker['kind'], text: string) => {
    if (blockerRef.current) return
    const value = { kind, text }
    blockerRef.current = value
    setBlocker(value)
  }, [])

  const persist = useCallback(async (force = false): Promise<void> => {
    if (blockerRef.current) return
    if (savingRef.current) {
      waitingRef.current = true
      return
    }
    if (dirtyRef.current === savedDirtyRef.current) return
    if (!force && Date.now() < retryAtRef.current) return
    const current = docRef.current
    if (!current) return

    savingRef.current = true
    const snapshot = dirtyRef.current
    // 保存一开始就推进代次：跨周检查若在此期间拿到响应，它已经不能代表「最新已保存版本」
    saveSeqRef.current += 1
    setSave({ kind: 'saving' })

    try {
      const response = await fetch('/api/doc', {
        method: 'PUT',
        headers: {
          'content-type': 'application/json',
          ...(revisionRef.current ? { 'if-match': `"${revisionRef.current}"` } : {}),
        },
        body: JSON.stringify(current),
      })

      if (response.status === 409 || response.status === 428) {
        setSave({ kind: 'error', message: '保存冲突' })
        block(
          'conflict',
          response.status === 409
            ? '数据已在另一个页面更新，当前改动没有保存。先复制需要保留的内容，再重新载入。'
            : '无法确认数据版本，请重新载入后再试。',
        )
        return
      }

      if (response.status === 422) {
        const payload = (await response.json().catch(() => null)) as
          | { details?: { path?: string; message?: string }[] }
          | null
        const detail =
          payload?.details
            ?.slice(0, 3)
            .map((issue) => `${issue.path || '文档'}：${issue.message ?? '不合法'}`)
            .join('；') ?? '文档结构不合法'
        setSave({ kind: 'error', message: `保存被拒绝：${detail}` })
        block(
          'conflict',
          `数据没通过校验，当前改动没有保存：${detail}。先复制需要保留的内容，再重新载入。`,
        )
        return
      }

      if (!response.ok) throw new Error(`保存失败：HTTP ${response.status}`)

      const payload = (await response.json()) as { revision?: string }
      if (payload.revision) revisionRef.current = payload.revision
      saveSeqRef.current += 1
      savedDirtyRef.current = snapshot
      savedAtRef.current = Date.now()
      retryAtRef.current = 0
      retryStepRef.current = 0
      const at = new Date().toLocaleTimeString('zh-CN', { hour12: false })
      setSave(
        dirtyRef.current === savedDirtyRef.current
          ? { kind: 'saved', at }
          : { kind: 'dirty' },
      )
    } catch (cause) {
      const delay = RETRY_DELAYS[Math.min(retryStepRef.current, RETRY_DELAYS.length - 1)]
      retryStepRef.current += 1
      retryAtRef.current = Date.now() + delay
      const detail = cause instanceof Error ? cause.message : String(cause)
      setSave({ kind: 'error', message: `保存失败，${delay / 1000} 秒后重试（${detail}）` })
    } finally {
      savingRef.current = false
      if (waitingRef.current) {
        waitingRef.current = false
        void persist()
      }
    }
  }, [block])

  const schedule = useCallback(() => {
    if (blockerRef.current) return
    dirtyRef.current += 1
    setSave((current) =>
      current.kind === 'saving' || current.kind === 'dirty' ? current : { kind: 'dirty' },
    )
    clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => void persist(), IDLE_MS)
  }, [persist])

  const pushHistory = useCallback((previous: QuestDoc, coalesceKey?: string, focusId?: string) => {
    const now = Date.now()
    if (
      coalesceKey &&
      coalesceRef.current?.key === coalesceKey &&
      now - coalesceRef.current.at < COALESCE_MS
    ) {
      coalesceRef.current = { key: coalesceKey, at: now }
      return
    }
    historyRef.current = [...historyRef.current.slice(-(HISTORY_LIMIT - 1)), { doc: previous, focusId }]
    coalesceRef.current = coalesceKey ? { key: coalesceKey, at: now } : null
    setCanUndo(true)
  }, [])

  const run = useCallback(
    <T extends object>(
      updater: (doc: QuestDoc) => (T & { doc: QuestDoc }) | null,
      options: RunOptions = {},
    ): (T & { doc: QuestDoc }) | null => {
      if (blockerRef.current) return null
      const current = docRef.current
      if (!current) return null
      const result = updater(current)
      if (!result) return null
      pushHistory(current, options.coalesceKey, options.focusId)
      // 新的修改会让「重做」失效（与编辑器通行行为一致），删除提示也随之收起
      redoRef.current = []
      setDeleted(null)
      docRef.current = result.doc
      setDocState(result.doc)
      schedule()
      return result
    },
    [pushHistory, schedule],
  )

  const focus = useCallback((id: string) => {
    setFocusRequest((prev) => ({ id, tick: (prev?.tick ?? 0) + 1 }))
  }, [])

  const undo = useCallback(() => {
    if (blockerRef.current) return
    const entry = historyRef.current.pop()
    if (!entry) return
    historyRef.current = [...historyRef.current]
    coalesceRef.current = null
    if (docRef.current) {
      redoRef.current = [...redoRef.current.slice(-(HISTORY_LIMIT - 1)), { doc: docRef.current, focusId: entry.focusId }]
    }
    docRef.current = entry.doc
    setDocState(entry.doc)
    setCanUndo(historyRef.current.length > 0)
    setDeleted(null)
    schedule()
    if (entry.focusId) focus(entry.focusId)
  }, [focus, schedule])

  const redo = useCallback(() => {
    if (blockerRef.current) return
    const entry = redoRef.current.pop()
    if (!entry) return
    redoRef.current = [...redoRef.current]
    if (docRef.current) {
      historyRef.current = [...historyRef.current.slice(-(HISTORY_LIMIT - 1)), { doc: docRef.current, focusId: entry.focusId }]
    }
    coalesceRef.current = null
    docRef.current = entry.doc
    setDocState(entry.doc)
    setCanUndo(true)
    setDeleted(null)
    schedule()
    if (entry.focusId) focus(entry.focusId)
  }, [focus, schedule])

  /**
   * 删除并给出可见撤销。撤销走的是同一套历史栈（undo），
   * toast 只是「最近一次删除」的提示，8 秒后自动收起。
   */
  const deleteWithUndo = useCallback(
    (weekId: string, questId: string) => {
      const result = run((doc) => deleteTask(doc, weekId, questId), { focusId: questId })
      if (!result) return
      clearTimeout(deletedTimerRef.current)
      setDeleted({ title: result.removed.title })
      deletedTimerRef.current = setTimeout(() => setDeleted(null), 8_000)
    },
    [run],
  )

  const flush = useCallback(async () => {
    clearTimeout(timerRef.current)
    retryAtRef.current = 0
    retryStepRef.current = 0
    await persist(true)
  }, [persist])

  const reload = useCallback(() => window.location.reload(), [])

  const focusTitle = useCallback((id: string) => focus(id), [focus])

  useEffect(() => {
    let cancelled = false

    const load = async () => {
      let loaded: {
        doc: QuestDoc
        revision: string | null
        notice: string | null
      }

      try {
        const response = await fetch('/api/rollover', { method: 'POST' })
        if (!response.ok) throw new Error(`HTTP ${response.status}`)
        const payload = (await response.json()) as {
          doc: QuestDoc
          rollover: { created: boolean; label: string; source: string | null; inherited: number; skippedHolidays: number }
          revision: string
        }
        const info = payload.rollover
        let text: string | null = null
        if (info.created) {
          const base = !info.source
            ? '本周已建立，之前没有可继承的事项'
            : info.inherited > 0
              ? `本周已从 ${info.source} 周继承 ${info.inherited} 项`
              : `本周已从 ${info.source} 周建立，那一周没有任务`
          const skipped = info.skippedHolidays > 0 ? `，跳过 ${info.skippedHolidays} 个假期周` : ''
          text = `${base}${skipped}`
        }
        loaded = { doc: payload.doc, revision: payload.revision, notice: text }
      } catch (cause) {
        const response = await fetch('/api/doc')
        if (!response.ok) throw new Error(`读取数据失败：HTTP ${response.status}`)
        const etag = response.headers.get('etag')
        const detail = cause instanceof Error ? cause.message : String(cause)
        loaded = {
          doc: (await response.json()) as QuestDoc,
          revision: etag ? etag.replace(/^W\//, '').replace(/^"|"$/g, '') : null,
          notice: `自动继承没成功，已按原数据打开：${detail}`,
        }
      }

      if (cancelled) return
      const started = performance.now()
      revisionRef.current = loaded.revision
      saveSeqRef.current += 1
      docRef.current = loaded.doc
      savedDirtyRef.current = dirtyRef.current
      savedAtRef.current = Date.now()
      loadedWeekLabelRef.current = weekRange().label
      const current = currentWeekOf(loaded.doc)
      setCurrentWeekId(current?.id ?? null)
      setDocState(loaded.doc)
      setNotice(loaded.notice)
      setMeta({
        weeks: loaded.doc.weeks.length,
        ms: Math.round(performance.now() - started),
      })
      setSave({ kind: 'loaded', at: new Date().toLocaleTimeString('zh-CN', { hour12: false }) })
    }

    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (dirtyRef.current === savedDirtyRef.current) return
      event.preventDefault()
      event.returnValue = ''
    }

    const heartbeat = setInterval(() => {
      if (blockerRef.current || savingRef.current) return
      if (dirtyRef.current === savedDirtyRef.current) return
      if (retryAtRef.current) {
        if (Date.now() < retryAtRef.current) return
      } else if (Date.now() - savedAtRef.current < MAX_UNSAVED_MS) {
        return
      }
      void persist()
    }, TICK_MS)

    let lastCheck = 0
    let checking = false
    const checkForNewWeek = async () => {
      if (cancelled || checking || blockerRef.current) return
      if (Date.now() - lastCheck < 2_000) return
      lastCheck = Date.now()
      checking = true
      try {
        if (dirtyRef.current !== savedDirtyRef.current) {
          await persist()
          if (blockerRef.current || dirtyRef.current !== savedDirtyRef.current) return
        }
        const startedSeq = saveSeqRef.current
        const response = await fetch('/api/rollover', { method: 'POST' })
        if (!response.ok) return
        const payload = (await response.json()) as {
          rollover: { created: boolean; label: string; source: string | null; inherited: number; skippedHolidays: number }
          revision: string
        }
        const outcome = weekCheckOutcome({
          startedSeq,
          currentSeq: saveSeqRef.current,
          created: payload.rollover.created,
          payloadRevision: payload.revision,
          knownRevision: revisionRef.current,
        })
        // 请求期间本页又保存过（含保存还在路上）：这份结果已过期，稍后重检
        if (outcome === 'stale') {
          lastCheck = 0
          window.setTimeout(() => void checkForNewWeek(), 1_000)
          return
        }
        if (outcome === 'created') {
          const info = payload.rollover
          const base = info.source
            ? `新的一周（${info.label}）已建立，从 ${info.source} 继承 ${info.inherited} 项`
            : `新的一周（${info.label}）已建立，没有可继承的事项`
          const skipped = info.skippedHolidays > 0 ? `，跳过 ${info.skippedHolidays} 个假期周` : ''
          block('week', `${base}${skipped}。重新载入后继续。`)
          return
        }
        if (outcome === 'conflict') {
          block('conflict', '数据已在另一个页面更新，重新载入后才能继续。')
          return
        }
        const label = weekRange().label
        if (loadedWeekLabelRef.current && label !== loadedWeekLabelRef.current) {
          block('week', `新的一周（${label}）已开始，重新载入后继续。`)
        }
      } catch {
        // 网络抖动就等下一次
      } finally {
        checking = false
      }
    }

    const onFocus = () => void checkForNewWeek()
    const onVisibility = () => {
      if (document.visibilityState === 'visible') void checkForNewWeek()
    }

    let lastWeekLabel = weekRange().label
    const weekTick = setInterval(() => {
      if (blockerRef.current) return
      const label = weekRange().label
      if (label === lastWeekLabel) return
      if (checking) return
      lastWeekLabel = label
      void checkForNewWeek()
    }, 30_000)

    void load().catch((cause: unknown) => {
      if (!cancelled) {
        setSave({ kind: 'error', message: cause instanceof Error ? cause.message : String(cause) })
      }
    })

    window.addEventListener('beforeunload', onBeforeUnload)
    window.addEventListener('focus', onFocus)
    document.addEventListener('visibilitychange', onVisibility)
    const heartbeatTimer = heartbeat

    return () => {
      cancelled = true
      clearTimeout(timerRef.current)
      clearTimeout(deletedTimerRef.current)
      clearInterval(heartbeatTimer)
      clearInterval(weekTick)
      window.removeEventListener('beforeunload', onBeforeUnload)
      window.removeEventListener('focus', onFocus)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [block, flush, persist])

  return {
    doc,
    meta,
    save,
    blocker,
    notice,
    currentWeekId,
    deleted,
    canUndo,
    focusRequest,
    run,
    undo,
    redo,
    deleteWithUndo,
    flush,
    reload,
    focusTitle,
  }
}
