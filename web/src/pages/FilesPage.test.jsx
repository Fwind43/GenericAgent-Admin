import React from 'react'
import {afterEach,expect,it,vi} from 'vitest'
import {cleanup,fireEvent,render,screen} from '@testing-library/react'
import {FilesPage} from './FilesPage'
import {I18N} from '../lib/i18n'
globalThis.React=React
afterEach(cleanup)
const t=I18N.en
function props(){return {t,filePath:'/fixture/a.txt',loadedFilePath:'/fixture/a.txt',loadedFileContent:'original',fileContent:'draft',fileList:[{path:'/fixture/a.txt',kind:'file'}],fileSearch:'',searchHits:[],tailLines:20,...Object.fromEntries(['setFilePath','setFileContent','setFileSearch','setTailLines','loadFiles','readFile','tailFile','saveFile','deleteFile','downloadFile','runSearch','discardChanges'].map(k=>[k,vi.fn()]))}}
it('keeps dirty draft and target after failure; retries only via supplied callback',()=>{
 const p=props(),retry=vi.fn();render(<FilesPage {...p} fileStatus={{kind:'error',message:'Fixture failure',onRetry:retry}}/> )
 expect(screen.getByRole('alert').textContent).toContain('Fixture failure')
 expect(screen.getByLabelText(t.files.editorLabel).value).toBe('draft')
 fireEvent.click(screen.getByRole('button',{name:t.files.retryAction}));expect(retry).toHaveBeenCalledTimes(1)
 fireEvent.click(screen.getByRole('button',{name:t.save}));expect(p.saveFile).toHaveBeenCalledTimes(1)
 expect(screen.getByRole('button',{name:t.delete}).className).toContain('danger')
 expect(screen.getByRole('button',{name:/a.txt/}).getAttribute('aria-current')).toBe('true')
})
it('preserves save guards and directory/file selection callbacks',()=>{
 const p=props();p.fileContent='original';p.fileList.push({path:'/fixture/folder',kind:'dir'});render(<FilesPage {...p}/> )
 expect(screen.getByRole('button',{name:t.save}).disabled).toBe(true)
 fireEvent.click(screen.getByRole('button',{name:/folder/}));expect(p.loadFiles).toHaveBeenCalledWith('/fixture/folder')
 fireEvent.click(screen.getByRole('button',{name:/a.txt/}));expect(p.readFile).toHaveBeenCalledWith('/fixture/a.txt')
})
