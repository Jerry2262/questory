import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent, RefObject } from 'react'

import { progressOf, statusOf } from './model/derive'
import {
  addSibling,
  addTask,
  indentTask,
  moveTask,
  outdentTask,
  setHeader,
  setNote,
  setReview,
  setWeekLabel,
  setWeekKind,
  setWeekNote,
  setTitle,
  setVoid,
  toggleStatus,
} from './model/ops'
import { QUADRANT_KEYS, QUADRANT_TITLES } from './model/types'
import type { Quadrant, QuadrantKey, Quest, QuestDoc, Week } from './model/types'
import { useQuestDoc } from './useQuestDoc'

type Store = ReturnType<typeof useQuestDoc>

/** 空行：没有标题、备注和子任务，退格时删掉不会有信息损失 */
function isEmptyLeaf(quest: Quest): boolean {
  return !quest.title.trim() && !quest.note?.trim() && quest.children.length === 0
}

/** 文档顺序里上一条任务的 id（象限按固定顺序，深度优先），用于删行后接续焦点 */
function previousQuestId(doc: QuestDoc | null, weekId: string, questId: string): string | null {
  const week = doc?.weeks.find((item) => item.id === weekId)
  if (!week) return null
  const ids: string[] = []
  const walk = (list: Quest[]) => {
    for (const item of list) {
      ids.push(item.id)
      walk(item.children)
    }
  }
  for (const key of QUADRANT_KEYS) {
    const quadrant = week.quadrants.find((item) => item.key === key)
    if (quadrant) walk(quadrant.children)
  }
  const index = ids.indexOf(questId)
  return index > 0 ? ids[index - 1] : null
}

function useAutoGrow(ref: RefObject<HTMLTextAreaElement | null>, value: string) {
  const observerRef = useRef<ResizeObserver | null>(null)
  const observedRef = useRef<HTMLTextAreaElement | null>(null)

  const resize = () => {
    const element = ref.current
    if (!element) return
    element.style.height = 'auto'
    element.style.height = `${element.scrollHeight}px`
  }

  useLayoutEffect(resize, [ref, value])

  // 窗口变窄会多折行，只在内容变化时算高度会裁掉下半段：宽度变化也要重算。
  // 备注是条件渲染的，元素会在挂载后出现/消失，所以每次渲染都检查一次当前元素。
  useEffect(() => {
    const element = ref.current
    if (!element || typeof ResizeObserver === 'undefined') return
    if (observedRef.current === element && observerRef.current) return
    observerRef.current?.disconnect()
    let lastWidth = element.clientWidth
    const observer = new ResizeObserver(() => {
      if (element.clientWidth === lastWidth) return
      lastWidth = element.clientWidth
      resize()
    })
    observer.observe(element)
    observerRef.current = observer
    observedRef.current = element
  })

  useEffect(
    () => () => {
      observerRef.current?.disconnect()
      observerRef.current = null
      observedRef.current = null
    },
    [],
  )
}

/**
 * 结构化任务树的编辑界面。所有改动走 useQuestDoc 的操作层；
 * 这里只负责输入、菜单、快捷键和保存状态展示。
 */
