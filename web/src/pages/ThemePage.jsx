import React from 'react'
import ThemeColorEditor from '../ThemeColorEditor'
import { THEMES } from '../themes'

export default function ThemePage({ theme, lang }) {
  const preset = THEMES.find(item => item.id === theme)
  return <div className="theme-page">
    <p>{lang === 'zh' ? '当前预设：' : 'Current preset: '}{preset?.label[lang] || preset?.label.en}</p>
    <ThemeColorEditor theme={theme} lang={lang} isolated/>
  </div>
}
