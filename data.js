const LOCAL_KEY = "pml_edit_data";
const MODEL_STATE_KEY = "pml_demon_system_state";
let rawData = [];
let levels = [];
window.verifications = [];
let leaderboard = [];
let maxScore = 1;
let editingIndex = -1;

function syncDemonSystemFromRawData() {
}

function fetchWithTimeout(url, timeoutMs = 10000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, { signal: controller.signal }).finally(() => clearTimeout(timeout));
}

function parseTimeToSeconds(timeStr) {
  if (!timeStr || timeStr.trim() === "") return Infinity;
  const regex =
    /(\d+)h\s*(\d+)m\s*(\d+)s|(\d+)h\s*(\d+)s|(\d+)m\s*(\d+)s|(\d+)s|(\d+)h\s*(\d+)m|(\d+)m|(\d+)h/;
  const match = timeStr.match(regex);
  if (!match) return Infinity;
  let h = 0, m = 0, s = 0;
  if (match[1]) {
    h = parseInt(match[1], 10);
    m = parseInt(match[2], 10);
    s = parseInt(match[3], 10);
  } else if (match[4]) {
    h = parseInt(match[4], 10);
    s = parseInt(match[5], 10);
  } else if (match[6]) {
    m = parseInt(match[6], 10);
    s = parseInt(match[7], 10);
  } else if (match[8]) {
    s = parseInt(match[8], 10);
  } else if (match[9]) {
    h = parseInt(match[9], 10);
    m = parseInt(match[10], 10);
  } else if (match[11]) {
    m = parseInt(match[11], 10);
  } else if (match[12]) {
    h = parseInt(match[12], 10);
  }
  return h * 3600 + m * 60 + s;
}

function getDemonSystem() {
  return typeof window !== "undefined" ? window.demonSystem : null;
}

function getVictorSortValue(victor) {
  if (!victor || typeof victor !== "object") return null;
  const rawDate = victor.date;
  if (typeof rawDate !== "string" || rawDate.trim() === "") return null;
  const parsed = Date.parse(rawDate);
  return Number.isNaN(parsed) ? null : parsed;
}

function sortVictorsByDate(victors) {
  return [...victors].sort((a, b) => {
    const aValue = getVictorSortValue(a);
    const bValue = getVictorSortValue(b);

    if (aValue == null && bValue == null) return 0;
    if (aValue == null) return 1;
    if (bValue == null) return -1;
    return aValue - bValue;
  });
}

function calculatePoints(rank, maxRank) {
  if (!rank || !maxRank) return 0;
  const base = 10, top = 360;
  if (maxRank === 1) return top;
  const ratio = Math.pow(top / base, 1 / (maxRank - 1));
  return base * Math.pow(ratio, maxRank - rank);
}

function getTierByName(name) {
  if (typeof name !== "string") return "";
  const normalized = name.toLowerCase();
  const mapping = {
    "WEINERclub": "Novice",
    "Rainstorm": "Intermediate",
    "Sakupen End": "Advanced",
    "Under The Sea": "Insane",
    "kataTARTARUS": "Legendary",
    "Bloodiest Water": "Master",
    "Six Paths of Pain (Unnerfed)": "Divine",
    "Sashozz Geometry": "Transcendent"
  };
  for (const key in mapping) {
    if (normalized.includes(key.toLowerCase())) return mapping[key];
  }
  return "";
}

function assignTiers(levelsList) {
  if (!Array.isArray(levelsList) || !levelsList.length) return;
  const markers = [
    { key: "WEINERclub", tier: "Novice" },
    { key: "Rainstorm", tier: "Intermediate" },
    { key: "Sakupen End", tier: "Advanced" },
    { key: "Under The Sea", tier: "Insane" },
    { key: "kataTARTARUS", tier: "Legendary" },
    { key: "Bloodiest Water", tier: "Master" },
    { key: "Six Paths of Pain (Unnerfed)", tier: "Divine" },
    { key: "Kingdom of Miracalis (Unnerfed)", tier: "Transcendent" }
  ];

  const names = levelsList.map((l) => (l.name || "").toLowerCase());
  const found = markers
    .map((m) => ({ ...m, index: names.findIndex((n) => n.includes(m.key.toLowerCase())) }))
    .filter((m) => m.index !== -1)
    .sort((a, b) => a.index - b.index);

  found.forEach((marker, i) => {
    const start = marker.index;
    const end = i + 1 < found.length ? found[i + 1].index : levelsList.length;
    for (let k = start; k < end; k++) {
      levelsList[k].tier = marker.tier;
    }
  });

  levelsList.forEach((lvl) => {
    if (!lvl.tier) lvl.tier = getTierByName(lvl.name);
  });
}

