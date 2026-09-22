import { api } from './lib/api.js'
export const SIZE_FIELDS = [
 ['uiFont','界面字号','Interface font',12,18,1,14],
 ['chatFont','聊天字号','Chat font',12,22,1,15],
 ['lineHeight','聊天行高','Line height',20,36,1,24],
 ['contentWidth','聊天内容宽度','Content width',640,1200,20,840],
 ['sidebarWidth','聊天侧栏宽度','Sidebar width',240,380,10,300],
 ['controlHeight','控件高度','Control height',28,48,2,36],
 ['radius','圆角','Corner radius',0,24,1,12],
 ['spacing','内容间距','Spacing',8,24,1,14],
]
export const normalizeSizes = value => Object.fromEntries(SIZE_FIELDS.map(([key,,,min,max,,def]) => [key, typeof value?.[key] === 'number' && Number.isFinite(value[key]) ? Math.min(max,Math.max(min,value[key])) : def]))
export const getSizes = () => { try { return normalizeSizes(JSON.parse(localStorage.getItem('ga-admin-sizes'))) } catch { return normalizeSizes() } }
export const sizeVariables = sizes => Object.fromEntries(Object.entries(normalizeSizes(sizes)).map(([key,value]) => [`--size-${key}`,`${value}px`]))
export function applySizes(value) {
 const sizes = normalizeSizes(value)
 try { localStorage.setItem('ga-admin-sizes',JSON.stringify(sizes)) } catch { /* storage may be unavailable */ }
 for (const [key,value] of Object.entries(sizeVariables(sizes))) document.documentElement.style.setProperty(key,value)
 window.dispatchEvent(new CustomEvent('ga-admin-sizes-change',{detail:sizes}))
 return sizes
}
export async function hydrateSizes() { applySizes(getSizes()); try { const data = await api('/api/ui/theme'); if ('sizes' in data) applySizes(data.sizes) } catch { /* keep local cache offline */ } }
