const LOCAL_KEY = "pml_edit_data";
const MODEL_STATE_KEY = "pml_demon_system_state";
const MODEL_PLAYER_ID = "site-user";
let rawData = [];
let levels = [];
window.verifications = [];
let leaderboard = [];
let maxScore = 1;
let editingIndex = -1;
let demonSystem = null;
let systemRankings = [];
let currentSuggestionPair = null;
let levelMetaByModelId = new Map();
let systemBusy = false;

function parseTimeToSeconds(timeStr) {
  if (!timeStr || timeStr.trim() === "") return Infinity;
  const regex =
    /(\d+)h\s*(\d+)m\s*(\d+)s|(\d+)m\s*(\d+)s|(\d+)s|(\d+)h\s*(\d+)m|(\d+)m|(\d+)h/;
  const match = timeStr.match(regex);
  if (!match) return Infinity;
  let h = 0, m = 0, s = 0;
  if (match[1]) {
    h = parseInt(match[1]);
    m = parseInt(match[2]);
    s = parseInt(match[3]);
  } else if (match[4]) {
    m = parseInt(match[4]);
    s = parseInt(match[5]);
  } else if (match[6]) {
    s = parseInt(match[6]);
  } else if (match[7]) {
    h = parseInt(match[7]);
    m = parseInt(match[8]);
  } else if (match[9]) {
    m = parseInt(match[9]);
  } else if (match[10]) {
    h = parseInt(match[10]);
  }
  return h * 3600 + m * 60 + s;
}

function calculatePoints(rank, maxRank) {
  if (!rank || !maxRank) return 0;
  const base = 10, top = 360;
  if (maxRank === 1) return top;
  const ratio = Math.pow(top / base, 1 / (maxRank - 1));
  return base * Math.pow(ratio, maxRank - rank);
}

function autoThumbnail(id, explicit) {
  if (explicit && explicit.trim() !== "") return explicit;
  const match = String(id).match(/^\d+/);
  return match ? `https://levelthumbs.prevter.me/thumbnail/${match[0]}` : "";
}

function loadData() {
  const saved = localStorage.getItem(LOCAL_KEY);
  if (saved) {
    try {
      return Promise.resolve(JSON.parse(saved));
    } catch (e) { }
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);

  return fetch("levels.json", { signal: controller.signal })
    .then((r) => r.json())
    .finally(() => clearTimeout(timeout));
}

function processRawData(data) {
  rawData = data;

  levels = data
    .filter((item) => item.name)
    .map((item) => {
      const victors = (item.victors || []).map((v) => ({
        name: v.name || "",
        date: v.date || "",
        wrTime: v.time || "",
        wrAttempts: v.attempts || 0,
        victorVideoUrl: v.video || "",
      }));
      return {
        rank: item.rank,
        name: item.name,
        thumbnail: autoThumbnail(item.id, item.image),
        id: item.id,
        points: 0,
        victors,
        creator: item.creators,
        is2Player: item.twoPlayer === "2 Player",
        showcaseVideoUrl: item.showcaseVideo || "",
      };
    });

  const maxRank = Math.max(...levels.map((l) => l.rank));
  levels.forEach((l) => {
    l.points = calculatePoints(l.rank, maxRank);
  });

  levels.forEach((level) => {
    let minTimeSec = Infinity, minAttempts = Infinity;
    let wrTimeObj = null, wrAttemptsObj = null;
    level.victors.forEach((victor) => {
      if (victor.wrTime) {
        const sec = parseTimeToSeconds(victor.wrTime);
        if (sec < minTimeSec) {
          minTimeSec = sec;
          wrTimeObj = { name: victor.name, time: victor.wrTime };
        }
      }
      if (victor.wrAttempts > 0 && victor.wrAttempts < minAttempts) {
        minAttempts = victor.wrAttempts;
        wrAttemptsObj = {
          name: victor.name,
          attempts: victor.wrAttempts.toLocaleString(),
        };
      }
    });
    level.wrTime = wrTimeObj;
    level.wrAttempts = wrAttemptsObj;
  });

  leaderboard = buildLeaderboard(levels);
  maxScore = Math.max(...leaderboard.map((p) => p.points), 1);
  renderStats();
  renderLevels(levels);
  renderLeaderboard(leaderboard);

  const savedVerifications = localStorage.getItem("pml_verifications_data");
  if (savedVerifications) {
    try {
      verifications = JSON.parse(savedVerifications);
      initializeVerifications();
      syncDemonSystemFromRawData();
      return;
    } catch (e) { }
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);

  fetch("verifications.json", { signal: controller.signal })
    .then((r) => r.json())
    .then((data) => {
      verifications = data
        .filter((item) => item.name)
        .map((item) => {
          const victors = (item.victors || []).map((v) => ({
            name: v.name || "",
            date: v.date || "",
            wrTime: v.time || "",
            wrAttempts: v.attempts || 0,
            victorVideoUrl: v.video || "",
          }));
          return {
            rank: item.rank || "?",
            name: item.name,
            thumbnail: autoThumbnail(item.id, item.image),
            id: item.id,
            points: 0,
            victors,
            creator: item.creators,
            is2Player: item.twoPlayer === "2 Player",
            showcaseVideoUrl: item.showcaseVideo || "",
          };
        });
      initializeVerifications();
      syncDemonSystemFromRawData();
    })
    .catch(() => {
      console.log("No verifications.json found, using levels with no victors");
      initializeVerifications();
      syncDemonSystemFromRawData();
    })
    .finally(() => clearTimeout(timeout));
}

