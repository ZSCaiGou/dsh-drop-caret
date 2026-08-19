#!/usr/bin/env node
// dsh-files-compatible client bundle builder

import { readFile, writeFile } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const clientSrc = join(__dirname, 'lib', 'client.js')
const clientDist = join(__dirname, 'lib', 'client.js')

const banner = `// dsh-drop-caret client bundle (ModuleLoader format)
`

const footer = `
// [end of dsh-drop-caret client bundle]`

async function build() {
  console.log('📦 Building dsh-drop-caret client bundle...')
  
  const content = await readFile(clientSrc, 'utf-8')
  
  // 验证是否已经是 ModuleLoader 格式
  if (!content.includes('window.__ModuleLoader__.load')) {
    throw new Error('client.js must use ModuleLoader format')
  }
  
  const bundle = banner + content + footer
  await writeFile(clientDist, bundle, 'utf-8')
  
  console.log(`✓ Built: ${clientDist} (${bundle.length} bytes)`)
}

build().catch((err) => {
  console.error('Build failed:', err)
  process.exit(1)
})