export default function TreeApp() {
  const store = useQuestDoc()
  // 全局监听只注册一次；用 ref 取最新 store，避免闭包里拿到首帧的空文档
  const storeRef = useRef(store)
  storeRef.current = store

  useEffect(() => {
    /**
     * 周标题是草稿态字段（失焦才提交），而全局快捷键在 capture 阶段先于输入框执行，
     * 所以草稿相关的处理必须在这里统一做，否则会出现「先撤销了文档、再撤草稿」或
     * 「先 flush 旧文档、再提交草稿」的顺序错误。
     */
    const weekDraftField = (event: globalThis.KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      const field = target?.closest?.('textarea.week-label') as HTMLTextAreaElement | null
      if (!field) return null
      const weekId = field.closest('h2[data-week-id]')?.getAttribute('data-week-id')
      const week = weekId ? storeRef.current.doc?.weeks.find((item) => item.id === weekId) : undefined
      if (!week) return null
      // 草稿判断用原始字符串：只改首尾空格也算草稿，撤销应先清掉它；trim 只发生在提交时
      return field.value === week.label ? null : field
    }

    const onKey = (event: globalThis.KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey)) return
      const key = event.key.toLowerCase()
      const isUndo = key === 'z' && !event.shiftKey
      const isRedo = (key === 'z' && event.shiftKey) || key === 'y'
      const isSave = key === 's'
      if (!isUndo && !isRedo && !isSave) return
      if (event.isComposing) return
      const target = event.target as HTMLElement | null
      // 周跳转的筛选框不是文档内容，交给浏览器；文档内的输入框一律走同一套快照撤销/重做，
      // 否则浏览器原生撤销会在焦点换行后作用到别的输入框上（撤销的是一段文字而不是刚加的行）
      if (target?.closest('.week-jump-panel')) return

      if (isSave) {
        event.preventDefault()
        // 草稿先提交（同步更新文档），紧接着的 flush 才会保存新标题
        weekDraftField(event)?.dispatchEvent(new CustomEvent('questory:commit-week-draft'))
        void storeRef.current.flush()
        return
      }

      const pendingDraft = weekDraftField(event)
      if (pendingDraft) {
        // 有未提交草稿时，撤销/重做只作用于草稿，不碰文档
        event.preventDefault()
        pendingDraft.dispatchEvent(new CustomEvent('questory:reset-week-draft'))
        return
      }

      event.preventDefault()
      if (isRedo) storeRef.current.redo()
      else storeRef.current.undo()
    }
    window.addEventListener('keydown', onKey, { capture: true })
    return () => window.removeEventListener('keydown', onKey, { capture: true })
  }, [])

  useEffect(() => {
    const request = store.focusRequest
    if (!request) return
    const selector = `[data-quest-id="${request.id}"] textarea.quest-title`
    const element = document.querySelector<HTMLTextAreaElement>(selector)
    if (!element) return
    element.focus()
    const end = element.value.length
    element.setSelectionRange(end, end)
  }, [store.focusRequest])

  if (store.save.kind === 'error' && !store.doc) {
    return (
      <div className="app">
        <div className="page">
          <main className="page-body">
            <p className="page-error">{store.save.message}</p>
          </main>
        </div>
      </div>
    )
  }

  return (
    <div className="app">
      <div className="page">
        <PageHeader store={store} />
        <main className="page-body">
          {store.blocker ? (
            <div className={`page-blocker is-${store.blocker.kind}`}>
              <span>{store.blocker.text}</span>
              <button type="button" onClick={store.reload}>
                重新载入
              </button>
            </div>
          ) : store.notice ? (
            <p className="page-notice">{store.notice}</p>
          ) : null}

          {store.doc ? (
            <div className="tree">
              <HeaderEditor store={store} />
              {store.doc.weeks.map((week, index) => (
                <WeekView
                  key={week.id}
                  week={week}
                  isCurrent={week.id === store.currentWeekId}
                  isNewest={index === 0}
                  store={store}
                />
              ))}
            </div>
          ) : (
            <p className="page-loading">载入中…</p>
          )}
        </main>
      </div>
      {store.deleted ? (
        <div className="quest-undo-toast" role="status">
          <span>已删除「{store.deleted.title || '未命名任务'}」</span>
          <button type="button" onClick={store.undo}>
            撤销
          </button>
        </div>
      ) : null}
      <BackToTop />
    </div>
  )
}

/** 长页面回顶：滚过约一屏后出现在右下角，点击平滑回到顶部；隐藏时不渲染，避免误聚焦 */
function BackToTop() {
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    const onScroll = () => setVisible(window.scrollY > window.innerHeight * 0.9)
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  if (!visible) return null

  return (
    <button
      type="button"
      className="back-to-top"
      aria-label="回到顶部"
      title="回到顶部"
      onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
    >
      ↑
    </button>
  )
}

