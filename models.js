let lastSuggestionPair = null;
let lastComparisonSnapshot = null;
const MAX_SKIPPED_PAIRS = 20;
let skippedPairs = new Set();
let skippedPairOrder = [];

function pairKey(a, b) {
  return a < b ? `${a}||${b}` : `${b}||${a}`;
}

function rememberSkippedPair(key) {
  if (skippedPairs.has(key)) return;
  skippedPairs.add(key);
  skippedPairOrder.push(key);
  while (skippedPairOrder.length > MAX_SKIPPED_PAIRS) {
    skippedPairs.delete(skippedPairOrder.shift());
  }
}

function clearSkippedPairs() {
  skippedPairs.clear();
  skippedPairOrder.length = 0;
}

function selectSuggestedComparison(excludedKeys = new Set()) {
  if (!demonSystem || !demonSystem.levels) return null;

  const ids = [...demonSystem.levels.keys()];
  const candidates = [];

  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) {
      const key = pairKey(ids[i], ids[j]);
      if (excludedKeys.has(key)) continue;
      candidates.push([ids[i], ids[j]]);
    }
  }

  if (candidates.length === 0) return null;
  return candidates[Math.floor(Math.random() * candidates.length)];
}

function applySavedComparisons(comparisons, validIds) {
  if (!Array.isArray(comparisons)) return;
  comparisons.forEach((comp) => {
    if (!comp) return;
    if (!validIds.has(comp.levelA) || !validIds.has(comp.levelB)) return;
    if (comp.winnerId !== comp.levelA && comp.winnerId !== comp.levelB) return;
    demonSystem.addComparison(comp.levelA, comp.levelB, comp.winnerId, MODEL_PLAYER_ID);
    const created = demonSystem.comparisons[demonSystem.comparisons.length - 1];
    if (created && Number.isFinite(Number(comp.timestamp))) {
      created.timestamp = Number(comp.timestamp);
    }
    if (created && typeof comp.id === "string" && comp.id) {
      created.id = comp.id;
    }
  });
}

function syncDemonSystemFromRawData() {
  setSystemBusy(true);
  if (typeof window.DemonListSystem !== "function") {
    renderSystemUnavailable("System unavailable: ranking engine failed to load.");
    setSystemBusy(false);
    return;
  }

  const levelRows = createModelLevelRows();
  const validIds = new Set(levelRows.map((row) => row.modelId));
  levelMetaByModelId = new Map(levelRows.map((row) => [row.modelId, row.displayName]));
  const signature = getDatasetSignature();
  const saved = loadSavedModelState();

  demonSystem = new window.DemonListSystem();
  demonSystem.addPlayer(MODEL_PLAYER_ID);
  levelRows.forEach((row) => {
    demonSystem.addLevel(row.modelId, row.attrs);
  });

  if (saved && saved.signature === signature) {
    const safeLevelStates = Array.isArray(saved.levels)
      ? saved.levels.filter((lvl) => lvl && validIds.has(lvl.id))
      : [];
    demonSystem.importLevels(safeLevelStates);
    applySavedComparisons(saved.comparisons, validIds);
  }

  lastSuggestionPair = null;
  lastComparisonSnapshot = null;
  clearSkippedPairs();
  demonSystem.fit();
  saveModelState(signature);
  refreshSystemViews();
  setSystemBusy(false);
}

function refreshSystemViews() {
  if (!demonSystem) return;
  systemRankings = demonSystem
    .exportRankings()
    .map((row) => ({ ...row, name: levelMetaByModelId.get(row.id) || row.id }));
  renderSystemRankings(systemRankings);
  requestNewSuggestion(false);
}

