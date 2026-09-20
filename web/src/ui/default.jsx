import React from 'react'
import { manifest } from './contract'
import { DefaultChatChrome } from './chatChrome'
function DefaultSurface({ fallback }) { return <>{fallback || null}</> }
export const defaults = { manifest: manifest('default'), views: { 'admin.shell': DefaultSurface, 'admin.overview': DefaultSurface, 'chat.chrome': DefaultChatChrome } }
