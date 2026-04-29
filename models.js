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
  currentSuggestionPair = demonSystem.suggestComparison();
  renderSuggestion();
  if (currentSuggestionPair) {
    const [idA, idB] = currentSuggestionPair;
    setSystemStatus(
      `New pair ready: ${levelMetaByModelId.get(idA) || idA} vs ${levelMetaByModelId.get(idB) || idB}. Choose the harder level.`,
    );
  } else {
    setSystemStatus("Could not find a useful pair. Add more levels or reset comparisons.");
  }
  if (save) saveModelState(getDatasetSignature());
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
  demonSystem.addComparison(idA, idB, winner, MODEL_PLAYER_ID);
  demonSystem.fit();
  saveModelState(getDatasetSignature());
  refreshSystemViews();
  setSystemStatus(`Recorded: ${winnerName} > ${loserName}. Rankings updated and a new pair is ready.`);
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
