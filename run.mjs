import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import { performance } from 'node:perf_hooks'
import { fileURLToPath } from 'node:url'
import { ReactiveEngine, deepEqual as equals } from '@pravosleva/reactive-engine'
import { execFile } from 'node:child_process'
import path from 'node:path'

const numbers = Array.from({ length: 5 }, (_, i) => i)
const fib = (n) => (n < 2 ? 1 : fib(n - 1) + fib(n - 2))
const EXPECTED_RES = [8369, 4188, 8364, 8372, 4191, 8369, 4188]

function forceGc() {
  if (typeof global.gc === 'function') {
    global.gc()
    global.gc()
  }
}

function getPackageVersion(pkgName) {
  if (!pkgName) return ''
  try {
    const pkgPath = path.join(process.cwd(), 'node_modules', ...pkgName.split('/'), 'package.json')
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'))
    return pkg.version ? `v${ pkg.version }` : ''
  } catch {
    return ''
  }
}

function measureBaseline(iterations) {
  const res = []
  const dummyStep = (i) => {
    res.length = 3
    // Имитация пересоздания массивов в узле D на двух шагах (без реактивности)
    const d1 = numbers.map((n) => ({ x: n + ((1 + i * 2) % 2) - (1 % 2) }))
    const d2 = numbers.map((n) => ({ x: n + ((2 + i * 2) % 2) - (2 % 2) }))
    res.push(d1[0].x, d2[0].x, d1[2].x, d2[2].x)
  }

  for (let i = 0; i < 500; i++) dummyStep(i)

  let minAlloc = Infinity
  for (let s = 0; s < 3; s++) {
    forceGc()
    const before = process.memoryUsage().heapUsed
    for (let i = 0; i < iterations; i++) dummyStep(i)
    const after = process.memoryUsage().heapUsed
    const perIter = Math.max(0, (after - before) / iterations)
    if (perIter < minAlloc) minAlloc = perIter
  }
  return minAlloc
}

function measureEngine(name, setupFn) {
  const hardCalls = []
  const res = []
  const hard = (n, label) => {
    hardCalls.push(label)
    return n + fib(18)
  }

  const step = setupFn({ hard, res })

  // 1. Проверка корректности
  hardCalls.length = 0
  step(0)

  const callsSnapshot = [...hardCalls]
  assert.deepEqual(res, EXPECTED_RES, `[${ name }] Неверный результат res`)

  // 2. Прогрев JIT
  for (let i = 0; i < 500; i++) {
    step(i)
  }

  // 3. Три контрольных прогона (берём минимум)
  const ITERATIONS = 5000
  const baselineAlloc = measureBaseline(ITERATIONS)
  const SAMPLES = 3
  let bestTimeMs = Infinity
  let bestAllocBytes = Infinity
  let bestRetainedBytes = Infinity

  for (let s = 0; s < SAMPLES; s++) {
    forceGc()
    const t0 = performance.now()
    for (let i = 0; i < ITERATIONS; i++) {
      step(i)
    }
    const elapsedMs = performance.now() - t0
    if (elapsedMs < bestTimeMs) bestTimeMs = elapsedMs

    forceGc()
    const heapBefore = process.memoryUsage().heapUsed
    for (let i = 0; i < ITERATIONS; i++) {
      step(i)
    }
    const heapAfterNoGc = process.memoryUsage().heapUsed
    const allocBytes = Math.max(0, (heapAfterNoGc - heapBefore) / ITERATIONS)
    if (allocBytes < bestAllocBytes) bestAllocBytes = allocBytes

    forceGc()
    const heapAfterGc = process.memoryUsage().heapUsed
    const retainedBytes = Math.max(0, (heapAfterGc - heapBefore) / ITERATIONS)
    if (retainedBytes < bestRetainedBytes) bestRetainedBytes = retainedBytes
  }

  const opsPerSec = Math.round((ITERATIONS / bestTimeMs) * 1000)
  const netAllocBytes = Math.max(0, bestAllocBytes - baselineAlloc)

  return {
    Engine: name,
    'hard() calls': `${ callsSnapshot.length } (${ callsSnapshot.join(',') })`,
    'Best Time (ms)': Number(bestTimeMs.toFixed(2)),
    'ops/sec': opsPerSec,
    'Alloc (B/iter)': Number(bestAllocBytes.toFixed(1)),
    'Net Alloc (B/iter)': Number(netAllocBytes.toFixed(1)),
    'Retained (B/iter)': Number(bestRetainedBytes.toFixed(3)),
  }
}

