import React, { createRef } from 'react'
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { ChatComposer } from './chatBody.jsx'
import { ComposerActions } from '../ChatApp.jsx'

afterEach(() => cleanup())

const Empty = () => null
const t = (zh, en) => en

function setup(overrides = {}) {
  const addAttachmentFiles = vi.fn()
  const props = {
    ComposerActions,
    CopyButton: Empty,
    PendingAttachments: Empty,
    ProviderModelCascade: Empty,
    REASONING_EFFORT_OPTIONS: [],
    attachments: [],
    ct: t,
    fileRef: createRef(),
    promptRef: createRef(),
    composerManualHeightRef: createRef(),
    prompt: '',
    handlePromptChange: vi.fn(),
    providerGroups: [],
    queuedMessages: [],
    isConductorWorker: () => false,
    isConductorParent: () => false,
    addAttachmentFiles,
    ...overrides,
  }
  const result = render(<ChatComposer {...props} />)
  return {
    ...result,
    addAttachmentFiles,
    photos: screen.getByLabelText('Choose photos'),
    files: screen.getByLabelText('Choose attachments'),
  }
}

function openActions() {
  fireEvent.click(screen.getByRole('button', { name: /更多操作|more actions/i }))
}

it('provides a separate multi-photo picker without forcing the camera', () => {
  const { photos, files } = setup()
  expect(photos.type).toBe('file')
  expect(photos.accept).toBe('image/*')
  expect(photos.multiple).toBe(true)
  expect(photos.hidden).toBe(true)
  expect(photos.hasAttribute('capture')).toBe(false)
  expect(files.hasAttribute('accept')).toBe(false)
  expect(files.multiple).toBe(true)
  expect(files.hasAttribute('capture')).toBe(false)
})

it('opens only the selected picker and closes the menu synchronously', () => {
  const { photos, files } = setup()
  const photoClick = vi.spyOn(photos, 'click').mockImplementation(() => {})
  const fileClick = vi.spyOn(files, 'click').mockImplementation(() => {})
  openActions()
  fireEvent.click(screen.getByRole('menuitem', { name: /相册|^photos$/i }))
  expect(photoClick).toHaveBeenCalledOnce()
  expect(fileClick).not.toHaveBeenCalled()
  expect(screen.queryByRole('menu')).toBeNull()
  openActions()
  fireEvent.click(screen.getByRole('menuitem', { name: /附件|attachments/i }))
  expect(fileClick).toHaveBeenCalledOnce()
  expect(photoClick).toHaveBeenCalledOnce()
  expect(screen.queryByRole('menu')).toBeNull()
})

it('uses the existing attachment handler for every selected photo and allows reselection', () => {
  const { photos, addAttachmentFiles } = setup()
  const images = [new File(['one'], 'one.jpg', { type: 'image/jpeg' }), new File(['two'], 'two.png', { type: 'image/png' })]
  Object.defineProperty(photos, 'value', { configurable: true, writable: true, value: 'selected' })
  fireEvent.change(photos, { target: { files: images } })
  expect(addAttachmentFiles).toHaveBeenLastCalledWith(images)
  expect(photos.value).toBe('')
  photos.value = 'selected'
  fireEvent.change(photos, { target: { files: images } })
  expect(addAttachmentFiles).toHaveBeenCalledTimes(2)
  expect(addAttachmentFiles).toHaveBeenLastCalledWith(images)
  expect(photos.value).toBe('')
})

it('keeps unrestricted file selection on the existing attachment handler', () => {
  const { files, addAttachmentFiles } = setup()
  const document = new File(['notes'], 'notes.txt', { type: 'text/plain' })
  fireEvent.change(files, { target: { files: [document] } })
  expect(addAttachmentFiles).toHaveBeenCalledWith([document])
})
