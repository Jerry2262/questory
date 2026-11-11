import { useState } from 'react'
import type { KeyboardEventHandler, RefObject } from 'react'

import { linkifyText } from './linkify'

interface LinkTextFieldProps {
  textareaRef: RefObject<HTMLTextAreaElement | null>
  value: string
  ariaLabel: string
  className?: string
  wrapperClassName?: string
  placeholder?: string
  rows?: number
  spellCheck?: boolean
  onValueChange: (value: string) => void
  onKeyDown?: KeyboardEventHandler<HTMLTextAreaElement>
  onBlur?: () => void
}

/**
 * 可编辑文本域 + 链接展示层。
 * 失焦时把 http(s) URL 渲染成可点击链接；聚焦后隐藏展示层，回到普通 textarea。
 * 数据始终是纯文本，链接只是显示层识别。
 */
export function LinkTextField({
  textareaRef,
  value,
  ariaLabel,
  className,
  wrapperClassName,
  placeholder,
  rows,
  spellCheck,
  onValueChange,
  onKeyDown,
  onBlur,
}: LinkTextFieldProps) {
  const [focused, setFocused] = useState(false)
  const segments = linkifyText(value)
  const hasLinks = segments.some((segment) => segment.href)
  const mirrored = hasLinks && !focused

  return (
    <span className={`link-field${wrapperClassName ? ` ${wrapperClassName}` : ''}`}>
      {mirrored ? (
        <span className="link-field-view">
          {segments.map((segment, index) =>
            segment.href ? (
              <a
                key={index}
                href={segment.href}
                target="_blank"
                rel="noopener noreferrer"
                title={segment.href}
              >
                {segment.text}
              </a>
            ) : (
              <span key={index}>{segment.text}</span>
            ),
          )}
        </span>
      ) : null}
      <textarea
        ref={textareaRef}
        className={`${className ?? ''}${mirrored ? ' is-mirrored' : ''}`}
        value={value}
        rows={rows}
        placeholder={placeholder}
        spellCheck={spellCheck}
        aria-label={ariaLabel}
        onChange={(event) => onValueChange(event.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => {
          setFocused(false)
          onBlur?.()
        }}
        onKeyDown={onKeyDown}
      />
    </span>
  )
}
