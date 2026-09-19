import React from 'react'
import { afterEach, expect, test, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ChatSettingsPage } from './ChatSettingsPage'
import { I18N, SETTINGS_TEXT } from '../lib/i18n'
afterEach(cleanup)
test('distinguishes immediate preferences from the automatic-title save scope', async () => {
  const user = userEvent.setup()
  const submit = vi.fn()
  const projectSave = vi.fn()
  const setEnabled = vi.fn()
  render(<ChatSettingsPage t={I18N.en} text={SETTINGS_TEXT.en} lang="en"
    projectProvider="official" onSaveProjectProvider={projectSave}
    titleModel={{ enabled: true, saving: false, draft: '', options: [{value:'',label:'Follow'}], setEnabled, setDraft: vi.fn(), submit }}/>)
  expect(screen.getByText('Changes apply immediately on this device; no save required.')).toBeTruthy()
  const scope = screen.getByText('Save applies only to automatic titles, including the switch above.')
  await user.click(document.getElementById('settings-auto-title'))
  expect(setEnabled).toHaveBeenCalledWith(false)
  expect(submit).not.toHaveBeenCalled()
  await user.click(scope.parentElement.querySelector('button'))
  expect(submit).toHaveBeenCalledTimes(1)
  expect(projectSave).not.toHaveBeenCalled()
})
