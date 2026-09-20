import React from 'react'
import { manifest } from './contract'
import { DefaultChatChrome } from './chatChrome'
import { ChatSidebar, ChatMessages, ChatComposer } from './chatBody'
function DefaultSurface({ fallback }) { return <>{fallback || null}</> }
export const defaults = { manifest: manifest('default'), views: { 'admin.shell': DefaultSurface, 'admin.overview': DefaultSurface, 'chat.chrome': DefaultChatChrome, 'chat.sidebar': ChatSidebar, 'chat.messages': ChatMessages, 'chat.composer': ChatComposer } }
