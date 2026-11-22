import { deepEqual as equals } from '@pravosleva/reactive-engine'
import assert from 'node:assert/strict'
import { performance } from 'node:perf_hooks'
import fs from 'node:fs'
import os from 'node:os'

const numbers = Array.from({ length: 5 }, (_, i) => i)
const fib = (n) => (n < 2 ? 1 : fib(n - 1) + fib(n - 2))
const EXPECTED_RES = [8369, 4188, 8364, 8372, 4191, 8369, 4188]

function forceGc() {
  if (typeof global.gc === 'function') {
    global.gc()
    global.gc()
  }
}

function runBenchmark(name, setupFn) {
  process.stdout.write(`   Тестируем ${name}... `)
  const hardCalls = []
  const res = []
  const hard = (n, label) => {
    hardCalls.push(label)
    return n + fib(18)
  }

  const step = setupFn({ hard, res })

  // 1. Проверка корректности и подсчёт вызовов hard() за 2 шага
  hardCalls.length = 0
  step(0)

  const callsSnapshot = [...hardCalls]
  assert.deepEqual(res, EXPECTED_RES, `[${name}] Неверный результат res`)

  // 2. Прогрев JIT (Tier-up в V8 TurboFan / Maglev)
  for (let i = 0; i < 500; i++) {
    step(i)
  }

  // 3. Три контрольных прогона по 5 000 итераций (берём лучшее время — минимум шума ОС)
  const ITERATIONS = 5000
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
    if (elapsedMs < bestTimeMs) {
      bestTimeMs = elapsedMs
    }

    forceGc()
    const heapBefore = process.memoryUsage().heapUsed
    for (let i = 0; i < ITERATIONS; i++) {
      step(i)
    }
    const heapAfterNoGc = process.memoryUsage().heapUsed
    const allocBytes = Math.max(0, (heapAfterNoGc - heapBefore) / ITERATIONS)
    if (allocBytes < bestAllocBytes) {
      bestAllocBytes = allocBytes
    }

    forceGc()
    const heapAfterGc = process.memoryUsage().heapUsed
    const retainedBytes = Math.max(0, (heapAfterGc - heapBefore) / ITERATIONS)
    if (retainedBytes < bestRetainedBytes) {
      bestRetainedBytes = retainedBytes
    }
  }

  const opsPerSec = Math.round((ITERATIONS / bestTimeMs) * 1000)

  console.log(`✔ (${bestTimeMs.toFixed(1)} мс)`)
  return {
    Engine: name,
    'hard() calls': `${callsSnapshot.length} (${callsSnapshot.join(',')})`,
    'Best Time (ms)': Number(bestTimeMs.toFixed(2)),
    'ops/sec': opsPerSec,
    'Alloc (B/iter)': Number(bestAllocBytes.toFixed(1)),
    'Retained (B/iter)': Number(bestRetainedBytes.toFixed(3)),
  }
}

const results = []

