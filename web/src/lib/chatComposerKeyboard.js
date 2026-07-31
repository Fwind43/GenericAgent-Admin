export const isComposingKeyboardEvent = (event = {}) => Boolean(
  event.isComposing
  || event.nativeEvent?.isComposing
  || event.keyCode === 229
  || event.which === 229
)

export const isPromptSendShortcut = (event = {}) => Boolean(
  event.key === 'Enter'
  && (event.ctrlKey || event.metaKey)
  && !isComposingKeyboardEvent(event)
)
