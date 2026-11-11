import { describe, expect, it } from 'vitest'

import { linkifyText } from './linkify'

describe('linkifyText', () => {
  it('没有链接时原样返回', () => {
    expect(linkifyText('普通文本，没有链接')).toEqual([{ text: '普通文本，没有链接' }])
    expect(linkifyText('')).toEqual([])
  })

  it('识别文字后面的单个 http(s) 链接', () => {
    expect(linkifyText('参考 https://example.com/docs')).toEqual([
      { text: '参考 ' },
      { text: 'https://example.com/docs', href: 'https://example.com/docs' },
    ])
    expect(linkifyText('HTTP://EXAMPLE.COM/A')).toEqual([
      { text: 'HTTP://EXAMPLE.COM/A', href: 'HTTP://EXAMPLE.COM/A' },
    ])
  })

  it('保留链接前后的文本和换行', () => {
    expect(linkifyText('第一行 https://a.example/x\n第二行 https://b.example/y')).toEqual([
      { text: '第一行 ' },
      { text: 'https://a.example/x', href: 'https://a.example/x' },
      { text: '\n第二行 ' },
      { text: 'https://b.example/y', href: 'https://b.example/y' },
    ])
  })

  it('把链接末尾的标点留在文本里', () => {
    expect(linkifyText('看 https://example.com/a。')).toEqual([
      { text: '看 ' },
      { text: 'https://example.com/a', href: 'https://example.com/a' },
      { text: '。' },
    ])
    expect(linkifyText('https://example.com/a, 后面')).toEqual([
      { text: 'https://example.com/a', href: 'https://example.com/a' },
      { text: ', 后面' },
    ])
  })

  it('不吞掉紧贴在 URL 后面的中文和中文标点', () => {
    expect(linkifyText('https://example.com/a后面')).toEqual([
      { text: 'https://example.com/a', href: 'https://example.com/a' },
      { text: '后面' },
    ])
    expect(linkifyText('https://example.com/a，后面')).toEqual([
      { text: 'https://example.com/a', href: 'https://example.com/a' },
      { text: '，后面' },
    ])
  })

  it('不吞掉 URL 后面的 emoji 和其它非 ASCII 字符', () => {
    expect(linkifyText('https://example.com/a😀后面')).toEqual([
      { text: 'https://example.com/a', href: 'https://example.com/a' },
      { text: '😀后面' },
    ])
  })

  it('保留查询串、锚点和结尾斜杠', () => {
    expect(linkifyText('https://x.com/a?b=1&c=2#d/')).toEqual([
      { text: 'https://x.com/a?b=1&c=2#d/', href: 'https://x.com/a?b=1&c=2#d/' },
    ])
  })

  it('括号配对：保留 URL 自带的括号，去掉句子的右括号', () => {
    expect(linkifyText('见 https://en.wikipedia.org/wiki/Foo_(bar)')).toEqual([
      { text: '见 ' },
      {
        text: 'https://en.wikipedia.org/wiki/Foo_(bar)',
        href: 'https://en.wikipedia.org/wiki/Foo_(bar)',
      },
    ])
    expect(linkifyText('(见 https://example.com/a)')).toEqual([
      { text: '(见 ' },
      { text: 'https://example.com/a', href: 'https://example.com/a' },
      { text: ')' },
    ])
  })

  it('没有主机的 http:// 不产生链接', () => {
    expect(linkifyText('http:// 不是链接')).toEqual([{ text: 'http:// 不是链接' }])
    expect(linkifyText('https://')).toEqual([{ text: 'https://' }])
  })

  it('不把残缺 URL、非 http 协议和邮箱变成链接', () => {
    for (const text of [
      'https://.',
      'https://?q=1',
      'javascript:alert(1)',
      'data:text/html,x',
      'a@example.com',
    ]) {
      expect(linkifyText(text).some((segment) => segment.href)).toBe(false)
    }
  })

  it('保留百分号编码，去掉不配对的右括号', () => {
    expect(linkifyText('https://x.com/a%20b')).toEqual([
      { text: 'https://x.com/a%20b', href: 'https://x.com/a%20b' },
    ])
    expect(linkifyText('https://x.com/a]')).toEqual([
      { text: 'https://x.com/a', href: 'https://x.com/a' },
      { text: ']' },
    ])
  })

  it('不识别裸域名、mailto 和 ftp', () => {
    for (const text of ['www.example.com', 'mailto:a@example.com', 'ftp://example.com/a']) {
      expect(linkifyText(text).some((segment) => segment.href)).toBe(false)
    }
  })
})