// 1. @pravosleva/reactive-engine (v3.0.4 + { equals: deepEqual })
try {
  const reMod = await import('@pravosleva/reactive-engine')
  const { ReactiveEngine, deepEqual: equals } = reMod
  results.push(
    runBenchmark('@pravosleva/reactive-engine', ({ hard, res }) => {
      const engine = new ReactiveEngine()
      const A = engine.signal(0)
      const B = engine.signal(0)
      const C = engine.computed(() => (A.value % 2) + (B.value % 2))
      const D = engine.computed(
        () => numbers.map((i) => ({ x: i + (A.value % 2) - (B.value % 2) })),
        { equals }
      )
      const E = engine.computed(() => hard(C.value + A.value + D.value[0].x, 'E'))
      const F = engine.computed(() => hard(D.value[2].x || B.value, 'F'))
      const G = engine.computed(
        () => C.value + (C.value || E.value % 2) + D.value[4].x + F.value
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
    })
  )
} catch (err) {
  console.log('⛔ @pravosleva/reactive-engine пропущен:', err.message)
}

// 2. SolidJS 2 (@solidjs/signals)
try {
  const solidMod = await import('@solidjs/signals')
  const { createSignal, createMemo, createEffect, createRoot, flush, equals } = solidMod

  results.push(
    runBenchmark('SolidJS 2 (@solidjs/signals)', ({ hard, res }) => {
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
      flush()

      return (i) => {
        res.length = 3
        setB(1)
        setA(1 + i * 2)
        flush()
        setA(2 + i * 2)
        setB(2)
        flush()
      }
    })
  )
} catch (err) {
  console.log('⛔ @solidjs/signals пропущен:', err.message)
}

// 3. $mol (mol_wire_lib)
try {
  const molWirePkg = await import('mol_wire_lib')
  const Let = molWirePkg.default?.$mol_wire_let ?? molWirePkg.$mol_wire_let
  results.push(
    runBenchmark('$mol ($mol_wire_let)', ({ hard, res }) => {
      const { A, B, C, D, E, F, G, H, I, J } = Let({
        A: (n) => n ?? 0,
        B: (n) => n ?? 0,
        C: () => (A() % 2) + (B() % 2),
        D: () => numbers.map((i) => ({ x: i + (A() % 2) - (B() % 2) })),
        E: () => hard(C() + A() + D()[0].x, 'E'),
        F: () => hard(D()[2].x || B(), 'F'),
        G: () => C() + (C() || E() % 2) + D()[4].x + F(),
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
  )
} catch (err) {
  console.log('⛔ mol_wire_lib пропущен:', err.message)
}

// 4. MobX (observable.box + computed + autorun + runInAction)
try {
  const { observable, computed, autorun, runInAction, comparer, configure } = await import('mobx')
  configure({ enforceActions: 'never' })

  results.push(
    runBenchmark('MobX (comparer.structural)', ({ hard, res }) => {
      const A = observable.box(0)
      const B = observable.box(0)

      const C = computed(() => (A.get() % 2) + (B.get() % 2))
      const D = computed(
        () => numbers.map((i) => ({ x: i + (A.get() % 2) - (B.get() % 2) })),
        { equals: comparer.structural }
      )
      const E = computed(() => hard(C.get() + A.get() + D.get().at(0).x, 'E'))
      const F = computed(() => hard(D.get().at(2).x || B.get(), 'F'))
      const G = computed(
        () => C.get() + (C.get() || E.get() % 2) + D.get().at(4).x + F.get()
      )

      const disposeH = autorun(() => res.push(hard(G.get(), 'H')))
      const disposeI = autorun(() => res.push(G.get()))
      const disposeJ = autorun(() => res.push(hard(F.get(), 'J')))

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
  )
} catch (err) {
  console.log('⛔ mobx пропущен:', err.message)
}

// 5. Effector (createStore + combine + createEvent + watch)
try {
  const { createStore, createEvent, combine } = await import('effector')

  results.push(
    runBenchmark('Effector', ({ hard, res }) => {
      const setA = createEvent()
      const setB = createEvent()
      const stepBatch = createEvent()

      const $A = createStore(0).on(setA, (_, v) => v)
      const $B = createStore(0).on(setB, (_, v) => v)

      // Батчинг двух обновлений через единое событие stepBatch
      $A.on(stepBatch, (_, { a }) => a)
      $B.on(stepBatch, (_, { b }) => b)

      const $C = combine($A, $B, (a, b) => (a % 2) + (b % 2))
      const $D = combine(
        $A,
        $B,
        (a, b) => numbers.map((i) => ({ x: i + (a % 2) - (b % 2) })),
        {
          // Встроенный фильтр обновлений стора в Effector (аналог equals)
          updateFilter: (next, prev) => !equals(prev, next),
        }
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
  )
} catch (err) {
  console.log('⛔ effector пропущен:', err.message)
}

// 6. Reatom (@reatom/core v1000+ / v3)
try {
  const reatomMod = await import('@reatom/core')
  // Reatom v1000+ (atom + computed + subscribe + notify)
  const { atom, computed, notify } = reatomMod

  results.push(
    runBenchmark('Reatom (@reatom/core)', ({ hard, res }) => {
      const A = atom(0, 'A')
      const B = atom(0, 'B')
      const C = computed(() => (A() % 2) + (B() % 2), 'C')
      const D = computed(
        () => numbers.map((i) => ({ x: i + (A() % 2) - (B() % 2) })),
        'D'
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

      // Синхронное чтение и подписка
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
  )
} catch (err) {
  console.log('⛔ @reatom/core пропущен:', err.message)
}

// 7. @vue/reactivity (Vue 3)
try {
  const { ref, computed, effect } = await import('@vue/reactivity')

  results.push(
    runBenchmark('@vue/reactivity', ({ hard, res }) => {
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
        if (prevD !== undefined && equals(prevD, next)) {
          return prevD
        }
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
  )
} catch (err) {
  console.log('⛔ @vue/reactivity пропущен:', err.message)
}

// 8. @angular/core (Angular Signals)
try {
  const ngSignals = await import('@angular/core/primitives/signals')
  const { createSignal, createComputed, createWatch, setActiveConsumer } = ngSignals

  results.push(
    runBenchmark('@angular/core (Signals)', ({ hard, res }) => {
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
      // В primitives/signals вторым аргументом передаётся сама функция сравнения (equals)
      const D = createComputed(
        () => numbers.map((i) => ({ x: i + (A() % 2) - (B() % 2) })),
        equals
      )
      const E = createComputed(() => hard(C() + A() + D().at(0).x, 'E'))
      const F = createComputed(() => hard(D().at(2).x || B(), 'F'))
      const G = createComputed(
        () => C() + (C() || E() % 2) + D().at(4).x + F()
      )

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
  )
} catch (err) {
  console.log('⛔ @angular/core пропущен:', err.message)
}

// Колонка с относительным коэффициентом отставания от лидера
// Сортируем по убыванию ops/sec (самый быстрый движок сверху)
results.sort((a, b) => b['ops/sec'] - a['ops/sec'])

const fastestTime = results[0]['Best Time (ms)']
const rankedResults = results.map((row, idx) => ({
  Rank: idx + 1,
  ...row,
  Ratio: `${(row['Best Time (ms)'] / fastestTime).toFixed(2)}×`,
}))

console.log('\nСравнение на графе $bog_collider (5 000 итераций, минимум из 3 прогонов):\n')
console.table(rankedResults)
console.log(`
Примечание о методологии и V8 JIT:
  • Перед замером каждый движок прогревается (500 итераций), чтобы V8 перевёл горячие функции в оптимизированный машинный код (Maglev / TurboFan) и стабилизировал скрытые классы (Hidden Classes).
  • Из 3 прогонов берётся минимальное время (Best Time) — это отсекает случайные фоновые прерывания планировщика ОС и троттлинг CPU.
  • 95% времени в этом тесте занимает рекурсия fib(18), поэтому разница между движками с одинаковым числом вызовов hard() (3 вызова) отражает чистые накладные расходы планировщика и сравнений.
`)

const reportData = {
  timestamp: new Date().toISOString(),
  nodeVersion: process.version,
  platform: `${os.platform()} ${os.arch()}`,
  cpuModel: os.cpus().at(0)?.model?.trim() || 'Unknown CPU',
  iterations: 5000,
  samples: 3,
  results: rankedResults,
}

const resultsDir = new URL('./results/', import.meta.url)
fs.mkdirSync(resultsDir, { recursive: true })
fs.writeFileSync(new URL('./last-benchmark.json', resultsDir), JSON.stringify(reportData, null, 2))

process.exit(0)
