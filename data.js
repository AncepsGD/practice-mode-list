const LOCAL_KEY = "pml_edit_data";
const MODEL_STATE_KEY = "pml_demon_system_state";
const VERIFICATION_TIER_RESET_KEY = "pml_verification_tiers_reset_v1";
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

function assignTiers(levelsList, inheritMissing = true) {
  if (!Array.isArray(levelsList) || !levelsList.length) return;
  if (!inheritMissing) return;
  const markers = [];
  const seenTiers = new Set();

  levelsList.forEach((level, index) => {
    const tier = String(level.tier || level.tierName || "").trim();
    if (tier && !seenTiers.has(tier.toLowerCase())) {
      seenTiers.add(tier.toLowerCase());
      markers.push({ index, tier });
    }
  });

  markers.forEach((marker, markerIndex) => {
    const end = markerIndex + 1 < markers.length ? markers[markerIndex + 1].index : levelsList.length;
    for (let index = marker.index; index < end; index += 1) {
      levelsList[index].tier = marker.tier;
    }
  });
}

function autoThumbnail(explicit) {
  if (typeof explicit !== "string") return "";
  const trimmed = explicit.trim();
  if (!trimmed) return "";

  const blockedPatterns = [
    /^https?:\/\/(www\.)?(youtube\.com|youtu\.be)\//i,
    /^https?:\/\/(www\.)?youtube-nocookie\.com\//i,
    /^https?:\/\/(www\.)?vimeo\.com\//i,
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
      ratio: "",
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
      wrAttempts: normalizedAttempts,
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
  const rawLength = item.length ?? item.levelLength;
  const parsedLength = parseDurationToSeconds(rawLength) ?? Number(rawLength);
  const normalizedLength = Number.isFinite(parsedLength) && parsedLength > 0 ? formatSecondsAsDuration(parsedLength) : "";
  const rawPrecision = item.precision ?? item.Precision;
  const precisionValue = rawPrecision === null || rawPrecision === undefined || (typeof rawPrecision === "string" && rawPrecision.trim() === "") ? null : Number(rawPrecision);
  const normalizedPrecision = Number.isFinite(precisionValue) && precisionValue > 0 ? precisionValue : "";
  const rawTps = item.tps ?? item.TPS ?? item.tpsValue;
  const normalizedTps = rawTps === null || rawTps === undefined || (typeof rawTps === "string" && rawTps.trim() === "") || Number(rawTps) === 0 ? null : Number(rawTps);
  const parsedTps = Number.isFinite(normalizedTps) ? normalizedTps : null;
  const ratio = typeof item.ratio === "string" ? item.ratio.trim() : "";
  const rawRankRange = item.rankRange || item.estimatedRankRange;
  const rankRangeMin = Number(rawRankRange?.min ?? item.estimatedRankMin);
  const rankRangeMax = Number(rawRankRange?.max ?? item.estimatedRankMax);
  const rankRange = Number.isFinite(rankRangeMin) && Number.isFinite(rankRangeMax)
    && rankRangeMin > 0 && rankRangeMax > 0
    ? { min: Math.min(rankRangeMin, rankRangeMax), max: Math.max(rankRangeMin, rankRangeMax) }
    : null;

  const normalized = {
    ...item,
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
    twoPlayer: twoPlayerValue ? "2 Player" : "",
    showcaseVideoUrl,
    showcaseVideo: showcaseVideoUrl,
    image: autoThumbnail(imageValue),
    tier: item.tier || item.tierName || "",
    length: normalizedLength,
    tps: parsedTps,
    precision: normalizedPrecision,
    ratio,
    rankRange,
  };

  const sortedVictors = sortVictorsByDate(victors);
  const firstVictor = sortedVictors.find((victor) => {
    return victor.name && getVictorSortValue(victor) !== null;
  }) || sortedVictors.find((victor) => victor.name) || null;
  if (firstVictor) {
    normalized.firstVictor = { name: firstVictor.name, date: firstVictor.date };
  }

  return normalized;
}

function mergeVerificationSources(remoteData, savedData) {
  const savedByIdentity = new Map();
  (Array.isArray(savedData) ? savedData : []).forEach((item) => {
    const identity = String(item?.id || item?.levelId || item?.name || item?.levelName || "").trim().toLowerCase();
    if (identity) savedByIdentity.set(identity, item);
  });

  const merged = (Array.isArray(remoteData) ? remoteData : []).map((remoteItem) => {
    const identity = String(remoteItem?.id || remoteItem?.levelId || remoteItem?.name || remoteItem?.levelName || "").trim().toLowerCase();
    const savedItem = savedByIdentity.get(identity);
    if (!savedItem) return remoteItem;

    const result = { ...remoteItem, ...savedItem };
    ["creator", "creators", "tier", "length", "precision", "tps", "ratio", "twoPlayer", "showcaseVideo", "showcaseVideoUrl", "image", "thumbnail"].forEach((field) => {
      if (savedItem[field] === "" || savedItem[field] === null || savedItem[field] === undefined) {
        result[field] = remoteItem[field];
      }
    });
    return result;
  });

  const remoteIdentities = new Set(merged.map((item) => String(item?.id || item?.levelId || item?.name || item?.levelName || "").trim().toLowerCase()));
  return merged.concat((Array.isArray(savedData) ? savedData : []).filter((item) => {
    const identity = String(item?.id || item?.levelId || item?.name || item?.levelName || "").trim().toLowerCase();
    return identity && !remoteIdentities.has(identity);
  }));
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
  initializeLeaderboardSortState();
  initializeListSortState();
  maxScore = Math.max(...leaderboard.map((p) => p.points), 1);
  renderStats();
  renderLevels(getSortedLevelData(levels));
  renderTargetedLevels();
  renderLeaderboard(leaderboard);
  initializeTimeline();

  if (!localStorage.getItem(VERIFICATION_TIER_RESET_KEY)) {
    localStorage.removeItem("pml_verifications_data");
    localStorage.setItem(VERIFICATION_TIER_RESET_KEY, "1");
  }
  const savedVerifications = localStorage.getItem("pml_verifications_data");
  if (savedVerifications) {
    try {
      const savedData = JSON.parse(savedVerifications);
      fetchWithTimeout("verifications.json")
        .then((r) => {
          if (!r.ok) throw new Error(`HTTP ${r.status}`);
          return r.json();
        })
        .then((data) => {
          const mergedData = mergeVerificationSources(data, savedData);
          const verificationsList = mergedData
            .filter((item) => item && (item.name || item.levelName || item.id))
            .map((item) => normalizeLevelEntry(item));
          assignTiers(verificationsList, false);
          window.verifications = verificationsList;
          persistEditorRemoteBaseline(verificationsList, "verifications");
          initializeVerifications();
          syncDemonSystemFromRawData();
        })
        .catch(() => {
          window.verifications = savedData;
          initializeVerifications();
          syncDemonSystemFromRawData();
        });
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
        assignTiers(verificationsList, false);
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
    sessionStorage.removeItem("verifications-list");
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

const VERIFICATION_EXPORT_TIER_ORDER = [
  "ethereal",
  "transcendent",
  "divine",
  "master",
  "legendary",
  "insane",
  "advanced",
  "intermediate",
  "novice",
];

function sortVerificationExportData(data) {
  const sortableItems = (Array.isArray(data) ? data : []).map((item, index) => {
    const tier = String(item?.tier || item?.tierName || "").trim().toLowerCase();
    const tierRank = VERIFICATION_EXPORT_TIER_ORDER.indexOf(tier);
    const length = parseDurationToSeconds(item?.length ?? item?.levelLength)
      ?? Number(item?.length ?? item?.levelLength);
    const rank = Number(item?.rank);
    return {
      item,
      index,
      predictedRank: getVerificationPredictedRank(item),
      tier,
      tierRank: tierRank === -1 ? VERIFICATION_EXPORT_TIER_ORDER.length : tierRank,
      length: Number.isFinite(length) && length > 0 ? length : null,
      rank: Number.isFinite(rank) ? rank : null,
    };
  });

  return sortableItems.sort((a, b) => {
    const predictedRankA = a.predictedRank;
    const predictedRankB = b.predictedRank;
    const hasPredictedRankA = Number.isFinite(predictedRankA);
    const hasPredictedRankB = Number.isFinite(predictedRankB);
    if (hasPredictedRankA !== hasPredictedRankB) return hasPredictedRankA ? -1 : 1;
    if (hasPredictedRankA && predictedRankA !== predictedRankB) return predictedRankA - predictedRankB;

    if (a.tierRank !== b.tierRank) {
      return a.tierRank - b.tierRank;
    }

    if (a.tierRank === VERIFICATION_EXPORT_TIER_ORDER.length && a.tier !== b.tier) {
      return a.tier.localeCompare(b.tier);
    }

    const hasLengthA = a.length !== null;
    const hasLengthB = b.length !== null;
    if (hasLengthA !== hasLengthB) return hasLengthA ? -1 : 1;
    if (hasLengthA && a.length !== b.length) return a.length - b.length;

    if (a.rank !== null && b.rank !== null && a.rank !== b.rank) {
      return a.rank - b.rank;
    }
    const nameComparison = String(a.item?.name || "").localeCompare(String(b.item?.name || ""));
    return nameComparison || a.index - b.index;
  }).map(entry => entry.item);
}

function getVerificationPredictedRank(item) {
  if (typeof LadderUtils !== "undefined"
    && typeof LadderUtils.getEstimatedRankRange === "function"
    && Array.isArray(levels)
    && levels.length) {
    const prediction = LadderUtils.getEstimatedRankRange(item, levels, []);
    if (Number.isFinite(prediction?.estimatedRank)) return prediction.estimatedRank;
  }

  const explicitRange = item?.rankRange || item?.estimatedRankRange;
  const min = Number(explicitRange?.min ?? item?.estimatedRankMin);
  const max = Number(explicitRange?.max ?? item?.estimatedRankMax);
  if (Number.isFinite(min) && Number.isFinite(max) && min > 0 && max > 0) {
    return (Math.min(min, max) + Math.max(min, max)) / 2;
  }
  return null;
}

function buildVerificationExportData(data) {
  return sortVerificationExportData(data).map((item, index) => ({
    ...item,
    rank: index + 1,
  }));
}

function exportJSON() {
  const sourceData = editingSource === "verifications" ? window.verifications : rawData;
  const data = editingSource === "verifications"
    ? buildVerificationExportData(sourceData)
    : sourceData;
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