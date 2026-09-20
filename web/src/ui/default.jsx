import React from 'react'
import { manifest } from './contract'
function DefaultSurface({ fallback }) { return <>{fallback || null}</> }
export const defaults = { manifest: manifest('default'), views: { 'admin.shell': DefaultSurface, 'admin.overview': DefaultSurface } }