function PageHeader({ store }: { store: Store }) {
  return (
    <header className="page-head">
      <h1>Questory</h1>
      <p className="page-meta">
        {store.meta ? `${store.meta.weeks} 周` : '载入中…'}
        <WeekJump weeks={store.doc?.weeks ?? []} currentWeekId={store.currentWeekId} />
        {store.meta && <span className="page-timing">首屏 {store.meta.ms} ms</span>}
        <SaveStatus save={store.save} onSave={() => void store.flush()} />
      </p>
      <p className="page-legend">
        <span className="legend-item">
          <span className="legend-mark">☐</span>未完成
        </span>
        <span className="legend-item">
          <span className="legend-mark" data-qstatus="done">
            ✓
          </span>
          完成
        </span>
        <span className="legend-item">
          <span className="legend-mark">—</span>失效
        </span>
        <span className="legend-note">
          勾选框切换未完成/完成；作废、备注、移动、删除在行尾 ⋮ 菜单；Enter 加下一条，Tab/Shift+Tab 缩进
        </span>
      </p>
    </header>
  )
}

function SaveStatus({ save, onSave }: { save: Store['save']; onSave: () => void }) {
  const text =
    save.kind === 'loaded'
      ? `已同步 ${save.at}`
      : save.kind === 'dirty'
        ? '有改动未保存'
        : save.kind === 'saving'
          ? '保存中…'
          : save.kind === 'saved'
            ? `已保存 ${save.at}`
            : save.kind === 'error'
              ? save.message
              : ''

  return (
    <span className="page-save-group">
      <span className={`page-save${save.kind === 'error' ? ' is-error' : ''}`}>{text}</span>
      <button
        type="button"
        className="save-button"
        onClick={onSave}
        disabled={save.kind === 'saving'}
        title="立即保存（Ctrl/Cmd+S）"
      >
        保存
      </button>
    </span>
  )
}

/**
 * 周跳转：顶部输入框输入即筛（命令面板式），空输入时按月分组展示周格子（迷你日历式）。
 * Esc 或点击外部关闭，Enter 跳到第一条匹配。
 */
