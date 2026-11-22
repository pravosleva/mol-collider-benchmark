#!/usr/bin/env bash
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE}")" && pwd)"
cd "$PROJECT_DIR"

START_TS=$(date +%s)

echo "======================================================================"
echo "🚀 Запуск локального стенда \$bog_collider (Node.js $(node -v))"
echo "======================================================================"

if [ ! -f package.json ]; then
  echo "[1/4] Инициализация package.json..."
  npm init -y >/dev/null
  npm pkg set type="module" >/dev/null
else
  echo "[1/4] Конфигурация package.json готова"
fi

mkdir -p node_modules/@pravosleva node_modules/@solidjs node_modules/@reatom

echo "[2/4] Проверка и линковка локальных зависимостей..."

# 1. @pravosleva/reactive-engine
LOCAL_ENGINE_DIR="$HOME/projects/reactive-engine"
if [ -d "$LOCAL_ENGINE_DIR/dist" ]; then
  rm -rf node_modules/@pravosleva/reactive-engine
  ln -s "$LOCAL_ENGINE_DIR" node_modules/@pravosleva/reactive-engine
  echo "   ✔ @pravosleva/reactive-engine -> $LOCAL_ENGINE_DIR"
fi

# 2. @solidjs/signals
if [ ! -e "node_modules/@solidjs/signals" ]; then
  LOCAL_SOLID=$(find "$HOME/projects" -maxdepth 4 -type d -path "*/node_modules/@solidjs/signals" 2>/dev/null | head -n 1 || true)
  if [ -n "$LOCAL_SOLID" ]; then
    ln -s "$LOCAL_SOLID" node_modules/@solidjs/signals
    echo "   ✔ @solidjs/signals -> $LOCAL_SOLID"
  fi
else
  echo "   ✔ @solidjs/signals (локальный)"
fi

# 3. mol_wire_lib
if [ ! -e "node_modules/mol_wire_lib" ]; then
  LOCAL_MOL=$(find "$HOME/projects" -maxdepth 4 -type d -path "*/node_modules/mol_wire_lib" 2>/dev/null | head -n 1 || true)
  if [ -n "$LOCAL_MOL" ] && [ "$LOCAL_MOL" != "$PROJECT_DIR/node_modules/mol_wire_lib" ]; then
    ln -s "$LOCAL_MOL" node_modules/mol_wire_lib
    echo "   ✔ mol_wire_lib -> $LOCAL_MOL"
  fi
else
  echo "   ✔ mol_wire_lib (локальный)"
fi

# 4. mobx
if [ ! -e "node_modules/mobx" ]; then
  LOCAL_MOBX=$(find "$HOME/projects" -maxdepth 4 -type d -path "*/node_modules/mobx" 2>/dev/null | head -n 1 || true)
  if [ -n "$LOCAL_MOBX" ] && [ "$LOCAL_MOBX" != "$PROJECT_DIR/node_modules/mobx" ]; then
    ln -s "$LOCAL_MOBX" node_modules/mobx
    echo "   ✔ mobx -> $LOCAL_MOBX"
  fi
else
  echo "   ✔ mobx (локальный)"
fi

# 5. effector
if [ ! -e "node_modules/effector" ]; then
  LOCAL_EFFECTOR=$(find "$HOME/projects" -maxdepth 4 -type d -path "*/node_modules/effector" 2>/dev/null | head -n 1 || true)
  if [ -n "$LOCAL_EFFECTOR" ] && [ "$LOCAL_EFFECTOR" != "$PROJECT_DIR/node_modules/effector" ]; then
    ln -s "$LOCAL_EFFECTOR" node_modules/effector
    echo "   ✔ effector -> $LOCAL_EFFECTOR"
  fi
else
  echo "   ✔ effector (локальный)"
fi

# 6. @reatom/core
if [ ! -e "node_modules/@reatom/core" ]; then
  LOCAL_REATOM=$(find "$HOME/projects" -maxdepth 4 -type d -path "*/node_modules/@reatom/core" 2>/dev/null | head -n 1 || true)
  if [ -n "$LOCAL_REATOM" ] && [ "$LOCAL_REATOM" != "$PROJECT_DIR/node_modules/@reatom/core" ]; then
    ln -s "$LOCAL_REATOM" node_modules/@reatom/core
    echo "   ✔ @reatom/core -> $LOCAL_REATOM"
  fi
else
  echo "   ✔ @reatom/core (локальный)"
fi

echo "⚡ [3/4] Прогрев JIT и прогон 3 серий по 5 000 итераций (подождите ~10–15 сек)..."
node --expose-gc "$PROJECT_DIR/run.mjs"

echo "[4/4] Генерация ./results/last-benchmark.svg и обновление ./README.md..."
node "$PROJECT_DIR/generate-svg.mjs"
node "$PROJECT_DIR/update-readme.mjs"

END_TS=$(date +%s)
ELAPSED=$((END_TS - START_TS))

echo "======================================================================"
echo "✅ Бенчмарк успешно завершён за ${ELAPSED} сек."
echo "======================================================================"

exit 0
