const LOCAL_KEY = "pml_edit_data";
const VERIFICATIONS_DRAFT_BASELINE_KEY = "pml_verifications_data_baseline";
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
let verificationLoadGeneration = 0;

function syncDemonSystemFromRawData() {
}

function fetchWithTimeout(url, timeoutMs = 10000, cache = "default") {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, {
    signal: controller.signal,
    cache,
  }).finally(() => clearTimeout(timeout));
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
    packs: Array.isArray(item.packs)
      ? [...new Set(item.packs.map((pack) => String(pack || "").trim()).filter(Boolean))]
      : [],
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

function markPendingVictorLevels(verificationData) {
  const mainLevelIds = new Set(levels.map((item) => String(item.id || item.levelId || "").trim().toLowerCase()).filter(Boolean));
  const mainLevelNames = new Set(levels.map((item) => String(item.name || item.levelName || "").trim().toLowerCase()).filter(Boolean));

  return (Array.isArray(verificationData) ? verificationData : []).map((item) => {
    const id = String(item?.id || item?.levelId || "").trim().toLowerCase();
    const name = String(item?.name || item?.levelName || "").trim().toLowerCase();
    const isInMainList = (id && mainLevelIds.has(id)) || (name && mainLevelNames.has(name));
    if (isInMainList || !Array.isArray(item?.victors) || item.victors.length === 0) return item;
    return { ...item, tier: "Pending" };
  });
}