// ============================================================================
// Реестр всех 10 движков (каждый загружается лениво только в своём процессе)
// ============================================================================
const ENGINES = [
  {
    id: 'reactive-engine',
    pkg: '@pravosleva/reactive-engine',
    name: '@pravosleva/reactive-engine',
    run: async () =>
      measureEngine('@pravosleva/reactive-engine', ({ hard, res }) => {
        const engine = new ReactiveEngine()
        const A = engine.signal(0)
        const B = engine.signal(0)
        const C = engine.computed(() => (A.value % 2) + (B.value % 2))
        const D = engine.computed(
          () => numbers.map((i) => ({ x: i + (A.value % 2) - (B.value % 2) })),
          { equals }
        )
        const E = engine.computed(() => hard(C.value + A.value + D.value.at(0).x, 'E'))
        const F = engine.computed(() => hard(D.value.at(2).x || B.value, 'F'))
        const G = engine.computed(
          () => C.value + (C.value || E.value % 2) + D.value.at(4).x + F.value
        )

        engine.effect(() => res.push(hard(G.value, 'H')))
        engine.effect(() => res.push(G.value))
        engine.effect(() => res.push(hard(F.value, 'J')))

        return (i) => {
          res.length = 3
          engine.batch(() => {
            B.value = 1
            A.value = 1 + i * 2
          })
          engine.batch(() => {
            A.value = 2 + i * 2
            B.value = 2
          })
        }
      }),
  },
  {
    id: 'vue',
    pkg: '@vue/reactivity',
    name: '@vue/reactivity',
    run: async () => {
      const { ref, computed, effect } = await import('@vue/reactivity')
      return measureEngine('@vue/reactivity', ({ hard, res }) => {
        const queue = new Set()
        const flushVue = () => {
          for (const job of queue) {
            queue.delete(job)
            job()
          }
        }

        const A = ref(0)
        const B = ref(0)
        const C = computed(() => (A.value % 2) + (B.value % 2))
        let prevD
        const D = computed(() => {
          const next = numbers.map((i) => ({ x: i + (A.value % 2) - (B.value % 2) }))
          if (prevD !== undefined && equals(prevD, next)) return prevD
          prevD = next
          return next
        })
        const E = computed(() => hard(C.value + A.value + D.value.at(0).x, 'E'))
        const F = computed(() => hard(D.value.at(2).x || B.value, 'F'))
        const G = computed(
          () => C.value + (C.value || E.value % 2) + D.value.at(4).x + F.value
        )

        let lastH
        const runnerH = effect(
          () => {
            const g = G.value
            if (Object.is(g, lastH)) return
            lastH = g
            res.push(hard(g, 'H'))
          },
          { scheduler: () => queue.add(runnerH) }
        )

        let lastI
        const runnerI = effect(
          () => {
            const g = G.value
            if (Object.is(g, lastI)) return
            lastI = g
            res.push(g)
          },
          { scheduler: () => queue.add(runnerI) }
        )

        let lastJ
        const runnerJ = effect(
          () => {
            const f = F.value
            if (Object.is(f, lastJ)) return
            lastJ = f
            res.push(hard(f, 'J'))
          },
          { scheduler: () => queue.add(runnerJ) }
        )

        return (i) => {
          res.length = 3
          B.value = 1
          A.value = 1 + i * 2
          flushVue()
          A.value = 2 + i * 2
          B.value = 2
          flushVue()
        }
      })
    },
  },
  {
    id: 'angular',
    pkg: '@angular/core',
    name: '@angular/core (Signals)',
    run: async () => {
      const { createSignal, createComputed, createWatch, setActiveConsumer } = await import(
        '@angular/core/primitives/signals'
      )
      return measureEngine('@angular/core (Signals)', ({ hard, res }) => {
        const queue = new Set()
        const flushAngular = () => {
          for (const w of queue) {
            queue.delete(w)
            w.run()
          }
        }

        const [A, setA] = createSignal(0)
        const [B, setB] = createSignal(0)
        const C = createComputed(() => (A() % 2) + (B() % 2))
        const D = createComputed(
          () => numbers.map((i) => ({ x: i + (A() % 2) - (B() % 2) })),
          equals
        )
        const E = createComputed(() => hard(C() + A() + D().at(0).x, 'E'))
        const F = createComputed(() => hard(D().at(2).x || B(), 'F'))
        const G = createComputed(() => C() + (C() || E() % 2) + D().at(4).x + F())

        const watchH = createWatch(
          () => res.push(hard(G(), 'H')),
          () => queue.add(watchH),
          true
        )
        const watchI = createWatch(
          () => res.push(G()),
          () => queue.add(watchI),
          true
        )
        const watchJ = createWatch(
          () => res.push(hard(F(), 'J')),
          () => queue.add(watchJ),
          true
        )

        const prevConsumer = setActiveConsumer(null)
        try {
          watchH.run()
          watchI.run()
          watchJ.run()
        } finally {
          setActiveConsumer(prevConsumer)
        }

        return (i) => {
          res.length = 3
          setB(1)
          setA(1 + i * 2)
          flushAngular()
          setA(2 + i * 2)
          setB(2)
          flushAngular()
        }
      })
    },
  },
  {
    id: 'mobx',
    pkg: 'mobx',
    name: 'MobX (comparer.structural)',
    run: async () => {
      const mobxPkg = await import('mobx')
      const mobx = mobxPkg.default ?? mobxPkg
      const { observable, computed, autorun, runInAction, comparer, configure } = mobx
      if (typeof configure === 'function') configure({ enforceActions: 'never' })
      const structEquals = comparer?.structural ?? equals

      return measureEngine('MobX (comparer.structural)', ({ hard, res }) => {
        const A = observable.box(0)
        const B = observable.box(0)
        const C = computed(() => (A.get() % 2) + (B.get() % 2))
        const D = computed(
          () => numbers.map((i) => ({ x: i + (A.get() % 2) - (B.get() % 2) })),
          { equals: structEquals }
        )
        const E = computed(() => hard(C.get() + A.get() + D.get().at(0).x, 'E'))
        const F = computed(() => hard(D.get().at(2).x || B.get(), 'F'))
        const G = computed(
          () => C.get() + (C.get() || E.get() % 2) + D.get().at(4).x + F.get()
        )

        autorun(() => res.push(hard(G.get(), 'H')))
        autorun(() => res.push(G.get()))
        autorun(() => res.push(hard(F.get(), 'J')))

        return (i) => {
          res.length = 3
          runInAction(() => {
            B.set(1)
            A.set(1 + i * 2)
          })
          runInAction(() => {
            A.set(2 + i * 2)
            B.set(2)
          })
        }
      })
    },
  },
  {
    id: 'mol',
    pkg: 'mol_wire_lib',
    name: '$mol ($mol_wire_let)',
    run: async () => {
      const molWirePkg = await import('mol_wire_lib')
      const Let = molWirePkg.default?.$mol_wire_let ?? molWirePkg.$mol_wire_let
      return measureEngine('$mol ($mol_wire_let)', ({ hard, res }) => {
        const { A, B, C, D, E, F, G, H, I, J } = Let({
          A: (n) => n ?? 0,
          B: (n) => n ?? 0,
          C: () => (A() % 2) + (B() % 2),
          D: () => numbers.map((i) => ({ x: i + (A() % 2) - (B() % 2) })),
          E: () => hard(C() + A() + D().at(0).x, 'E'),
          F: () => hard(D().at(2).x || B(), 'F'),
          G: () => C() + (C() || E() % 2) + D().at(4).x + F(),
          H: () => res.push(hard(G(), 'H')),
          I: () => res.push(G()),
          J: () => res.push(hard(F(), 'J')),
        })

        const tick = () => {
          H()
          I()
          J()
        }
        tick()
        return (i) => {
          res.length = 3
          B(1)
          A(1 + i * 2)
          tick()
          A(2 + i * 2)
          B(2)
          tick()
        }
      })
    },
  },
  {
    id: 'solid2',
    pkg: '@solidjs/signals',
    name: 'SolidJS 2 (@solidjs/signals)',
    run: async () => {
      const solidMod = await import('@solidjs/signals')
      const { createSignal, createMemo, createEffect, createRoot } = solidMod
      const doFlush = solidMod.flush ?? solidMod.flushSync ?? (() => { })
      return measureEngine('SolidJS 2 (@solidjs/signals)', ({ hard, res }) => {
        const [A, setA] = createSignal(0)
        const [B, setB] = createSignal(0)
        createRoot(() => {
          const C = createMemo(() => (A() % 2) + (B() % 2))
          const D = createMemo(
            () => numbers.map((i) => ({ x: i + (A() % 2) - (B() % 2) })),
            { equals }
          )
          const E = createMemo(() => hard(C() + A() + D().at(0).x, 'E'))
          const F = createMemo(() => hard(D().at(2).x || B(), 'F'))
          const G = createMemo(() => C() + (C() || E() % 2) + D().at(4).x + F())
          createEffect(G, (g) => {
            res.push(hard(g, 'H'))
          })
          createEffect(G, (g) => {
            res.push(g)
          })
          createEffect(F, (f) => {
            res.push(hard(f, 'J'))
          })
        })
        doFlush()
        return (i) => {
          res.length = 3
          setB(1)
          setA(1 + i * 2)
          doFlush()
          setA(2 + i * 2)
          setB(2)
          doFlush()
        }
      })
    },
  },
  {
    id: 'alien-signals',
    pkg: 'alien-signals',
    name: 'alien-signals',
    run: async () => {
      const alienMod = await import('alien-signals')
      const { signal, computed, effect, startBatch, endBatch } = alienMod
      return measureEngine('alien-signals', ({ hard, res }) => {
        const A = signal(0)
        const B = signal(0)
        const C = computed(() => (A() % 2) + (B() % 2))
        const D = computed(() =>
          numbers.map((i) => ({ x: i + (A() % 2) - (B() % 2) }))
        )
        const E = computed(() => hard(C() + A() + D().at(0).x, 'E'))
        const F = computed(() => hard(D().at(2).x || B(), 'F'))
        const G = computed(() => C() + (C() || E() % 2) + D().at(4).x + F())
        effect(() => {
          res.push(hard(G(), 'H'))
        })
        effect(() => {
          res.push(G())
        })
        effect(() => {
          res.push(hard(F(), 'J'))
        })
        return (i) => {
          res.length = 3
          startBatch()
          B(1)
          A(1 + i * 2)
          endBatch()
          startBatch()
          A(2 + i * 2)
          B(2)
          endBatch()
        }
      })
    },
  },
  {
    id: 'preact-signals',
    pkg: '@preact/signals-core',
    name: '@preact/signals-core',
    run: async () => {
      const { signal, computed, effect, batch } = await import('@preact/signals-core')
      return measureEngine('@preact/signals-core', ({ hard, res }) => {
        const A = signal(0)
        const B = signal(0)
        const C = computed(() => (A.value % 2) + (B.value % 2))
        const D = computed(() =>
          numbers.map((i) => ({ x: i + (A.value % 2) - (B.value % 2) }))
        )
        const E = computed(() => hard(C.value + A.value + D.value.at(0).x, 'E'))
        const F = computed(() => hard(D.value.at(2).x || B.value, 'F'))
        const G = computed(
          () => C.value + (C.value || E.value % 2) + D.value.at(4).x + F.value
        )
        effect(() => res.push(hard(G.value, 'H')))
        effect(() => res.push(G.value))
        effect(() => res.push(hard(F.value, 'J')))
        return (i) => {
          res.length = 3
          batch(() => {
            B.value = 1
            A.value = 1 + i * 2
          })
          batch(() => {
            A.value = 2 + i * 2
            B.value = 2
          })
        }
      })
    },
  },
  {
    id: 'reatom',
    pkg: '@reatom/core',
    name: 'Reatom (@reatom/core)',
    run: async () => {
      const { atom, computed, notify } = await import('@reatom/core')
      return measureEngine('Reatom (@reatom/core)', ({ hard, res }) => {
        const A = atom(0, 'A')
        const B = atom(0, 'B')
        const C = computed(() => (A() % 2) + (B() % 2), 'C')
        const D = computed(
          () => numbers.map((i) => ({ x: i + (A() % 2) - (B() % 2) })),
          { name: 'D', isEqual: equals }
        )
        const E = computed(() => hard(C() + A() + D().at(0).x, 'E'), 'E')
        const F = computed(() => hard(D().at(2).x || B(), 'F'), 'F')
        const G = computed(() => {
          const c = C()
          return c + (c || E() % 2) + D().at(4).x + F()
        }, 'G')
        const H = computed(() => res.push(hard(G(), 'H')), 'H')
        const I = computed(() => res.push(G()), 'I')
        const J = computed(() => res.push(hard(F(), 'J')), 'J')
        H.subscribe()
        I.subscribe()
        J.subscribe()
        return (i) => {
          res.length = 3
          B.set(1)
          A.set(1 + i * 2)
          if (typeof notify === 'function') notify()
          A.set(2 + i * 2)
          B.set(2)
          if (typeof notify === 'function') notify()
        }
      })
    },
  },
  {
    id: 'effector',
    pkg: 'effector',
    name: 'Effector',
    run: async () => {
      const effPkg = await import('effector')
      const { createStore, createEvent, combine } = effPkg.default ?? effPkg
      return measureEngine('Effector', ({ hard, res }) => {
        const stepBatch = createEvent()
        const $A = createStore(0).on(stepBatch, (_, payload) => payload.a)
        const $B = createStore(0).on(stepBatch, (_, payload) => payload.b)
        const $C = combine($A, $B, (a, b) => (a % 2) + (b % 2))
        const $D = combine(
          $A,
          $B,
          (a, b) => numbers.map((i) => ({ x: i + (a % 2) - (b % 2) })),
          { updateFilter: (next, prev) => !equals(prev, next) }
        )
        const $E = combine($C, $A, $D, (c, a, d) => hard(c + a + d.at(0).x, 'E'))
        const $F = combine($D, $B, (d, b) => hard(d.at(2).x || b, 'F'))
        const $G = combine(
          $C,
          $E,
          $D,
          $F,
          (c, e, d, f) => c + (c || e % 2) + d.at(4).x + f
        )
        $G.watch((g) => res.push(hard(g, 'H')))
        $G.watch((g) => res.push(g))
        $F.watch((f) => res.push(hard(f, 'J')))
        return (i) => {
          res.length = 3
          stepBatch({ a: 1 + i * 2, b: 1 })
          stepBatch({ a: 2 + i * 2, b: 2 })
        }
      })
    },
  },
]
// ============================================================================
// Режим дочернего воркера (--only=) vs Оркестратор
// ============================================================================
const onlyArg = process.argv.find((a) => a.startsWith('--only='))
if (onlyArg) {
  const targetId = onlyArg.slice('--only='.length)
  const entry = ENGINES.find((e) => e.id === targetId)
  if (!entry) {
    process.stderr.write(`Unknown engine id: ${ targetId }\n`)
    process.exit(1)
  }
  try {
    const result = await entry.run()
    result.Version = getPackageVersion(entry.pkg)
    process.stdout.write(`__RESULT__:${ JSON.stringify(result) }\n`)
    process.exit(0)
  } catch (err) {
    process.stderr.write(`${ err.message }\n`)
    process.exit(1)
  }
} else {
  const scriptPath = fileURLToPath(import.meta.url)
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
  const FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']
  const isTTY = Boolean(process.stdout.isTTY)

  const runWorkerWithSpinner = (engine, index, total) =>
    new Promise((resolve) => {
      const prefix = `   [${ index + 1 }/${ total }] ${ engine.name }`
      const startedAt = performance.now()
      let frameIdx = 0
      let timer = null

      if (isTTY) {
        timer = setInterval(() => {
          const sec = ((performance.now() - startedAt) / 1000).toFixed(1)
          const frame = FRAMES[frameIdx++ % FRAMES.length]
          process.stdout.write(`\r\x1b[K${ prefix } ${ frame } (${ sec }s)`)
        }, 80)
      } else {
        process.stdout.write(`${ prefix }... `)
      }

      execFile(
        process.execPath,
        ['--expose-gc', scriptPath, `--only=${ engine.id }`],
        { encoding: 'utf8' },
        (err, stdout, stderr) => {
          if (timer) clearInterval(timer)
          if (isTTY) process.stdout.write('\r\x1b[K')

          if (err) {
            const errMsg = stderr?.toString().trim() || err.message
            console.log(`${ prefix } ⛔ пропущен (${ errMsg })`)
            resolve(null)
            return
          }

          const markerLine = stdout
            .split('\n')
            .find((line) => line.startsWith('__RESULT__:'))

          if (!markerLine) {
            console.log(`${ prefix } ⛔ пропущен (нет строки результата от воркера)`)
            resolve(null)
            return
          }

          try {
            const parsed = JSON.parse(markerLine.slice('__RESULT__:'.length))
            console.log(`${ prefix } ✔ (${ parsed['Best Time (ms)'].toFixed(1) } мс)`)
            resolve(parsed)
          } catch (parseErr) {
            console.log(`${ prefix } ⛔ ошибка JSON (${ parseErr.message })`)
            resolve(null)
          }
        }
      )
    })

  const results = []
  for (let i = 0; i < ENGINES.length; i++) {
    const res = await runWorkerWithSpinner(ENGINES[i], i, ENGINES.length)
    if (res) results.push(res)

    if (i < ENGINES.length - 1) {
      if (isTTY) process.stdout.write('   ❄️  Пауза для стабилизации CPU (0.8s)...')
      await sleep(800)
      if (isTTY) process.stdout.write('\r\x1b[K')
    }
  }

  results.sort((a, b) => b['ops/sec'] - a['ops/sec'])

  const fastestTime = results.at(0)['Best Time (ms)']
  const rankedResults = results.map((row, idx) => ({
    Rank: idx + 1,
    ...row,
    Ratio: `${ (row['Best Time (ms)'] / fastestTime).toFixed(2) }×`,
  }))

  console.log('\nСравнение на графе $bog_collider (изолированные V8-процессы, минимум из 3 прогонов):\n')
  console.table(rankedResults)
  console.log(`
Примечание о методологии и V8 JIT:
  • Каждый движок тестируется в отдельном изолированном процессе Node.js (--expose-gc) с паузой 800 мс между прогонами для исключения взаимного влияния кучи V8 и троттлинга CPU.
  • Перед замером каждый движок прогревается (500 итераций), чтобы V8 перевёл горячие функции в оптимизированный машинный код (Maglev / TurboFan) и стабилизировал скрытые классы (Hidden Classes).
  • Из 3 прогонов берётся минимальное время (Best Time) — это отсекает случайные фоновые прерывания планировщика ОС.
`)

  const reportData = {
    timestamp: new Date().toISOString(),
    nodeVersion: process.version,
    platform: `${ os.platform() } ${ os.arch() }`,
    cpuModel: os.cpus().at(0)?.model?.trim() || 'Unknown CPU',
    iterations: 5000,
    samples: 3,
    isolatedProcesses: true,
    results: rankedResults,
  }

  const resultsDir = new URL('./results/', import.meta.url)
  fs.mkdirSync(resultsDir, { recursive: true })
  fs.writeFileSync(new URL('./last-benchmark.json', resultsDir), JSON.stringify(reportData, null, 2))

  process.exit(0)
}