function autoThumbnail(explicit) {
  if (explicit && explicit.trim() !== "") return explicit;
  return "";
}

function loadData() {
  const saved = localStorage.getItem(LOCAL_KEY);
  if (saved) {
    try {
      return Promise.resolve(JSON.parse(saved));
    } catch (e) { }
  }
  return fetchWithTimeout("levels.json")
    .then((r) => r.json())
    .catch((err) => {
      console.error("Failed to load levels.json", err);
      return [];
    });
}

function processRawData(data) {
  rawData = data;

  const rawLevels = data
    .filter((item) => item.name)
    .map((item) => {
      const victors = (item.victors || []).map((v) => {
        const time = v.time || "";
        const attempts = Number(v.attempts) || null;
        return {
          name: v.name || "",
          date: v.date || "",
          time,
          seconds: parseTimeToSeconds(time),
          attempts,
          videoUrl: v.video || "",
          wrTime: time,
          wrAttempts: attempts !== null ? attempts : 0,
          victorVideoUrl: v.video || "",
        };
      });
      const sortedVictors = sortVictorsByDate(victors);
      const firstVictor = sortedVictors.find((v) => v.name) || null;
      return {
        rank: item.rank,
        name: item.name,
        thumbnail: autoThumbnail(item.image),
        id: item.id,
        points: 0,
        victors,
        firstVictor: firstVictor ? { name: firstVictor.name, date: firstVictor.date } : null,
        creator: item.creators,
        is2Player: item.twoPlayer === "2 Player",
        showcaseVideoUrl: item.showcaseVideo || "",
        tier: "",
      };
    });

  const uniqueLevels = [];
  const seenIds = new Set();
  const seenNames = new Set();

  rawLevels.forEach((level) => {
    const idKey = String(level.id || "").trim();
    const nameKey = String(level.name || "").trim().toLowerCase();
    if (idKey && seenIds.has(idKey)) return;
    if (nameKey && seenNames.has(nameKey)) return;
    if (idKey) seenIds.add(idKey);
    if (nameKey) seenNames.add(nameKey);
    uniqueLevels.push(level);
  });

  if (uniqueLevels.length !== rawLevels.length) {
    console.warn(`Removed ${rawLevels.length - uniqueLevels.length} duplicate level(s) from the main list.`);
  }

  levels = uniqueLevels;

  try {
    assignTiers(levels);
  } catch (e) {
    console.error("Failed to assign tiers", e);
  }

  const rankValues = levels
    .map((l) => Number(l.rank))
    .filter((r) => Number.isFinite(r));
  const maxRank = rankValues.length ? Math.max(...rankValues, 1) : 1;
  levels.forEach((l) => {
    const rankValue = Number(l.rank);
    const safeRank = Number.isFinite(rankValue) ? rankValue : maxRank;
    l.points = calculatePoints(safeRank, maxRank);
  });

  levels.forEach((level) => {
    let minTimeSec = Infinity, minAttempts = Infinity;
    let wrTimeObj = null, wrAttemptsObj = null;
    level.victors.forEach((victor) => {
      if (victor.time) {
        const sec = victor.seconds;
        if (sec !== null && sec < minTimeSec) {
          minTimeSec = sec;
          wrTimeObj = { name: victor.name, time: victor.time };
        }
      }
      if (victor.attempts !== null && victor.attempts > 0 && victor.attempts < minAttempts) {
        minAttempts = victor.attempts;
        wrAttemptsObj = {
          name: victor.name,
          attempts: victor.attempts.toLocaleString(),
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
  initializeTimeline();

  const savedVerifications = localStorage.getItem("pml_verifications_data");
  if (savedVerifications) {
    try {
      window.verifications = JSON.parse(savedVerifications);
      initializeVerifications();
      syncDemonSystemFromRawData();
      return;
    } catch (e) { }
  }

  fetchWithTimeout("verifications.json")
    .then((r) => r.json())
    .then((data) => {
      const verificationsList = data
        .filter((item) => item.name)
        .map((item) => {
          const victors = (item.victors || []).map((v) => {
            const time = v.time || "";
            const attempts = Number(v.attempts) || null;
            return {
              name: v.name || "",
              date: v.date || "",
              time,
              seconds: parseTimeToSeconds(time),
              attempts,
              videoUrl: v.video || "",
              wrTime: time,
              wrAttempts: attempts !== null ? attempts : 0,
              victorVideoUrl: v.video || "",
            };
          });
          return {
            rank: item.rank || "?",
            name: item.name,
            thumbnail: autoThumbnail(item.image),
            id: item.id,
            points: 0,
            victors,
            creator: item.creators,
            is2Player: item.twoPlayer === "2 Player",
            showcaseVideoUrl: item.showcaseVideo || "",
            tier: "",
          };
        });
      try {
        assignTiers(verificationsList);
      } catch (e) {
        console.error("Failed to assign tiers to verifications", e);
      }
      window.verifications = verificationsList;
      initializeVerifications();
      syncDemonSystemFromRawData();
    })
    .catch(() => {
      console.log("No verifications.json found, using levels with no victors");
      initializeVerifications();
      syncDemonSystemFromRawData();
    });
}

function buildLeaderboard(lvls) {
  const map = {};

  const getMultiplierForRank = (rank) => {
    if (!Number.isFinite(rank) || rank <= 0) return 0;
    const tiers = [1, 0.6, 0.35, 0.2, 0.1];
    if (rank <= tiers.length) return tiers[rank - 1];
    return Math.max(0.05, tiers[tiers.length - 1] / (rank - tiers.length + 1));
  };

  lvls.forEach((lvl) => {
    const sortedVictors = sortVictorsByDate(lvl.victors);
    const players = sortedVictors.filter((victor) => {
      const playerName = String(victor.name || "").trim();
      return (
        Boolean(playerName) &&
        playerName !== "-" &&
        !/^(?:redacted\s+player\s*#\d+|player\s*#\d+)$/i.test(playerName) &&
        !/^[-+]?\d+(?:\.\d+)?$/.test(playerName)
      );
    });

    const timeRankings = players
      .filter((victor) => Number.isFinite(victor.seconds))
      .sort((a, b) => a.seconds - b.seconds || (a.time || "").localeCompare(b.time || ""));

    const attemptRankings = players
      .filter((victor) => Number.isFinite(victor.attempts) && victor.attempts > 0)
      .sort((a, b) => a.attempts - b.attempts);

    const timeRanks = new Map();
    timeRankings.forEach((victor, index) => {
      timeRanks.set(String(victor.name || "").trim(), index + 1);
    });

    const attemptRanks = new Map();
    attemptRankings.forEach((victor, index) => {
      attemptRanks.set(String(victor.name || "").trim(), index + 1);
    });

    players.forEach((victor, index) => {
      const playerName = String(victor.name || "").trim();
      if (!playerName) return;

      const timeRank = timeRanks.get(playerName) || Number.POSITIVE_INFINITY;
      const attemptRank = attemptRanks.get(playerName) || Number.POSITIVE_INFINITY;
      const rank = Math.min(timeRank, attemptRank, index + 1);
      const multiplier = getMultiplierForRank(rank);

      if (!map[playerName]) map[playerName] = { name: playerName, points: 0, levels: [] };
      map[playerName].points += lvl.points * multiplier;
      map[playerName].levels.push(lvl.name);
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
  const system = getDemonSystem();
  if (!system) return;
  localStorage.setItem(
    MODEL_STATE_KEY,
    JSON.stringify({
      signature,
      levels: system.exportLevelStates(),
      comparisons: system.exportComparisons(),
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
    localStorage.setItem("pml_verifications_data", JSON.stringify(window.verifications));
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
  localStorage.removeItem("pml_verifications_data");
  window.verifications = [];
  document.getElementById("reset-notice").classList.add("show");
  fetchWithTimeout("levels.json")
    .then((r) => r.json())
    .then((data) => {
      processRawData(data);
      renderEditTable();
      flashSaved();
    })
    .catch((err) => {
      console.error("Failed to reload levels.json after reset", err);
      processRawData([]);
      renderEditTable();
      flashSaved();
    });
}

function exportJSON() {
  const data = editingSource === "verifications" ? window.verifications : rawData;
  navigator.clipboard.writeText(JSON.stringify(data, null, 2)).then(() => {
    flashCopied();
  });
}