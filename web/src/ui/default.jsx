import { DefaultTasks } from './tasks'
import { DefaultUsage } from './usage'
import { DefaultProjectModeSettings, DefaultProcessDisplaySettings } from './chatRuntimeSettings'
import { DefaultChatTitleSettings } from './chatTitleSettings'
import { DefaultAppearanceSettings } from './appearanceSettings'
import { DefaultRemoteSettings } from './remoteSettings'
import { DefaultGeneralSettings } from './generalSettings.jsx'
import React from 'react'
import { manifest } from './contract'
import { DefaultChatChrome } from './chatChrome'
import { ChatSidebar, ChatMessages, ChatComposer } from './chatBody'
function DefaultSurface({ fallback }) { return <>{fallback || null}</> }
export const defaults = { manifest: manifest('default'), views: { 'admin.shell': DefaultSurface, 'admin.tasks': DefaultTasks, 'admin.usage': DefaultUsage, 'admin.overview': DefaultSurface, 'admin.settings.chat.title': DefaultChatTitleSettings, 'admin.settings.chat.project': DefaultProjectModeSettings, 'admin.settings.chat.process': DefaultProcessDisplaySettings, 'admin.settings.appearance': DefaultAppearanceSettings, 'admin.settings.remote': DefaultRemoteSettings, 'admin.settings.paths': DefaultGeneralSettings, 'admin.settings.network': DefaultGeneralSettings, 'admin.settings.startup': DefaultGeneralSettings, 'chat.chrome': DefaultChatChrome, 'chat.sidebar': ChatSidebar, 'chat.messages': ChatMessages, 'chat.composer': ChatComposer } }
