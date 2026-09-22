import { lazySurface } from './lazySurface'
const DefaultModelAdvanced = lazySurface(() => import('./modelAdvanced'), 'DefaultModelAdvanced')
const DefaultModelRisks = lazySurface(() => import('./modelRisks'), 'DefaultModelRisks')
const DefaultModelTransfer = lazySurface(() => import('./modelTransfer'), 'DefaultModelTransfer')
const DefaultModelPreviewControls = lazySurface(() => import('./modelTransfer'), 'DefaultModelPreviewControls')
const DefaultModelEditorCommon = lazySurface(() => import('./modelEditorCommon'), 'DefaultModelEditorCommon')
const DefaultModelCalls = lazySurface(() => import('./modelCalls'), 'DefaultModelCalls')
const DefaultModelProviders = lazySurface(() => import('./modelProviders'), 'DefaultModelProviders')
const DefaultTasks = lazySurface(() => import('./tasks'), 'DefaultTasks')
const DefaultUsage = lazySurface(() => import('./usage'), 'DefaultUsage')
const DefaultProjectModeSettings = lazySurface(() => import('./chatRuntimeSettings'), 'DefaultProjectModeSettings')
const DefaultProcessDisplaySettings = lazySurface(() => import('./chatRuntimeSettings'), 'DefaultProcessDisplaySettings')
const DefaultChatTitleSettings = lazySurface(() => import('./chatTitleSettings'), 'DefaultChatTitleSettings')
const DefaultAppearanceSettings = lazySurface(() => import('./appearanceSettings'), 'DefaultAppearanceSettings')
const DefaultRemoteSettings = lazySurface(() => import('./remoteSettings'), 'DefaultRemoteSettings')
const DefaultGeneralSettings = lazySurface(() => import('./generalSettings.jsx'), 'DefaultGeneralSettings')
import React from 'react'
import { manifest } from './contract'
import { DefaultChatChrome } from './chatChrome'
import { ChatSidebar, ChatMessages, ChatComposer } from './chatBody'
function DefaultSurface({ fallback }) { return <>{fallback || null}</> }
export const defaults = { manifest: manifest('default'), views: { 'admin.shell': DefaultSurface, 'admin.models.risks': DefaultModelRisks, 'admin.models.transfer': DefaultModelTransfer, 'admin.models.preview.controls': DefaultModelPreviewControls, 'admin.models.calls': DefaultModelCalls, 'admin.models.editor.advanced': DefaultModelAdvanced, 'admin.models.editor.common': DefaultModelEditorCommon, 'admin.models.providers': DefaultModelProviders, 'admin.tasks': DefaultTasks, 'admin.usage': DefaultUsage, 'admin.overview': DefaultSurface, 'admin.settings.chat.title': DefaultChatTitleSettings, 'admin.settings.chat.project': DefaultProjectModeSettings, 'admin.settings.chat.process': DefaultProcessDisplaySettings, 'admin.settings.appearance': DefaultAppearanceSettings, 'admin.settings.remote': DefaultRemoteSettings, 'admin.settings.paths': DefaultGeneralSettings, 'admin.settings.network': DefaultGeneralSettings, 'admin.settings.startup': DefaultGeneralSettings, 'chat.chrome': DefaultChatChrome, 'chat.sidebar': ChatSidebar, 'chat.messages': ChatMessages, 'chat.composer': ChatComposer } }