function buildLeaderboard(lvls) {
  const map = {};
  lvls.forEach((lvl) => {
    lvl.victors.forEach((v, vi) => {
      if (!map[v.name]) map[v.name] = { name: v.name, points: 0, levels: [] };
      let mult = 1;
      if (vi === 0) mult += 0.25;
      if (lvl.wrTime && v.name === lvl.wrTime.name) mult += 0.25;
      if (lvl.wrAttempts && v.name === lvl.wrAttempts.name) mult += 0.25;
      map[v.name].points += lvl.points * mult;
      map[v.name].levels.push(lvl.name);
    });
  });
  return Object.values(map).sort((a, b) => b.points - a.points);
}

function getDatasetSignature() {
  return rawData
    .map((item, i) => {
      const idPart = String(item.id || item.name || "").trim();
      const rank = Number(item.rank) || 0;
      return `${idPart}::${i}::${rank}`;
    })
    .join("|");
}

function createModelLevelRows() {
  const seen = new Set();
  const rows = [];
  const rankMax = Math.max(...rawData.map((item) => Number(item.rank) || 1), 1);

  rawData.forEach((item, idx) => {
    const baseId = String(item.id || item.name || `level_${idx}`).trim() || `level_${idx}`;
    const modelId = seen.has(baseId) ? `${baseId}__${idx}` : baseId;
    seen.add(modelId);

    const victors = Array.isArray(item.victors) ? item.victors : [];
    const attemptValues = victors
      .map((v) => Number(v.attempts) || 0)
      .filter((n) => n > 0)
      .sort((a, b) => a - b);
    const medianAttempt = attemptValues.length
      ? attemptValues[Math.floor(attemptValues.length / 2)]
      : 1000;

    const rank = Number(item.rank) || (idx + 1);
    const normalizedRank = Math.max(0, Math.min(1, (rankMax - rank) / Math.max(rankMax - 1, 1)));
    const avgDifficulty = Math.min(10, 3 + normalizedRank * 7);
    const completionRate = Math.max(0.05, Math.min(1, victors.length / 6));
    const inputDensity = 1;

    rows.push({
      modelId,
      displayName: item.name || modelId,
      attrs: {
        avgDifficulty,
        attemptsMedian: medianAttempt,
        inputDensity,
        completionRate,
      },
    });
  });

  return rows;
}

function saveModelState(signature) {
  if (!demonSystem) return;
  localStorage.setItem(
    MODEL_STATE_KEY,
    JSON.stringify({
      signature,
      levels: demonSystem.exportLevelStates(),
      comparisons: demonSystem.exportComparisons(),
    }),
  );
}

function loadSavedModelState() {
  const raw = localStorage.getItem(MODEL_STATE_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch (err) {
    return null;
  }
}

function saveAndRefresh() {
  if (editingSource === "verifications") {
    localStorage.setItem("pml_verifications_data", JSON.stringify(verifications));
  } else {
    localStorage.setItem(LOCAL_KEY, JSON.stringify(rawData));
  }

  if (editingSource === "verifications") {
    initializeVerifications();
  } else {
    processRawData(rawData);
  }
  flashSaved();
}

function resetToOriginal() {
  if (!confirm("Clear all local edits and reload from levels.json?")) return;
  localStorage.removeItem(LOCAL_KEY);
  document.getElementById("reset-notice").classList.add("show");
  fetch("levels.json")
    .then((r) => r.json())
    .then((data) => {
      processRawData(data);
      renderEditTable();
      flashSaved();
    });
}

function exportJSON() {
  const data = editingSource === "verifications" ? verifications : rawData;
  navigator.clipboard.writeText(JSON.stringify(data, null, 2)).then(() => {
    flashCopied();
  });
}