function WeekJump({ weeks, currentWeekId }: { weeks: Week[]; currentWeekId: string | null }) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const rootRef = useRef<HTMLSpanElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!open) return
    inputRef.current?.focus()
    const onPointerDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  const jump = (weekId: string) => {
    document
      .querySelector(`.tree h2[data-week-id="${weekId}"]`)
      ?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    setOpen(false)
    setQuery('')
  }

  // 标签形如 `2026 10.26-11.1`，按起始年、月分组；组内保持页面的新→旧顺序
  const groups: Array<{ key: string; label: string; weeks: Week[] }> = []
  for (const week of weeks) {
    const match = /^(\d{4}) (\d+)\./.exec(week.label)
    const key = match ? `${match[1]}-${match[2]}` : 'other'
    const label = match ? `${match[1]} 年 ${match[2]} 月` : '其他'
    const last = groups[groups.length - 1]
    if (last?.key === key) last.weeks.push(week)
    else groups.push({ key, label, weeks: [week] })
  }
  const trimmed = query.trim()
  const matches = trimmed ? weeks.filter((week) => week.label.includes(trimmed)) : []

  return (
    <span className="week-jump" ref={rootRef}>
      <button
        type="button"
        className="week-jump-trigger"
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => setOpen((value) => !value)}
      >
        跳转到周<span className="week-jump-caret">▾</span>
      </button>
      {open ? (
        <div className="week-jump-panel" role="dialog" aria-label="跳转到指定周">
          <input
            ref={inputRef}
            className="week-jump-input"
            value={query}
            placeholder="输入月份或日期，如 10.26"
            aria-label="筛选周"
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key !== 'Enter') return
              event.preventDefault()
              const target = trimmed ? matches[0] : weeks[0]
              if (target) jump(target.id)
            }}
          />
          {trimmed ? (
            <div className="week-jump-list">
              {matches.length ? (
                matches.map((week) => (
                  <button
                    key={week.id}
                    type="button"
                    className="week-jump-item"
                    data-current={week.id === currentWeekId}
                    onClick={() => jump(week.id)}
                  >
                    {week.label}
                    {week.id === currentWeekId ? <span className="week-jump-now">本周</span> : null}
                  </button>
                ))
              ) : (
                <p className="week-jump-empty">没有匹配的周</p>
              )}
            </div>
          ) : (
            <div className="week-jump-calendar">
              {groups.map((group) => (
                <div key={group.key}>
                  <span className="week-jump-month-label">{group.label}</span>
                  <span className="week-jump-chips">
                    {group.weeks.map((week) => (
                      <button
                        key={week.id}
                        type="button"
                        className="week-jump-chip"
                        data-current={week.id === currentWeekId}
                        title={week.label}
                        onClick={() => jump(week.id)}
                      >
                        {/^\d{4} \d+\.(\d+)/.exec(week.label)?.[1] ?? week.label}
                      </button>
                    ))}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      ) : null}
    </span>
  )
}

function HeaderEditor({ store }: { store: Store }) {
  const value = (store.doc?.header ?? []).join('\n')
  const ref = useRef<HTMLTextAreaElement>(null)
  useAutoGrow(ref, value)

  return (
    <blockquote className="header-editor">
      <textarea
        ref={ref}
        className="header-field"
        rows={1}
        value={value}
        spellCheck={false}
        onChange={(event) =>
          store.run((doc) => setHeader(doc, event.target.value.split('\n')), {
            coalesceKey: 'header',
          })
        }
        aria-label="顶部说明"
      />
    </blockquote>
  )
}

function WeekView({
  week,
  isCurrent,
  isNewest,
  store,
}: {
  week: Week
  isCurrent: boolean
  isNewest: boolean
  store: Store
}) {
  const visible = isCurrent || isNewest
  const reviewRef = useRef<HTMLTextAreaElement>(null)
  useAutoGrow(reviewRef, week.review ?? '')
  // 四象限对所有普通周常驻（DESIGN.md §3：空象限展示时补出）；
  // 假期周整周暂停，不渲染象限。添加入口的常驻/悬停差异由 visible 控制，与此无关。
  const quadrants =
    week.kind === 'holiday'
      ? []
      : QUADRANT_KEYS.map(
          (key) => week.quadrants.find((quadrant) => quadrant.key === key) ?? { key, children: [] },
        )

  return (
    <>
      <h2
        data-week-kind={week.kind === 'holiday' ? 'holiday' : undefined}
        data-week-id={week.id}
      >
        <WeekHeading week={week} store={store} />
      </h2>
      {quadrants.map((quadrant) => (
        <QuadrantView
          key={quadrant.key}
          weekId={week.id}
          quadrant={quadrant}
          persistentAdd={visible}
          store={store}
        />
      ))}
      <blockquote className="review-editor">
        <textarea
          ref={reviewRef}
          className="review-field"
          rows={1}
          value={week.review ?? ''}
          placeholder="总结"
          spellCheck={false}
          onChange={(event) =>
            store.run((doc) => setReview(doc, week.id, event.target.value), {
              coalesceKey: `review:${week.id}`,
            })
          }
          aria-label="总结"
        />
      </blockquote>
    </>
  )
}

function WeekHeading({ week, store }: { week: Week; store: Store }) {
  const [draft, setDraft] = useState(week.label)
  const labelRef = useRef<HTMLTextAreaElement>(null)
  const noteRef = useRef<HTMLTextAreaElement>(null)
  useAutoGrow(labelRef, draft)
  useAutoGrow(noteRef, week.note ?? '')

  // 撤销/外部更新时同步草稿
  useEffect(() => {
    setDraft(week.label)
  }, [week.label])

  /** 标签有格式约束，本地草稿改，失焦/回车时整段提交；解析不过就退回原文 */
  const commitLabel = () => {
    const next = draft.trim()
    if (!next || next === week.label) {
      setDraft(week.label)
      return
    }
    const ok = store.run((doc) => setWeekLabel(doc, week.id, next))
    if (!ok) setDraft(week.label)
  }

  // 全局快捷键在 capture 阶段执行，这里只接收它的意图：撤草稿 / 提交草稿
  const draftRef = useRef(draft)
  draftRef.current = draft

  useEffect(() => {
    const element = labelRef.current
    if (!element) return
    const reset = () => setDraft(week.label)
    const commit = () => {
      const next = draftRef.current.trim()
      if (!next || next === week.label) {
        setDraft(week.label)
        return
      }
      const ok = store.run((doc) => setWeekLabel(doc, week.id, next))
      if (!ok) setDraft(week.label)
    }
    element.addEventListener('questory:reset-week-draft', reset)
    element.addEventListener('questory:commit-week-draft', commit)
    return () => {
      element.removeEventListener('questory:reset-week-draft', reset)
      element.removeEventListener('questory:commit-week-draft', commit)
    }
  }, [store, week.id, week.label])

  const onKeyDown = (event: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    if (event.nativeEvent.isComposing) return
    // 周级别不产生任何结构（DESIGN.md §4）：Enter/Escape 只失焦
    if (event.key === 'Enter' || event.key === 'Escape') {
      event.preventDefault()
      event.currentTarget.blur()
    }
  }

  const hasNote = !!week.note?.trim()

  return (
    <>
      <textarea
        ref={labelRef}
        className="week-field week-label"
        rows={1}
        value={draft}
        spellCheck={false}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commitLabel}
        onKeyDown={onKeyDown}
        aria-label="周标题"
      />
      <span className={`week-note-wrap${hasNote ? ' has-note' : ''}`}>
        <textarea
          ref={noteRef}
          className="week-field week-note"
          rows={1}
          value={week.note ?? ''}
          spellCheck={false}
          onChange={(event) =>
            store.run((doc) => setWeekNote(doc, week.id, event.target.value), {
              coalesceKey: `week-note:${week.id}`,
            })
          }
          onKeyDown={onKeyDown}
          aria-label="周备注"
        />
      </span>
      <button
        type="button"
        className="week-kind-toggle"
        onClick={() =>
          store.run((doc) => setWeekKind(doc, week.id, week.kind === 'holiday' ? 'normal' : 'holiday'))
        }
        title={week.kind === 'holiday' ? '取消跳过，恢复为普通周' : '标记后下一周继承时跳过本周，本周内容保留'}
      >
        {week.kind === 'holiday' ? '恢复这周' : '跳过这周'}
      </button>
    </>
  )
}

