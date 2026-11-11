export interface LinkSegment {
  text: string
  href?: string
}

// RFC 3986 允许的 ASCII 字符；遇到空白、中文、emoji 等字符就停止，避免吞掉后续文本
const URL_PATTERN = /\bhttps?:\/\/[A-Za-z0-9\-._~:/?#\[\]@!$&'()*+,;=%]+/gi

const TRAILING_PUNCTUATION = new Set([
  '.',
  ',',
  ';',
  ':',
  '!',
  '?',
  '，',
  '。',
  '；',
  '：',
  '！',
  '？',
  '、',
  '"',
  "'",
  '”',
  '’',
])

function trimTrailingPunctuation(value: string): string {
  let end = value.length
  while (end > 0 && TRAILING_PUNCTUATION.has(value[end - 1])) end -= 1
  return value.slice(0, end)
}

function trimUnbalancedBrackets(value: string): string {
  let result = value
  for (const [open, close] of [
    ['(', ')'],
    ['[', ']'],
    ['{', '}'],
  ] as const) {
    let opens = 0
    let closes = 0
    for (const char of result) {
      if (char === open) opens += 1
      else if (char === close) closes += 1
    }
    while (closes > opens && result.endsWith(close)) {
      result = result.slice(0, -1)
      closes -= 1
    }
  }
  return result
}

function trimUrl(raw: string): { href: string; suffix: string } {
  let href = raw
  for (;;) {
    const next = trimUnbalancedBrackets(trimTrailingPunctuation(href))
    if (next === href) break
    href = next
  }
  return { href, suffix: raw.slice(href.length) }
}

/** 去掉末尾标点后还要有主机部分，避免把 https://. 之类的残片变成链接 */
function isUsableHref(href: string): boolean {
  const rest = href.replace(/^https?:\/\//i, '')
  return rest.length > 0 && !/^[\/?#]/.test(rest)
}

/** 把纯文本按 http(s) URL 切成普通文本和链接片段；不改原文，只用于展示 */
export function linkifyText(text: string): LinkSegment[] {
  const segments: LinkSegment[] = []
  const appendText = (value: string) => {
    if (!value) return
    const last = segments[segments.length - 1]
    if (last && !last.href) {
      last.text += value
      return
    }
    segments.push({ text: value })
  }

  let cursor = 0
  for (const match of text.matchAll(URL_PATTERN)) {
    const index = match.index ?? 0
    if (index > cursor) appendText(text.slice(cursor, index))
    const raw = match[0]
    const { href, suffix } = trimUrl(raw)
    if (isUsableHref(href)) {
      segments.push({ text: href, href })
      appendText(suffix)
    } else {
      appendText(raw)
    }
    cursor = index + raw.length
  }
  if (cursor < text.length) appendText(text.slice(cursor))
  return segments
}
