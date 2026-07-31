import assert from 'node:assert/strict'
import test from 'node:test'
import { isComposingKeyboardEvent, isPromptSendShortcut } from './chatComposerKeyboard.js'

test('plain Enter remains available for a new line', () => {
  assert.equal(isPromptSendShortcut({ key:'Enter' }), false)
  assert.equal(isPromptSendShortcut({ key:'Enter', shiftKey:true }), false)
})

test('Ctrl+Enter and Command+Enter submit the prompt', () => {
  assert.equal(isPromptSendShortcut({ key:'Enter', ctrlKey:true }), true)
  assert.equal(isPromptSendShortcut({ key:'Enter', metaKey:true }), true)
  assert.equal(isPromptSendShortcut({ key:'a', ctrlKey:true }), false)
})

test('IME candidate confirmation never submits the prompt', () => {
  assert.equal(isComposingKeyboardEvent({ isComposing:true }), true)
  assert.equal(isPromptSendShortcut({ key:'Enter', ctrlKey:true, isComposing:true }), false)
  assert.equal(isPromptSendShortcut({ key:'Enter', metaKey:true, nativeEvent:{ isComposing:true } }), false)
  assert.equal(isPromptSendShortcut({ key:'Enter', ctrlKey:true, keyCode:229 }), false)
})
