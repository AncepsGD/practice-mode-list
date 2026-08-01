const LOCAL_KEY = "pml_edit_data";
const MODEL_STATE_KEY = "pml_demon_system_state";
const EDITOR_REMOTE_BASELINE_KEY = "pml_editor_remote_baseline";
let rawData = [];
let levels = [];
window.editorSessionActive = false;
window.verifications = [];
let leaderboard = [];
let maxScore = 1;
let editingIndex = -1;
let editorRemoteBaseline = null;

function syncDemonSystemFromRawData() {
}

function fetchWithTimeout(url, timeoutMs = 10000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, { signal: controller.signal }).finally(() => clearTimeout(timeout));
}

function getDemonSystem() {
  return typeof window !== "undefined" ? window.demonSystem : null;
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
  if (typeof explicit !== "string") return "";
  const trimmed = explicit.trim();
  if (!trimmed) return "";

  const blockedPatterns = [
    /^https?:\/\/(www\.)?(youtube\.com|youtu\.be)\
      /^ https ?: \/\/(www\.)?youtube-nocookie\.com\
        /^ https ?: \/\/(www\.)?vimeo\.com\
  ];

  if (blockedPatterns.some((pattern) => pattern.test(trimmed))) {
    return "";
  }

  return trimmed;
}

function normalizeLevelEntry(item) {
  if (!item || typeof item !== "object") {
    return {
      rank: null,
      name: "",
      thumbnail: "",
      id: "",
      points: 0,
      victors: [],
      firstVictor: null,
      creator: "",
      creators: "",
      is2Player: false,
      showcaseVideoUrl: "",
      tier: "",
    };
  }

  const rawVictors = Array.isArray(item.victors) ? item.victors : [];
  const victors = rawVictors.map((victor) => {
    const time = typeof victor?.time === "string" ? victor.time : "";
    const attempts = Number(victor?.attempts);
    const normalizedAttempts = Number.isFinite(attempts) && attempts > 0 ? attempts : null;
    const videoUrl = victor?.video || victor?.videoUrl || "";
    return {
      name: victor?.name || "",
      date: victor?.date || "",
      time,
      seconds: parseTimeToSeconds(time),
      attempts: normalizedAttempts,
      videoUrl,
      wrTime: time,
      wrAttempts: normalizedAttempts !== null ? normalizedAttempts : 0,
      victorVideoUrl: videoUrl,
    };
  });

  const creatorsValue = Array.isArray(item.creators)
    ? item.creators.join(", ")
    : item.creators || item.creator || item.author || "";
  const showcaseVideoUrl = item.showcaseVideoUrl || item.showcaseVideo || item.video || "";
  const imageValue = item.image || item.thumbnail || item.thumb || "";
  const twoPlayerValue = item.twoPlayer === true || item.twoPlayer === "2 Player" || item.twoPlayer === "2P" || item.twoPlayer === "true" || item.is2Player === true;
  const rankValue = Number.isFinite(Number(item.rank)) ? Number(item.rank) : null;

  const normalized = {
    rank: rankValue,
    name: item.name || item.levelName || "",
    thumbnail: autoThumbnail(imageValue),
    id: item.id || item.levelId || "",
    points: 0,
    victors,
    firstVictor: null,
    creator: creatorsValue,
    creators: creatorsValue,
    is2Player: twoPlayerValue,
    showcaseVideoUrl,
    tier: "",
  };

  const sortedVictors = sortVictorsByDate(victors);
  const firstVictor = sortedVictors.find((victor) => victor.name) || null;
  if (firstVictor) {
    normalized.firstVictor = { name: firstVictor.name, date: firstVictor.date };
  }

  return normalized;
}

function loadData() {
  return fetchWithTimeout("levels.json")
    .then((r) => {
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json();
    })
    .catch((err) => {
      const saved = localStorage.getItem(LOCAL_KEY);
      if (saved) {
        try {
          return JSON.parse(saved);
        } catch (e) {
          console.warn("Failed to restore levels.json from local storage", e);
        }
      }
      console.error("Failed to load levels.json", err);
      return [];
    });
}

function cloneEditorValue(value) {
  try {
    return JSON.parse(JSON.stringify(value));
  } catch (err) {
    return value;
  }
}

function persistEditorRemoteBaseline(data, source = "levels") {
  const snapshot = EditorStateUtils.createEditorSnapshot(data || [], source);
  editorRemoteBaseline = snapshot;
  localStorage.setItem(EDITOR_REMOTE_BASELINE_KEY, JSON.stringify(snapshot));
  return snapshot;
}

function loadEditorRemoteBaseline() {
  const raw = localStorage.getItem(EDITOR_REMOTE_BASELINE_KEY);
  if (!raw) return null;
  try {
    editorRemoteBaseline = JSON.parse(raw);
    return editorRemoteBaseline;
  } catch (err) {
    return null;
  }
}

function processRawData(data) {
  rawData = data;

  const rawLevels = data
    .filter((item) => item && (item.name || item.levelName || item.id))
    .map((item) => normalizeLevelEntry(item));

  const uniqueLevels = [];
  const seenNames = new Set();

  rawLevels.forEach((level) => {
    const nameKey = String(level.name || "").trim().toLowerCase();
    if (nameKey && seenNames.has(nameKey)) return;
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
        .filter((item) => item && (item.name || item.levelName || item.id))
        .map((item) => normalizeLevelEntry(item));
      try {
        assignTiers(verificationsList);
      } catch (e) {
        console.error("Failed to assign tiers to verifications", e);
      }
      window.verifications = verificationsList;
      persistEditorRemoteBaseline(verificationsList, "verifications");
      initializeVerifications();
      syncDemonSystemFromRawData();
    })
    .catch(() => {
      console.log("No verifications.json found, using levels with no victors");
      initializeVerifications();
      syncDemonSystemFromRawData();
    });
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

function persistCurrentEditorData() {
  if (!window.editorSessionActive) return;
  if (editingSource === "verifications") {
    localStorage.setItem("pml_verifications_data", JSON.stringify(window.verifications));
  } else {
    localStorage.setItem(LOCAL_KEY, JSON.stringify(rawData));
  }
}

function saveAndRefresh(options = {}) {
  const { flash = true, skipRender = false } = options;

  persistCurrentEditorData();

  if (!skipRender) {
    if (editingSource === "verifications") {
      initializeVerifications();
    } else {
      processRawData(rawData);
    }
  }

  if (flash) {
    flashSaved();
  }
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

const LAST_PUBLISHED_KEY = "pml_editor_last_published_signature";

function getLastPublishedSignature() {
  const stored = localStorage.getItem(LAST_PUBLISHED_KEY);
  if (stored) return stored;
  return editorRemoteBaseline ? editorRemoteBaseline.signature : null;
}

function setLastPublishedSignature(signature) {
  localStorage.setItem(LAST_PUBLISHED_KEY, signature);
}

function exportJSON() {
  const data = editingSource === "verifications" ? window.verifications : rawData;
  const json = JSON.stringify(data, null, 2);
  const signature = EditorStateUtils.buildDataSignature(data || []);
  navigator.clipboard.writeText(json).then(() => {
    setLastPublishedSignature(signature);
    if (typeof window.renderPublishBanner === "function") {
      window.renderPublishBanner();
    }
    flashCopied();
    alert(`Copied ${getEditorDataSourceName()} to clipboard.\n\nThis is NOT live yet. Paste it over the file in your repo and deploy — visitors are still seeing the old version until you do.`);
  });
}