function requestNewSuggestion(save = true) {
  if (systemBusy) return;
  if (!demonSystem) {
    setSystemStatus("System unavailable: ranking engine not ready.");
    renderSuggestion();
    return;
  }

  const raw = demonSystem.suggestComparison();
  let suggested = raw ? [...raw] : null;
  const excludedKeys = new Set(skippedPairs);
  if (suggested) {
    const rawKey = pairKey(suggested[0], suggested[1]);
    if (excludedKeys.has(rawKey)) {
      const alt = selectSuggestedComparison(excludedKeys);
      suggested = alt || suggested;
    }
  }
  currentSuggestionPair = suggested;

  if (currentSuggestionPair) {
    const isSamePair =
      lastSuggestionPair &&
      ((currentSuggestionPair[0] === lastSuggestionPair[0] &&
        currentSuggestionPair[1] === lastSuggestionPair[1]) ||
        (currentSuggestionPair[0] === lastSuggestionPair[1] &&
          currentSuggestionPair[1] === lastSuggestionPair[0]));
    if (isSamePair || Math.random() > 0.5) {
      currentSuggestionPair = [currentSuggestionPair[1], currentSuggestionPair[0]];
    }
    lastSuggestionPair = currentSuggestionPair;
    const [idA, idB] = currentSuggestionPair;
    const compCount = Array.isArray(demonSystem.comparisons) ? demonSystem.comparisons.length : 0;
    setSystemStatus(
      `#${compCount + 1} — ${levelMetaByModelId.get(idA) || idA} vs ${levelMetaByModelId.get(idB) || idB}. Choose the harder level.`,
    );
  } else {
    setSystemStatus("No more useful pairs to compare. Rankings are well-determined.");
  }

  renderSuggestion();
  if (save) saveModelState(getDatasetSignature());
}

function skipSuggestion() {
  if (systemBusy || !currentSuggestionPair) return;
  rememberSkippedPair(pairKey(currentSuggestionPair[0], currentSuggestionPair[1]));
  requestNewSuggestion(false);
}

function pickSuggestedWinner(side) {
  if (systemBusy) return;
  if (!demonSystem) {
    setSystemStatus("System unavailable: ranking engine not ready.");
    return;
  }
  if (!currentSuggestionPair) {
    setSystemStatus("No active pair selected. Click Suggest New Pair first.");
    return;
  }
  const [idA, idB] = currentSuggestionPair;
  const winner = side === "a" ? idA : idB;
  const loser = side === "a" ? idB : idA;
  const winnerName = levelMetaByModelId.get(winner) || winner;
  const loserName = levelMetaByModelId.get(loser) || loser;

  lastComparisonSnapshot = {
    pair: [idA, idB],
    comparisons: demonSystem.comparisons.map((c) => ({ ...c })),
  };
  rememberSkippedPair(pairKey(idA, idB));

  demonSystem.addComparison(idA, idB, winner, MODEL_PLAYER_ID);
  demonSystem.fit();
  saveModelState(getDatasetSignature());
  refreshSystemViews();
  setSystemStatus(`Recorded: ${winnerName} > ${loserName}. Rankings updated.`);
}

function undoLastComparison() {
  if (systemBusy) return;
  if (!lastComparisonSnapshot) {
    setSystemStatus("Nothing to undo.");
    return;
  }
  setSystemBusy(true);
  const snapshot = lastComparisonSnapshot;
  lastComparisonSnapshot = null;
  demonSystem.comparisons = snapshot.comparisons;
  demonSystem.fit();
  saveModelState(getDatasetSignature());
  refreshSystemViews();
  setSystemStatus("Last comparison undone. Rankings reverted.");
  setSystemBusy(false);
}

function resetModelState() {
  if (systemBusy) return;
  if (!confirm("Reset all recorded comparison choices and return rankings to baseline?")) return;
  setSystemBusy(true);
  setSystemStatus("Resetting comparison history and rebuilding baseline rankings...");
  localStorage.removeItem(MODEL_STATE_KEY);
  syncDemonSystemFromRawData();
  setSystemStatus("Reset complete. Baseline rankings restored.");
}
