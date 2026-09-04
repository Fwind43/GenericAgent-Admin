import React from 'react'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { ChatMessage } from './ChatApp.jsx'

afterEach(() => cleanup())

describe('chat file attachments', () => {
  test('renders image uploads with the responsive message image classes', () => {
    const { container } = render(
      <ChatMessage
        message={{
          id:'u-image',
          role:'user',
          content:'See image',
          files:[{ name:'large-photo.jpg', type:'image/jpeg', url:'data:image/jpeg;base64,AA==' }],
          created_at:0,
        }}
        pending={false}
        onAskReply={vi.fn()}
      />,
    )

    const gallery = container.querySelector('.oa-msg-images')
    const image = container.querySelector('.oa-msg-image')
    expect(gallery).toBeTruthy()
    expect(image).toBeTruthy()
    expect(image.getAttribute('src')).toBe('data:image/jpeg;base64,AA==')
    expect(image.getAttribute('alt')).toBe('large-photo.jpg')
    const imageLink = container.querySelector('.oa-msg-image-link')
    expect(imageLink).toBeTruthy()
    expect(imageLink.getAttribute('href')).toBe('data:image/jpeg;base64,AA==')
    expect(imageLink.getAttribute('target')).toBe('_blank')
  })

  test('renders a saved non-image upload as a file path card', () => {
    const content = 'Review this\n\n[附件已保存]\n[FILE:C:/tmp/report.pdf]'
    const { container } = render(
      <ChatMessage
        message={{ id:'u-file', role:'user', content, files:[], created_at:0 }}
        pending={false}
        onAskReply={vi.fn()}
      />,
    )

    expect(screen.getByText('Review this')).toBeTruthy()
    expect(screen.getByText('report.pdf')).toBeTruthy()
    expect(container.querySelector('.oa-message-files')).toBeTruthy()
    expect(container.textContent).not.toContain('[FILE:')
  })

  test('renders assistant FILE output as a remote download link', () => {
    render(
      <ChatMessage
        message={{ id:'a-file', role:'assistant', content:'Done\n\n[FILE:C:/tmp/report.pdf]', created_at:0 }}
        pending={false}
        onAskReply={vi.fn()}
      />,
    )

    expect(screen.getByText('Done')).toBeTruthy()
    expect(screen.getByText('report.pdf')).toBeTruthy()
    const download = screen.getByRole('link', { name:'下载文件 report.pdf' })
    expect(download.getAttribute('href')).toBe('/api/files/download?path=C%3A%2Ftmp%2Freport.pdf')
    expect(download.getAttribute('download')).toBe('report.pdf')
  })

  test('renders markdown link with local path as a downloadable link with action buttons', () => {
    const { container } = render(
      <ChatMessage
        message={{ id:'a-link', role:'assistant', content:'请查阅 [业务报告](D:\\Work\\final_report.pdf) 以及 [说明文档](file:///C:/docs/spec.docx)', created_at:0 }}
        pending={false}
        onAskReply={vi.fn()}
      />,
    )

    expect(screen.getByText('业务报告')).toBeTruthy()
    expect(screen.getByText('说明文档')).toBeTruthy()

    const links = container.querySelectorAll('.oa-md-file-link')
    expect(links.length).toBe(2)
    expect(links[0].getAttribute('href')).toBe('/api/files/download?path=D%3A%5CWork%5Cfinal_report.pdf')
    expect(links[0].getAttribute('download')).toBe('final_report.pdf')

    expect(links[1].getAttribute('href')).toBe('/api/files/download?path=C%3A%2Fdocs%2Fspec.docx')
    expect(links[1].getAttribute('download')).toBe('spec.docx')

    const actionBtns = container.querySelectorAll('.oa-md-file-link-action')
    expect(actionBtns.length).toBe(4) // 2 for each link (open + reveal)
  })
})