function QuadrantView({
  weekId,
  quadrant,
  persistentAdd,
  store,
}: {
  weekId: string
  quadrant: Quadrant
  persistentAdd: boolean
  store: Store
}) {
  const add = () => {
    const result = store.run((doc) => addTask(doc, weekId, quadrant.key))
    if (result) store.focusTitle(result.id)
  }

  return (
    <section data-quadrant={quadrant.key}>
      <h3>
        {QUADRANT_TITLES[quadrant.key]}
        <button
          type="button"
          className={`quest-add${persistentAdd ? ' is-current-week' : ''}`}
          onClick={add}
          title="在这个象限里加一条任务"
        >
          + 添加任务
        </button>
      </h3>

      {quadrant.children.length ? (
        <ul>
          {quadrant.children.map((quest) => (
            <QuestRow
              key={quest.id}
              quest={quest}
              weekId={weekId}
              quadrantKey={quadrant.key}
              store={store}
            />
          ))}
        </ul>
      ) : null}
    </section>
  )
}

function QuestRow({
  quest,
  weekId,
  quadrantKey,
  store,
}: {
  quest: Quest
  weekId: string
  quadrantKey: QuadrantKey
  store: Store
}) {
  const [menuOpen, setMenuOpen] = useState(false)
  const [menuTop, setMenuTop] = useState<number | null>(null)
  const [noteOpen, setNoteOpen] = useState(false)
  const titleRef = useRef<HTMLTextAreaElement>(null)
  const noteRef = useRef<HTMLTextAreaElement>(null)
  const rowRef = useRef<HTMLParagraphElement>(null)

  const status = statusOf(quest)
  const progress = quest.children.length ? progressOf(quest) : null
  const mark = status === 'done' ? '✓' : status === 'void' ? '—' : '☐'
  const noteVisible = noteOpen || !!quest.note?.trim()

  useAutoGrow(titleRef, quest.title)
  useAutoGrow(noteRef, quest.note ?? '')

  const focusNote = () => {
    setNoteOpen(true)
    window.setTimeout(() => noteRef.current?.focus(), 0)
  }

  const onTitleKeyDown = (event: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    if (event.nativeEvent.isComposing) return
    if (event.key === 'Backspace' && isEmptyLeaf(quest)) {
      // 空行退格删行：复用 ⋮ 的删除（同一操作 + 8 秒撤销），焦点回到上一条
      event.preventDefault()
      const previous = previousQuestId(store.doc, weekId, quest.id)
      store.deleteWithUndo(weekId, quest.id)
      if (previous) store.focusTitle(previous)
      return
    }
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      const result = store.run((doc) => addSibling(doc, weekId, quest.id))
      if (result) store.focusTitle(result.id)
      return
    }
    if (event.key === 'Tab') {
      event.preventDefault()
      const result = event.shiftKey
        ? store.run((doc) => outdentTask(doc, weekId, quest.id), { focusId: quest.id })
        : store.run((doc) => indentTask(doc, weekId, quest.id), { focusId: quest.id })
      if (result) store.focusTitle(quest.id)
      return
    }
    if (event.key === 'Escape') event.currentTarget.blur()
  }

  return (
    <li data-quest-id={quest.id}>
      <p ref={rowRef}>
        <button
          type="button"
          className="quest-check"
          data-qstatus={status}
          disabled={quest.children.length > 0 || status === 'void'}
          onClick={() => store.run((doc) => toggleStatus(doc, weekId, quest.id), { focusId: quest.id })}
          aria-label={status === 'done' ? '标记未完成' : '标记完成'}
        >
          <span className="quest-check-mark">{mark}</span>
        </button>
        <textarea
          ref={titleRef}
          className="quest-title"
          rows={1}
          value={quest.title}
          placeholder="新任务"
          spellCheck={false}
          onChange={(event) =>
            store.run((doc) => setTitle(doc, weekId, quest.id, event.target.value), {
              coalesceKey: `title:${quest.id}`,
              focusId: quest.id,
            })
          }
          onKeyDown={onTitleKeyDown}
          aria-label="任务标题"
        />
        <span className="quest-tail">
          {progress ? (
            <span className="quest-progress">
              {progress.done}/{progress.total}
            </span>
          ) : null}
          <button
            type="button"
            className="quest-move"
            aria-label="任务操作"
            aria-expanded={menuOpen}
            onClick={() => {
              // 菜单相对 li 定位，而 li 包含整棵子树：用标题行高度把它锚到行下方
              if (!menuOpen) setMenuTop((rowRef.current?.offsetHeight ?? 0) + 2)
              setMenuOpen(!menuOpen)
            }}
          >
            ⋮
          </button>
        </span>
      </p>

      {menuOpen ? (
        <div
          className="quest-menu"
          role="menu"
          style={menuTop == null ? undefined : { top: menuTop }}
        >
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setMenuOpen(false)
              focusNote()
            }}
          >
            {quest.note?.trim() ? '编辑备注' : '添加备注'}
          </button>
          <div className="quest-menu-label">移动到</div>
          {QUADRANT_KEYS.filter((key) => key !== quadrantKey).map((key) => (
            <button
              type="button"
              key={key}
              role="menuitem"
              onClick={() => {
                setMenuOpen(false)
                const result = store.run((doc) => moveTask(doc, weekId, quest.id, key), { focusId: quest.id })
                if (result) store.focusTitle(quest.id)
              }}
            >
              {QUADRANT_TITLES[key]}
            </button>
          ))}
          <div className="quest-menu-separator" />
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setMenuOpen(false)
              store.run((doc) => setVoid(doc, weekId, quest.id, status !== 'void'), { focusId: quest.id })
            }}
          >
            {status === 'void' ? '恢复' : '作废'}
          </button>
          <button
            type="button"
            role="menuitem"
            className="is-danger"
            onClick={() => {
              setMenuOpen(false)
              store.deleteWithUndo(weekId, quest.id)
            }}
          >
            删除整条
          </button>
        </div>
      ) : null}

      {noteVisible ? (
        <p className="quest-note-field">
          <textarea
            ref={noteRef}
            className="note-field"
            rows={1}
            value={quest.note ?? ''}
            placeholder="备注"
            spellCheck={false}
            onChange={(event) =>
              store.run((doc) => setNote(doc, weekId, quest.id, event.target.value), {
                coalesceKey: `note:${quest.id}`,
                focusId: quest.id,
              })
            }
            onBlur={() => setNoteOpen(false)}
            aria-label="备注"
          />
        </p>
      ) : null}

      {quest.children.length ? (
        <ul>
          {quest.children.map((child) => (
            <QuestRow
              key={child.id}
              quest={child}
              weekId={weekId}
              quadrantKey={quadrantKey}
              store={store}
            />
          ))}
        </ul>
      ) : null}
    </li>
  )
}
