export const COMPOSER_AUTO_MAX_HEIGHT = 160
export const COMPOSER_MIN_HEIGHT = 34
export const COMPOSER_VIEWPORT_OFFSET = 220
export const COMPOSER_MOBILE_BREAKPOINT = 680

const finiteNumber = value => {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

export const composerManualHeightLimit = viewportHeight => Math.max(
  COMPOSER_MIN_HEIGHT,
  Math.floor(finiteNumber(viewportHeight)) - COMPOSER_VIEWPORT_OFFSET,
)

export const composerTextareaLayout = ({ scrollHeight, manualHeight, viewportHeight, isNarrow }) => {
  const contentHeight = Math.max(COMPOSER_MIN_HEIGHT, finiteNumber(scrollHeight))
  const preferredManualHeight = finiteNumber(manualHeight)
  const manual = !isNarrow && preferredManualHeight >= COMPOSER_MIN_HEIGHT
  const maxHeight = manual
    ? composerManualHeightLimit(viewportHeight)
    : (isNarrow ? COMPOSER_AUTO_MAX_HEIGHT : Math.min(COMPOSER_AUTO_MAX_HEIGHT, composerManualHeightLimit(viewportHeight)))
  const height = manual
    ? Math.min(Math.max(preferredManualHeight, COMPOSER_MIN_HEIGHT), maxHeight)
    : Math.min(contentHeight, maxHeight)

  return {
    height,
    overflowY: contentHeight > height ? 'auto' : 'hidden',
    manual,
  }
}

export const composerDragHeight = (startHeight, startY, currentY, viewportHeight) => Math.min(
  composerManualHeightLimit(viewportHeight),
  Math.max(COMPOSER_MIN_HEIGHT, finiteNumber(startHeight) + finiteNumber(startY) - finiteNumber(currentY)),
)
