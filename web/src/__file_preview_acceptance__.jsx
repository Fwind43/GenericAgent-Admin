import React from 'react'
import { createRoot } from 'react-dom/client'
import FilePreviewLink from './components/FilePreviewLink'
import './style.css'

const markdown = `# Markdown Preview\n\nThis is **bold**, *emphasized*, and [safe link](https://example.com).\n\n> A readable quote for visual acceptance.\n\n- First item\n- Second item\n\n| Name | Value |\n| --- | --- |\n| Theme | warm / light / dark |\n\n\`\`\`js\nconsole.log('safe code block')\n\`\`\`\n\n![remote image](https://evil.example/pixel.png)\n\n## Long content\n\n${Array.from({ length: 40 }, (_, i) => `Paragraph ${i + 1}: long content remains inside the scrolling preview body.`).join('\n\n')}`

globalThis.fetch = async () => new Response(markdown, { status: 200, headers: { 'Content-Type': 'text/markdown', 'Content-Length': String(new TextEncoder().encode(markdown).length) } })
function App() {
  return <main style={{ padding: 24 }}><h1>Acceptance fixture</h1><FilePreviewLink href="/api/files/download?path=acceptance.md" download="acceptance.md">Open Markdown preview</FilePreviewLink></main>
}
createRoot(document.getElementById('root')).render(<App />)
