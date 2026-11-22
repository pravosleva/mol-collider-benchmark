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

const legend = `## Легенда колонок

* **\`hard() calls\`** — количество и порядок вызовов \`fib(18)\` за одну двухшаговую итерацию. Теоретический минимум — \`3 (H,E,H)\` (пропуск невостребованной ветки \`E\` на первом шаге и отсечение пересчёта \`F\` при неизменном содержимом массива \`D\`).
* **\`Best Time (ms)\`** — минимальное время выполнения \`5 000\` итераций из \`3\` прогонов после JIT-прогрева V8 (меньше — лучше).
* **\`ops/sec\`** — пропускная способность в полных двухшаговых итерациях в секунду (больше — лучше).
* **\`Alloc (B/iter)\`** — объём временных аллокаций в куче V8 за одну итерацию до сборки мусора (включает пересоздание массива из 5 объектов в узле \`D\` и внутренние структуры планировщика движка).
* **\`Retained (B/iter)\`** — остаточный прирост памяти в пересчёте на итерацию после принудительного двойного \`global.gc()\`. Значения \`< 0.500 B/iter\` соответствуют нулевой утечке (фоновый шум служебных структур V8), значения \`> 50 B/iter\` указывают на удержание промежуточных данных в памяти.
* **\`Ratio\`** — отношение \`Best Time\` текущего движка к лучшему результату в таблице (\`1.00×\` — лидер прогона).
`

const tableRows = data.results
  .map((r) => {
    const isFirst = r.Rank === 1
    const label = r.Version ? `${ r.Engine } \`${ r.Version }\`` : r.Engine
    const engineName = isFirst ? `**${ label }**` : label
    const ops = isFirst
      ? `**${ Number(r['ops/sec']).toLocaleString('ru-RU') }**`
      : Number(r['ops/sec']).toLocaleString('ru-RU')
    const ratio = isFirst ? `**${ r.Ratio }**` : r.Ratio
    return `| ${ r.Rank } | ${ engineName } | \`${ r['hard() calls'] }\` | ${ Number(r['Best Time (ms)']).toFixed(2) } | ${ ops } | ${ r['Alloc (B/iter)'] } | ${ Number(r['Retained (B/iter)']).toFixed(3) } | ${ ratio } |`
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

* **Дата замера:** ${ dateFormatted }
* **Среда:** Node.js \`${ data.nodeVersion }\` (\`${ data.platform }\`)
* **Процессор:** \`${ data.cpuModel }\`
* **Нагрузка:** \`${ data.iterations.toLocaleString('ru-RU') }\` двухшаговых итераций × \`${ data.samples }\` контрольных прогона (учитывается минимальное время после JIT-прогрева)
* **Артефакты:** [\`./results/last-benchmark.json\`](./results/last-benchmark.json) · [\`./results/last-benchmark.svg\`](./results/last-benchmark.svg)

## Сводная таблица результатов

${ tableHeader }
${ tableRows }

${ legend }

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

## Запуск стенда \`bench.sh\`

Скрипт \`bench.sh\` автоматизирует весь цикл: установку зависимостей, прогрев V8 JIT, прогон замеров (\`run.mjs\`) и генерацию отчётов (\`./results/last-benchmark.json\`, \`./results/last-benchmark.svg\`, \`./results/last-benchmark.png\` и \`README.md\`).

\`\`\`bash
bash bench.sh
\`\`\`

При первом запуске (если отсутствует \`node_modules\`) скрипт автоматически установит пакеты из \`package.json\` (при недоступности сети сработает оффлайн-фолбэк из локального кэша). При повторных запусках шаг установки пропускается.

### Поддерживаемые флаги

| Флаг | Описание |
| :--- | :--- |
| \`--install\` | Обнуляет \`node_modules\` и принудительно переустанавливает зависимости по версиям из \`package.json\` / \`package-lock.json\`. |
| \`--update\` | Удаляет \`node_modules\` и \`package-lock.json\`, загружает самые свежие версии (\`@latest\`) всех пакетов из npm и обновляет \`package.json\`. |
| \`--local\` | Подключает локальную сборку \`@pravosleva/reactive-engine\` из соседнего репозитория (\`~/projects/reactive-engine/dist\`) через симлинк вместо пакета из npm. |

Флаги можно комбинировать в любом порядке:

\`\`\`bash
bash bench.sh --update --local
\`\`\`
`

fs.writeFileSync(new URL('./README.md', import.meta.url), markdown, 'utf8')
console.log('Корневой ./README.md успешно обновлён!')

process.exit(0)
