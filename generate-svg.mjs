import fs from 'node:fs'

const SVG_NS = ['http:/', '/www.w3.org', '/2000/svg'].join('')

const resultsDir = new URL('./results/', import.meta.url)
fs.mkdirSync(resultsDir, { recursive: true })

const raw = fs.readFileSync(new URL('./last-benchmark.json', resultsDir), 'utf8')
const data = JSON.parse(raw)

const escapeXml = (str) =>
  String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')

const width = 920
const rowHeight = 58
const headerHeight = 105
const footerHeight = 52
const height = headerHeight + data.results.length * rowHeight + footerHeight

const maxOps = Math.max(...data.results.map((r) => Number(r['ops/sec']) || 0), 1)
const barMaxWidth = 360
const barStartX = 315

const rowsSvg = data.results
  .map((r, idx) => {
    const y = headerHeight + idx * rowHeight
    const isFirst = r.Rank === 1
    const opsVal = Number(r['ops/sec']) || 0
    const barWidth = Math.max(8, Math.round((opsVal / maxOps) * barMaxWidth))
    const barColor = isFirst
      ? '#10b981'
      : idx === 1
        ? '#3b82f6'
        : idx === 2
          ? '#6366f1'
          : '#64748b'
    const rowBg = idx % 2 === 0 ? '#161b22' : '#0d1117'
    const rankColor = isFirst ? '#10b981' : '#8b949e'
    const fontWeight = isFirst ? '700' : '500'

    const subtitle = `hard(): ${r['hard() calls']} | Alloc: ${r['Alloc (B/iter)']} B/it | Retained: ${r['Retained (B/iter)']} B/it`

    return [
      `  <g transform="translate(0, ${y})">`,
      `    <rect x="20" y="2" width="${width - 40}" height="${rowHeight - 6}" rx="8" fill="${rowBg}" />`,
      `    <text x="42" y="34" fill="${rankColor}" font-family="monospace" font-size="15" font-weight="700">#${escapeXml(r.Rank)}</text>`,
      `    <text x="80" y="27" fill="#f0f6fc" font-family="sans-serif" font-size="14" font-weight="${fontWeight}">${escapeXml(r.Engine)}</text>`,
      `    <text x="80" y="45" fill="#8b949e" font-family="monospace" font-size="11">${escapeXml(subtitle)}</text>`,
            `    <rect x="${barStartX}" y="21" width="${barMaxWidth}" height="12" rx="4" fill="#21262d" />`,
      `    <rect x="${barStartX}" y="21" width="${barWidth}" height="12" rx="4" fill="${barColor}" />`,

      `    <text x="${barStartX + barMaxWidth + 16}" y="32" fill="#f0f6fc" font-family="monospace" font-size="13" font-weight="700">${escapeXml(opsVal.toLocaleString('en-US'))} ops/s</text>`,
      `    <text x="${width - 38}" y="32" text-anchor="end" fill="${rankColor}" font-family="monospace" font-size="13" font-weight="700">${escapeXml(r.Ratio)}</text>`,
      `  </g>`,
    ].join('\n')
  })
  .join('\n')

const headerSub1 = `Node.js ${data.nodeVersion} (${data.platform}) | ${data.cpuModel}`
const headerSub2 = `${data.iterations.toLocaleString('en-US')} iterations x ${data.samples} runs (Best Time after JIT warmup) | Higher ops/s is better`
const footerText = `Generated: ${data.timestamp} | Graph: A,B -> C,D -> E,F -> G -> H,I,J (hard = fib(18))`

const svgContent = [
  `<?xml version="1.0" encoding="UTF-8"?>`,
  `<svg xmlns="${SVG_NS}" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`,
  // `<svg xmlns="http://w3.org" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`,
  `  <rect width="${width}" height="${height}" rx="12" fill="#0d1117" stroke="#30363d" stroke-width="1.5" />`,
  `  <text x="32" y="38" fill="#f0f6fc" font-family="sans-serif" font-size="20" font-weight="700">$bog_collider Benchmark - Throughput &amp; Memory</text>`,
  `  <text x="32" y="62" fill="#8b949e" font-family="monospace" font-size="12">${escapeXml(headerSub1)}</text>`,
  `  <text x="32" y="82" fill="#8b949e" font-family="monospace" font-size="12">${escapeXml(headerSub2)}</text>`,
  rowsSvg,
  `  <text x="32" y="${height - 20}" fill="#6e7681" font-family="monospace" font-size="11">${escapeXml(footerText)}</text>`,
  `</svg>`,
].join('\n') + '\n'

const svgPath = new URL('./last-benchmark.svg', resultsDir)
fs.writeFileSync(svgPath, svgContent, 'utf8')
console.log('🖼️  Диаграмма ./results/last-benchmark.svg успешно сгенерирована!')

process.exit(0)
