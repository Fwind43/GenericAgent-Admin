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

test('section navigation preserves drafts and project-save failure does not submit titles', async () => {
  const user = userEvent.setup()
  const submit = vi.fn()
  const projectSave = vi.fn().mockRejectedValue(new Error('fixture save failed'))
  function Fixture() {
    const [draft, setDraft] = React.useState('')
    return <ChatSettingsPage t={I18N.en} text={SETTINGS_TEXT.en} lang="en" projectProvider="official" onSaveProjectProvider={projectSave}
      titleModel={{enabled:true,saving:false,draft,setDraft,options:[{value:'',label:'Follow'},{value:'fixture-model',label:'Fixture model'}],setEnabled:vi.fn(),submit}}/>
  }
  render(<Fixture/> )
  const project = document.querySelector('#chat-project-mode select')
  const title = document.getElementById('settings-auto-title-model')
  await user.selectOptions(project, 'admin')
  await user.selectOptions(title, 'fixture-model')
  const nav = screen.getByRole('navigation', {name:'Chat settings sections'})
  for (const link of nav.querySelectorAll('a')) {
    expect(document.querySelector(link.getAttribute('href'))).toBeTruthy()
    await user.click(link)
  }
  expect(project.value).toBe('admin')
  expect(title.value).toBe('fixture-model')
  await user.click(document.querySelector('#chat-project-mode button'))
  expect(await screen.findByText('fixture save failed')).toBeTruthy()
  expect(project.value).toBe('admin')
  expect(title.value).toBe('fixture-model')
  expect(submit).not.toHaveBeenCalled()
})