function loadData() {
  return fetchWithTimeout("levels.json")
    .then((r) => {
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json();
    })
    .then((data) => {
      if (!Array.isArray(data)) {
        throw new TypeError("levels.json must contain a JSON array");
      }
      return data;
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

function isCurrentVerificationsDraft(savedData, savedBaseline, remoteData) {
  return Array.isArray(savedData)
    && savedBaseline === EditorStateUtils.buildDataSignature(remoteData);
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
  const currentVerificationLoad = ++verificationLoadGeneration;

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

  PackUtils.populatePacks(PACKS, [...levels, ...window.verifications]);
  leaderboard = PackUtils.applyBonuses(buildLeaderboard(levels), PACKS, levels);
  initializeLeaderboardSortState();
  initializeListSortState();
  maxScore = Math.max(...leaderboard.map((p) => p.points), 1);
  renderStats();
  renderLevels(getSortedLevelData(levels));
  renderTargetedLevels();
  renderLeaderboard(leaderboard);
  renderPacks(PACKS, leaderboard);
  initializeTimeline();

  if (!localStorage.getItem(VERIFICATION_TIER_RESET_KEY)) {
    localStorage.removeItem("pml_verifications_data");
    localStorage.setItem(VERIFICATION_TIER_RESET_KEY, "1");
  }

  const savedVerifications = localStorage.getItem("pml_verifications_data");
  if (savedVerifications) {
    try {
      const savedData = JSON.parse(savedVerifications);
      fetchWithTimeout("verifications.json", 10000, "no-cache")
        .then((r) => {
          if (!r.ok) throw new Error(`HTTP ${r.status}`);
          return r.json();
        })
        .then((remoteData) => {
          if (!Array.isArray(remoteData)) {
            throw new TypeError("verifications.json must contain a JSON array");
          }
          if (currentVerificationLoad !== verificationLoadGeneration) return;
          const remoteVerifications = remoteData
            .filter((item) => item && (item.name || item.levelName || item.id))
            .map((item) => normalizeLevelEntry(item));
          const remotePending = markPendingVictorLevels(remoteVerifications);
          assignTiers(remotePending, false);
          const savedBaseline = localStorage.getItem(VERIFICATIONS_DRAFT_BASELINE_KEY);
          const hasCurrentDraft = isCurrentVerificationsDraft(
            savedData, savedBaseline, remoteData
          );

          if (hasCurrentDraft) {
            window.verifications = markPendingVictorLevels(savedData);
            assignTiers(window.verifications, false);
          } else {
            window.verifications = remotePending;
            if (savedBaseline || savedVerifications) {
              console.info(
                "Discarded a stale local verifications.json draft because the remote file changed."
              );
              localStorage.removeItem("pml_verifications_data");
              localStorage.removeItem(VERIFICATIONS_DRAFT_BASELINE_KEY);
            }
          }

          persistEditorRemoteBaseline(remoteData, "verifications");
          initializeVerifications();
          syncDemonSystemFromRawData();
        })
        .catch((err) => {
          if (currentVerificationLoad !== verificationLoadGeneration) return;
          console.error("Failed to load verifications.json", err);
          window.verifications = [];
          initializeVerifications();
          syncDemonSystemFromRawData();
        });
      return;
    } catch (e) { }
  }

  fetchWithTimeout("verifications.json", 10000, "no-cache")
    .then((r) => {
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json();
    })
    .then((remoteData) => {
      if (!Array.isArray(remoteData)) {
        throw new TypeError("verifications.json must contain a JSON array");
      }
      if (currentVerificationLoad !== verificationLoadGeneration) return;
      const verificationsList = remoteData
        .filter((item) => item && (item.name || item.levelName || item.id))
        .map((item) => normalizeLevelEntry(item));
      const pendingVerificationsList = markPendingVictorLevels(verificationsList);
      try {
        assignTiers(pendingVerificationsList, false);
      } catch (e) {
        console.error("Failed to assign tiers to verifications", e);
      }
      window.verifications = pendingVerificationsList;
      persistEditorRemoteBaseline(remoteData, "verifications");
      initializeVerifications();
      syncDemonSystemFromRawData();
    })
    .catch((err) => {
      if (currentVerificationLoad !== verificationLoadGeneration) return;
      console.error("Failed to load verifications.json", err);
      window.verifications = [];
      initializeVerifications();
      syncDemonSystemFromRawData();
    });
}

function refreshPackCatalog() {
  PackUtils.populatePacks(PACKS, [...levels, ...window.verifications]);
  leaderboard = PackUtils.applyBonuses(buildLeaderboard(levels), PACKS, levels);
  maxScore = Math.max(...leaderboard.map((player) => player.points), 1);
  renderStats();
  renderLeaderboard(leaderboard);
  renderPacks(PACKS, leaderboard);
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
    if (editorRemoteBaseline?.source === "verifications") {
      localStorage.setItem(
        VERIFICATIONS_DRAFT_BASELINE_KEY,
        editorRemoteBaseline.signature
      );
    }
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
  localStorage.removeItem(VERIFICATIONS_DRAFT_BASELINE_KEY);
  window.verifications = [];
  document.getElementById("reset-notice").classList.add("show");
  fetchWithTimeout("levels.json", 10000, "no-cache")
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

function sortVerificationExportData(data, cachedRanksOnly = false) {
  const sortableItems = (Array.isArray(data) ? data : []).map((item, index) => {
    const tier = String(item?.tier || item?.tierName || "").trim().toLowerCase();
    const tierRank = VERIFICATION_EXPORT_TIER_ORDER.indexOf(tier);
    const length = parseDurationToSeconds(item?.length ?? item?.levelLength)
      ?? Number(item?.length ?? item?.levelLength);
    const rank = Number(item?.rank);
    return {
      item,
      index,
      predictedRank: getVerificationPredictedRank(item, cachedRanksOnly),
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

function getVerificationPredictedRank(item, cachedOnly = false) {
  if (typeof getCachedUnverifiedEstimatedRank === "function") {
    const estimatedRank = getCachedUnverifiedEstimatedRank(item);
    if (Number.isFinite(estimatedRank)) return estimatedRank;
  }

  if (cachedOnly) {
    const explicitRange = item?.rankRange || item?.estimatedRankRange;
    const min = Number(explicitRange?.min ?? item?.estimatedRankMin);
    const max = Number(explicitRange?.max ?? item?.estimatedRankMax);
    if (Number.isFinite(min) && Number.isFinite(max) && min > 0 && max > 0) {
      return (Math.min(min, max) + Math.max(min, max)) / 2;
    }
    return null;
  }

  if (typeof getUnverifiedEstimatedRank === "function") {
    const estimatedRank = getUnverifiedEstimatedRank(item);
    if (Number.isFinite(estimatedRank)) return estimatedRank;
  } else if (typeof LadderUtils !== "undefined"
    && typeof LadderUtils.getEstimatedRankRange === "function"
    && Array.isArray(levels)
    && levels.length) {
    const prediction = LadderUtils.getEstimatedRankRange({ ...item, isUnverified: true }, levels, []);
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
  return sortVerificationExportData(data, true).map((item, index) => ({
    ...item,
    rank: index + 1,
  }));
}

let editorExportInProgress = false;

function serializeEditorExport(data, sourceData) {
  return new Promise((resolve, reject) => {
    let worker;
    try {
      worker = new Worker(new URL("editor-export-worker.js", window.location.href));
    } catch (error) {
      reject(error);
      return;
    }

    const finish = (callback, value) => {
      worker.terminate();
      callback(value);
    };
    worker.onmessage = (event) => {
      if (event.data?.error) {
        finish(reject, new Error(event.data.error));
        return;
      }
      finish(resolve, event.data);
    };
    worker.onerror = (event) => {
      event.preventDefault();
      finish(reject, new Error(event.message || "Editor export worker failed"));
    };
    try {
      worker.postMessage({ data, sourceData });
    } catch (error) {
      finish(reject, error);
    }
  });
}

async function exportJSON() {
  if (editorExportInProgress) return;
  editorExportInProgress = true;

  try {
    const sourceData = editingSource === "verifications" ? window.verifications : rawData;
    const data = editingSource === "verifications"
      ? buildVerificationExportData(sourceData)
      : sourceData;
    const result = await serializeEditorExport(data, sourceData);
    await navigator.clipboard.writeText(result.json);
    setLastPublishedSignature(result.sourceSignature);
    if (typeof window.renderPublishBanner === "function") {
      window.renderPublishBanner(result.sourceSignature);
    }
    flashCopied();
    alert(`Copied ${getEditorDataSourceName()} to clipboard.\n\nThis is NOT live yet. Paste it over the file in your repo and deploy — visitors are still seeing the old version until you do.`);
  } catch (error) {
    console.error("Failed to export editor JSON", error);
    alert(`Unable to export ${getEditorDataSourceName()}. See the browser console for details.`);
  } finally {
    editorExportInProgress = false;
  }
}