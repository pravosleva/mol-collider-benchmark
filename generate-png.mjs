import fs from 'node:fs'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const resultsDir = new URL('./results/', import.meta.url)
const svgUrl = new URL('./last-benchmark.svg', resultsDir)
const pngUrl = new URL('./last-benchmark.png', resultsDir)

const svgPath = fileURLToPath(svgUrl)
const pngPath = fileURLToPath(pngUrl)

if (!fs.existsSync(svgPath)) {
  console.error('❌ Файл ./results/last-benchmark.svg не найден. Сначала запустите generate-svg.mjs.')
  process.exit(1)
}

const svgContent = fs.readFileSync(svgPath, 'utf8')

// Извлекаем размеры холста из атрибутов <svg width="..." height="...">
const widthMatch = svgContent.match(/<svg[^>]*\bwidth="(\d+)"/)
const heightMatch = svgContent.match(/<svg[^>]*\bheight="(\d+)"/)
const width = widthMatch ? Number(widthMatch) : 920
const height = heightMatch ? Number(heightMatch) : 760

let rendered = false

// 1. Пробуем через @resvg/resvg-js (если установлен в node_modules)
try {
  const { Resvg } = await import('@resvg/resvg-js')
  const resvg = new Resvg(svgContent, {
    fitTo: { mode: 'zoom', value: 2 },
  })
  const pngBuffer = resvg.render().asPng()
  fs.writeFileSync(pngPath, pngBuffer)
  console.log('🖼️  PNG сгенерирован через @resvg/resvg-js (2x Retina): ./results/last-benchmark.png')
  rendered = true
} catch {
  // Пакет не установлен — переходим к системным утилитам
}

// 2. Фолбэк: через rsvg-convert (если установлен в системе)
if (!rendered) {
  try {
    execFileSync('rsvg-convert', ['-z', '2', svgPath, '-o', pngPath], { stdio: 'ignore' })
    console.log('🖼️  PNG сгенерирован через rsvg-convert (2x Retina): ./results/last-benchmark.png')
    rendered = true
  } catch {
    // rsvg-convert отсутствует — пробуем headless Chrome / Chromium
  }
}

// 3. Фолбэк: через Google Chrome / Chromium в headless-режиме
if (!rendered) {
  const browsers = ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser']
  for (const bin of browsers) {
    try {
      execFileSync(
        bin,
        [
          '--headless',
          '--disable-gpu',
          '--hide-scrollbars',
          `--screenshot=${pngPath}`,
          `--window-size=${width},${height}`,
          '--force-device-scale-factor=2',
          `file://${svgPath}`,
        ],
        { stdio: 'ignore' }
      )
      console.log(`🖼️  PNG сгенерирован через ${bin} (2x Retina): ./results/last-benchmark.png`)
      rendered = true
      break
    } catch {
      // Пробуем следующий бинарник браузера
    }
  }
}

if (!rendered) {
  console.warn(
    '⚠️  Не удалось сгенерировать PNG: установите @resvg/resvg-js, librsvg2-bin (rsvg-convert) или google-chrome.'
  )
  process.exit(1)
}
