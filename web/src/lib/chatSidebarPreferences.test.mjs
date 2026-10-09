import test from 'node:test'
import assert from 'node:assert/strict'
import { readSidebarPreferences, sortSidebarSessions, sidebarPreferenceDefaults, filterSidebarRecentNodes, normalizeRecentFilter } from './chatSidebarPreferences.js'
test('preferences tolerate invalid and unavailable storage', () => {
  for (const raw of ['null', '{}', 'invalid']) assert.deepEqual(readSidebarPreferences({getItem:()=>raw}), {...sidebarPreferenceDefaults,showProjects:true,showConductor:true,sort:'updated'})
  assert.deepEqual(readSidebarPreferences({getItem:()=>'{"layout":"list","sort":"priority"}'}), {...sidebarPreferenceDefaults,showProjects:false,showConductor:true,sort:'priority'})
  assert.deepEqual(readSidebarPreferences({getItem:()=>{throw Error()}}), {...sidebarPreferenceDefaults,showProjects:true,showConductor:true,sort:'updated'})
})
test('priority ranks pins, waiting, running, and ordinary sessions without mutation', () => {
  const sessions = [{id:'idle',updated_at:200}, {id:'run',running:true,updated_at:100}, {id:'wait',taskbar_state:'waiting'}, {id:'pin',pinned:true}]
  assert.deepEqual(sortSidebarSessions(sessions,'priority').map(s=>s.id), ['pin','wait','run','idle'])
  assert.equal(sessions[0].id,'idle')
  assert.deepEqual(sortSidebarSessions(sessions,'updated').map(s=>s.id), ['pin','idle','run','wait'])
})
test('timestamps support seconds, milliseconds, ISO dates and stable ties', () => {
  const sessions = [{id:1,updated_at:'bad'},{id:2,updated_at:'2026-01-01T00:00:00Z'},{id:3,updated_at:1800000000},{id:4,updated_at:1800000000000}]
  assert.deepEqual(sortSidebarSessions(sessions,'updated').map(s=>s.id), [3,4,2,1])
})

test('visibility flags persist independently and override legacy layout', () => {
  for (const showProjects of [true, false]) for (const showConductor of [true, false]) {
    const saved = {showProjects, showConductor, layout:'list', sort:'updated'}
    assert.deepEqual(readSidebarPreferences({getItem:()=>JSON.stringify(saved)}), {...sidebarPreferenceDefaults,showProjects,showConductor,sort:'updated'})
  }
})

test('recent filters preserve order, overlapping ownership, and detached workers', () => {
  const nodes = [
    {session:{id:'chat'},workers:[]},
    {session:{id:'project',project_name:'Missing project'},workers:[]},
    {session:{id:'parent',conductor:{role:'parent'}},workers:[]},
    {session:{id:'both',project_name:'A',conductor:{role:'parent'}},workers:[]},
    {session:{id:'worker',conductor:{role:'worker'}},workers:[]},
    {session:{id:'tree'},workers:[{id:'child'}]},
  ]
  const ids = filter => filterSidebarRecentNodes(nodes,filter).map(node=>node.session.id)
  assert.deepEqual(ids('all'), nodes.map(node=>node.session.id))
  assert.deepEqual(ids('chat'), ['chat'])
  assert.deepEqual(ids('project'), ['project','both'])
  assert.deepEqual(ids('conductor'), ['parent','both','worker','tree'])
  assert.deepEqual(filterSidebarRecentNodes(null), [])
  assert.deepEqual(ids('invalid'), ids('all'))
})

test('filters and collapsed sections survive storage round trips independently', () => {
  for (const recentFilter of ['all','chat','project','conductor']) {
    const saved = {...sidebarPreferenceDefaults, recentFilter, historyExpanded:false,
      pinnedExpanded:false, projectsExpanded:false, conductorsExpanded:true,
      showAllProjects:true, expandedProjectNames:['A','B']}
    assert.deepEqual(readSidebarPreferences({getItem:()=>JSON.stringify(saved)}), {...saved, recentFilter: normalizeRecentFilter(recentFilter)})
  }
  const invalid = readSidebarPreferences({getItem:()=>JSON.stringify({recentFilter:'bad',historyExpanded:'false',expandedProjectNames:['A',4,'A']})})
  assert.deepEqual(invalid.recentFilter,['chat','project','conductor'])
  assert.equal(invalid.historyExpanded,true)
  assert.deepEqual(invalid.expandedProjectNames,['A'])
})

test('recent selections accept every subset and persist empty selections', () => {
  const keys = ['chat','project','conductor']
  const nodes = [{session:{id:'chat'}},{session:{id:'project',project_id:'p'}},{session:{id:'conductor',conductor:{role:'parent'}}}]
  for (let mask=0; mask<8; mask++) {
    const selected = keys.filter((_,i) => mask & (1 << i))
    assert.deepEqual(filterSidebarRecentNodes(nodes,selected).map(n=>n.session.id),selected)
    assert.deepEqual(readSidebarPreferences({getItem:()=>JSON.stringify({recentFilter:selected})}).recentFilter,selected)
  }
  assert.deepEqual(normalizeRecentFilter(['project','bad','project']),['project'])
  const both = {session:{project_id:'p',conductor:{role:'parent'}}}
  assert.deepEqual(filterSidebarRecentNodes([both],['project','conductor']),[both])
})

test('custom section visibility and order survive reload with invalid keys repaired', () => {
  const prefs = readSidebarPreferences({getItem:()=>JSON.stringify({showPinned:false, showRecent:false, sectionOrder:['recent','recent','invalid','projects']})})
  assert.equal(prefs.showPinned, false)
  assert.equal(prefs.showRecent, false)
  assert.deepEqual(prefs.sectionOrder, ['recent','projects','pinned','conductors'])
  assert.deepEqual(readSidebarPreferences({getItem:()=>JSON.stringify(prefs)}), prefs)
})

test('tab ownership and display counts round trip and repair orphaned tabs', () => {
  const raw = {sectionLayout:{tabs:[{id:'work',name:'Work',hideName:true},{id:'work',name:'Duplicate'}],active:'work',sections:{projects:{tab:'work',count:20},recent:{tab:'missing',count:7}}}}
  const prefs = readSidebarPreferences({getItem:()=>JSON.stringify(raw)})
  assert.equal(prefs.sectionLayout.tabs.length,2)
  assert.equal(prefs.sectionLayout.active,'work')
  assert.deepEqual(prefs.sectionLayout.sections.projects,{tab:'work',count:20})
  assert.deepEqual(prefs.sectionLayout.sections.recent,{tab:'home',count:10})
  assert.deepEqual(readSidebarPreferences({getItem:()=>JSON.stringify(prefs)}),prefs)
})
test('tab icons survive storage reload and normalize unsupported or legacy values safely', () => {
  const raw = {sectionLayout:{tabs:[{id:'legacy',name:'Legacy'},{id:'work',name:'Work',icon:'briefcase',hideName:false},{id:'unknown',name:'Unknown',icon:'not-an-icon'}],active:'work',sections:{projects:{tab:'work',count:20}}}}
  const prefs = readSidebarPreferences({getItem:()=>JSON.stringify(raw)})
  assert.deepEqual(prefs.sectionLayout.tabs.slice(1).map(tab=>tab.icon),['grid','briefcase','grid'])
  assert.equal(prefs.sectionLayout.tabs[2].hideName,false)
  assert.equal(prefs.sectionLayout.sections.projects.tab,'work')
  assert.deepEqual(readSidebarPreferences({getItem:()=>JSON.stringify(prefs)}),prefs)
})
