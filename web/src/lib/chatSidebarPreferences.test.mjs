import test from 'node:test'
import assert from 'node:assert/strict'
import { readSidebarPreferences, sortSidebarSessions, sidebarPreferenceDefaults, filterSidebarRecentNodes, normalizeRecentFilter, normalizeSidebarLayout, sidebarTabIcons } from './chatSidebarPreferences.js'
test('module initializes default sidebar layout with icon dependencies ready', () => {
  assert.ok(sidebarTabIcons.includes('grid'))
  assert.deepEqual(sidebarPreferenceDefaults.sectionLayout, normalizeSidebarLayout())
  assert.equal(sidebarPreferenceDefaults.sectionLayout.active, 'home')
  assert.deepEqual(sidebarPreferenceDefaults.sectionLayout.tabs, [{ id: 'home', name: 'Home' }])
})
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
  assert.deepEqual(prefs.sectionLayout.sections.projects,{tabs:['work'],count:20})
  assert.deepEqual(prefs.sectionLayout.sections.recent,{tabs:['home'],count:10})
  assert.deepEqual(readSidebarPreferences({getItem:()=>JSON.stringify(prefs)}),prefs)
})
test('tab icons survive storage reload and normalize unsupported or legacy values safely', () => {
  const raw = {sectionLayout:{tabs:[{id:'legacy',name:'Legacy'},{id:'work',name:'Work',icon:'briefcase',hideName:false},{id:'unknown',name:'Unknown',icon:'not-an-icon'}],active:'work',sections:{projects:{tab:'work',count:20}}}}
  const prefs = readSidebarPreferences({getItem:()=>JSON.stringify(raw)})
  assert.deepEqual(prefs.sectionLayout.tabs.slice(1).map(tab=>tab.icon),['grid','briefcase','grid'])
  assert.equal(prefs.sectionLayout.showActiveTabName,true)
  assert.ok(prefs.sectionLayout.tabs.every(tab=>!('hideName' in tab)))
  assert.deepEqual(prefs.sectionLayout.sections.projects.tabs,['work'])
  assert.deepEqual(readSidebarPreferences({getItem:()=>JSON.stringify(prefs)}),prefs)
})
test('home preferences survive reload without allowing home removal or orphaned sections', () => {
  const raw = {sectionLayout:{tabs:[{id:'home',name:'Inbox',hideName:false,icon:'message'},{id:'work',name:'Work',hideName:false}],active:'work',sections:{projects:{tab:'work',count:20}}}}
  const prefs = readSidebarPreferences({getItem:()=>JSON.stringify(raw)})
  assert.deepEqual(prefs.sectionLayout.tabs[0],{id:'home',name:'Inbox',icon:'message'})
  assert.deepEqual(readSidebarPreferences({getItem:()=>JSON.stringify(prefs)}),prefs)
  assert.deepEqual(normalizeSidebarLayout({tabs:[]}).tabs,[{id:'home',name:'Home'}])
  assert.equal(normalizeSidebarLayout({tabs:[{id:'home',name:'   ',icon:'invalid'}]}).tabs[0].name,'Home')
})

test('selected tab name visibility is shared, survives reload and migrates the active legacy preference', () => {
  const tabs = [{id:'home',name:'Home',hideName:true},{id:'work',name:'Work',hideName:false}]
  assert.equal(normalizeSidebarLayout().showActiveTabName,false)
  assert.equal(normalizeSidebarLayout({tabs,active:'home'}).showActiveTabName,false)
  const migrated = normalizeSidebarLayout({tabs,active:'work'})
  assert.equal(migrated.showActiveTabName,true)
  assert.ok(migrated.tabs.every(tab=>!('hideName' in tab)))
  for (const showActiveTabName of [true,false]) {
    const normalized = normalizeSidebarLayout({tabs,active:'work',showActiveTabName})
    assert.equal(normalized.showActiveTabName,showActiveTabName)
    for (const active of ['home','work','missing']) {
      const layout = normalizeSidebarLayout({...normalized,active})
      assert.equal(layout.showActiveTabName,showActiveTabName)
      const prefs = readSidebarPreferences({getItem:()=>JSON.stringify({sectionLayout:layout})})
      assert.deepEqual(prefs.sectionLayout,layout)
      assert.deepEqual(normalizeSidebarLayout(layout),layout)
    }
  }
})

test('shared memberships migrate, deduplicate, repair orphans and preserve explicitly empty lists', () => {
  const layout = normalizeSidebarLayout({tabs:[{id:'work',name:'Work'}], sections:{
    pinned:{tab:'work',count:20},
    projects:{tabs:['home','work','work','missing'],count:50},
    recent:{tabs:[],tab:'home'},
    conductors:{tabs:['missing']},
  }})
  assert.deepEqual(layout.sections.pinned,{tabs:['work'],count:20})
  assert.deepEqual(layout.sections.projects,{tabs:['home','work'],count:50})
  assert.deepEqual(layout.sections.recent,{tabs:[],count:10})
  assert.deepEqual(layout.sections.conductors,{tabs:['home'],count:10})
  assert.deepEqual(normalizeSidebarLayout(layout),layout)
  assert.deepEqual(readSidebarPreferences({getItem:()=>JSON.stringify({sectionLayout:layout})}).sectionLayout,layout)
})
