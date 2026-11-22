import fs from 'node:fs'

const resultsDir = new URL('./results/', import.meta.url)
const raw = fs.readFileSync(new URL('./last-benchmark.json', resultsDir), 'utf8')
const data = JSON.parse(raw)

const dateFormatted = new Date(data.timestamp).toLocaleString('ru-RU', {
  dateStyle: 'medium',
  timeStyle: 'short',
})

const tableHeader = [
  '| Rank | Engine | `hard()` calls | Best Time (ms) | ops/sec | Alloc (B/iter) | Retained (B/iter) | Ratio |',
  '| :---: | :--- | :---: | :---: | :---: | :---: | :---: | :---: |',
].join('\n')

const tableRows = data.results
  .map((r) => {
    const isFirst = r.Rank === 1
    const engineName = isFirst ? `**${r.Engine}**` : r.Engine
    const ops = isFirst
      ? `**${Number(r['ops/sec']).toLocaleString('ru-RU')}**`
      : Number(r['ops/sec']).toLocaleString('ru-RU')
    const ratio = isFirst ? `**${r.Ratio}**` : r.Ratio
    return `| ${r.Rank} | ${engineName} | \`${r['hard() calls']}\` | ${Number(r['Best Time (ms)']).toFixed(2)} | ${ops} | ${r['Alloc (B/iter)']} | ${r['Retained (B/iter)']} | ${ratio} |`
  })
  .join('\n')

const markdown = `# Локальный бенчмарк на графе \`$bog_collider\`

Автоматически сгенерированный отчёт сравнения реактивных движков на графе из [\`b-on-g/collider\`](https://github.com/b-on-g/collider).

![Результаты последнего бенчмарка](./results/last-benchmark.svg)

## Топология графа (ASCII-схема)

\`\`\`text
        ┌─────────┐               ┌─────────┐
        │ Signal A│               │ Signal B│
        └────┬────┘               └────┬────┘
             │ \\                     / │
             │  \\                   /  │
             │   ▼                 ▼   │
             │  ┌───────────────────┐  │
             │  │    Computed C     │  │
             │  │  (A % 2 + B % 2)  │  │
             │  └────┬─────────┬────┘  │
             │       │         │       │
             ▼       ▼         │       ▼
         ┌───────────────┐     │  ┌───────────────────────────┐
         │  Computed E   │     │  │        Computed D         │
         │ hard(C+A+D[0])│     │  │ map({ x: i + A%2 - B%2 }) │
         └───────┬───────┘     │  └──┬──────────┬──────────┬──┘
                 │             │     │          │          │
       (только если C == 0)    │     │          │          ▼
                 │             │     │          │  ┌───────────────┐
                 │             │     │          │  │  Computed F   │
                 │             │     │          │  │ hard(D[2]||B) │
                 │             ▼     ▼          │  └───────┬───────┘
                 │      ┌──────────────────┐    │          │
                 └─────►│    Computed G    │◄───┼──────────┤
                        │ C+(C||E%2)+D[4]+F│    │          │
                        └────┬────────┬────┘    │          │
                             │        │         │          │
                             ▼        ▼         │          ▼
                        ┌────────┐ ┌────────┐   │     ┌────────┐
                        │Effect H│ │Effect I│   │     │Effect J│
                        │hard(G) │ │  (G)   │   │     │hard(F) │
                        └────────┘ └────────┘   │     └────────┘
\`\`\`

* **Ленивое ветвление (\`C || E % 2\`):** Когда \`C\` истинно, узел \`G\` не читает \`E\`, поэтому дорогое вычисление \`hard()\` в \`E\` должно пропускаться.
* **Структурное гашение (\`D\`):** Узел \`D\` при каждом пересчёте создаёт новый массив объектов \`{ x }\`. При неизменном содержимом массива компаратор \`equals\` блокирует лишний пересчёт \`F\` и \`J\`.

## Параметры стенда

* **Дата замера:** ${dateFormatted}
* **Среда:** Node.js \`${data.nodeVersion}\` (\`${data.platform}\`)
* **Процессор:** \`${data.cpuModel}\`
* **Нагрузка:** \`${data.iterations.toLocaleString('ru-RU')}\` двухшаговых итераций × \`${data.samples}\` контрольных прогона (учитывается минимальное время после JIT-прогрева)
* **Артефакты:** [\`./results/last-benchmark.json\`](./results/last-benchmark.json) · [\`./results/last-benchmark.svg\`](./results/last-benchmark.svg)

## Сводная таблица результатов

${tableHeader}
${tableRows}

## Методология и V8 JIT

1. **Прогрев JIT:** Перед замером каждый движок выполняет 500 прогревочных итераций, чтобы V8 перевёл горячие функции в оптимизированный машинный код (*Maglev / TurboFan*) и стабилизировал скрытые классы (*Hidden Classes*).
2. **Минимум из 3 прогонов (\`Best Time\`):** Выбор лучшего времени из серии отсекает случайные прерывания планировщика ОС и фоновый троттлинг CPU.
3. **Замер памяти (\`--expose-gc\`):**
   * \`Alloc (B/iter)\` — объём временных аллокаций в куче V8 за одну итерацию до вызова сборщика мусора.
   * \`Retained (B/iter)\` — остаточное удержание памяти после принудительного двойного вызова \`global.gc()\`.
4. **Запуск стенда:**
   \`\`\`bash
   bash bench.sh
   \`\`\`
`

fs.writeFileSync(new URL('./README.md', import.meta.url), markdown, 'utf8')
console.log('📝 Корневой ./README.md успешно обновлён!')

process.exit(0)
