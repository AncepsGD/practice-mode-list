const LOCAL_KEY = "pml_edit_data";

const LEVEL_METRIC_SCHEMA = Object.freeze({
  tps: Object.freeze({ unit: "ticks/second", minimum: 1, maximum: 10000 }),
  length: Object.freeze({ unit: "seconds", minimum: 1, maximum: 3600 }),
  precision: Object.freeze({ unit: "dataset precision units", minimum: 1, maximum: 100000 }),
});

function parseLevelMetric(value, schema) {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue) || numericValue < schema.minimum || numericValue > schema.maximum) return null;
  return numericValue;
}

function assignTiers(levelsList) {
  if (!Array.isArray(levelsList) || !levelsList.length) return;
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

function loadLevelsJson() {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);
  return fetch("levels.json", { signal: controller.signal })
    .then(r => {
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json();
    })
    .catch((err) => {
      const saved = localStorage.getItem(LOCAL_KEY);
      if (saved) {
        try {
          return JSON.parse(saved);
        } catch (_) {

        }
      }
      console.error("Failed to load levels.json for ladder view", err);
      return [];
    })
    .finally(() => clearTimeout(timeout));
}

function loadLadderData() {
  const loadJson = (url, fallback) => fetch(url)
    .then(response => {
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return response.json();
    })
    .catch(() => fallback);

  const loadText = (url, fallback) => fetch(url)
    .then(response => {
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return response.text();
    })
    .catch(() => fallback);

  return Promise.all([
    loadJson("levels.json", []),
    loadJson("verifications.json", []),
    loadText("secret.txt", ""),
  ]).then(([verified, verifications, estimatedText]) => ({
    verified: Array.isArray(verified) ? verified : [],
    verifications: Array.isArray(verifications) ? verifications : [],
    estimatedNames: parseEstimatedDifficultyList(estimatedText),
  }));
}

function parseEstimatedDifficultyList(text) {
  if (typeof text !== "string") return [];
  return text
    .split(/\r?\n/)
    .map(name => name.trim())
    .filter(Boolean);
}

function normalizeLadderName(name) {
  return String(name || "").trim().toLowerCase().replace(/\s+/g, " ");
}

function getLadderIdentityKeys(item) {
  const id = String(item?.id || item?.levelId || "").trim();
  const name = normalizeLadderName(item?.name || item?.levelName);
  return { id, name };
}

function buildVerifiedIdentityIndex(verifiedLevels) {
  const ids = new Set();
  const names = new Set();
  (Array.isArray(verifiedLevels) ? verifiedLevels : []).forEach(level => {
    const identity = getLadderIdentityKeys(level);
    if (identity.id) ids.add(identity.id);
    if (identity.name) names.add(identity.name);
  });
  return { ids, names };
}

function isVerifiedLevel(item, verifiedIdentity) {
  const identity = getLadderIdentityKeys(item);
  return (identity.id && verifiedIdentity.ids.has(identity.id))
    || (identity.name && verifiedIdentity.names.has(identity.name));
}

function getTierDifficultyMultiplier(level) {
  const tierMultipliers = {
    ethereal: 2.35,
    novice: 0.72,
    intermediate: 0.86,
    advanced: 1.0,
    insane: 1.18,
    legendary: 1.38,
    master: 1.6,
    divine: 1.84,
    transcendent: 2.1,
  };
  const tier = String(level?.tier || "").trim().toLowerCase();
  return tierMultipliers[tier] || 1;
}

function getPrecisionDifficultyMultiplier(level, calibrationLevels = []) {
  const precision = Number(level?.precision);
  if (!level?.isUnverified || !Number.isFinite(precision) || precision <= 0) return 1;
  return clamp(precision / getVerifiedPrecisionBaseline(level, calibrationLevels), 0.7, 1.8);
}
function getLengthDifficultyMultiplier(level, calibrationLevels = []) {
  const length = Number(level?.length);
  if (!level?.isUnverified || !Number.isFinite(length) || length <= 0 || !Array.isArray(calibrationLevels)) return 1;
  const neighbors = getNearestCalibrationNeighbors(level, calibrationLevels, "length");
  const baseline = weightedMedian(neighbors.map(neighbor => ({
    value: neighbor.level.length,
    weight: neighbor.weight,
  })));
  return baseline && baseline > 0 ? clamp(length / baseline, 0.7, 1.8) : 1;
}

const nearestCalibrationCache = new WeakMap();
const estimatedDifficultyAnchorCache = new WeakMap();

function getCalibrationRankFraction(level, calibrationLevels) {
  const rank = Number(level?.modelRank || level?._difficultyRank || level?.rank);
  if (!Number.isFinite(rank) || rank <= 0) return null;
  const maxRank = Math.max(...calibrationLevels.map(candidate => Number(candidate?.modelRank || candidate?._difficultyRank || candidate?.rank) || 0), 1);
  return clamp((rank - 1) / Math.max(maxRank - 1, 1), 0, 1);
}

function getNearestCalibrationNeighbors(level, calibrationLevels, excludedField = null) {
  if (!Array.isArray(calibrationLevels) || !calibrationLevels.length) return [];
  let byLevel = nearestCalibrationCache.get(calibrationLevels);
  if (!byLevel) {
    byLevel = new WeakMap();
    nearestCalibrationCache.set(calibrationLevels, byLevel);
  }
  let byField = byLevel.get(level);
  if (!byField) {
    byField = new Map();
    byLevel.set(level, byField);
  }
  if (byField.has(excludedField)) return byField.get(excludedField);

  const rankValues = calibrationLevels.map(candidate => Number(candidate?.modelRank || candidate?._difficultyRank || candidate?.rank) || 0);
  const maxRank = Math.max(...rankValues, 1);
  const rankFraction = rank => Number.isFinite(rank) && rank > 0
    ? clamp((rank - 1) / Math.max(maxRank - 1, 1), 0, 1)
    : null;
  const targetRank = rankFraction(Number(level?.modelRank || level?._difficultyRank || level?.rank));
  const numericFields = ["length", "precision", "tps"];
  const neighbors = calibrationLevels
    .filter(candidate => candidate && candidate !== level)
    .filter(candidate => excludedField === null || Number(candidate[excludedField]) > 0)
    .map(candidate => {
      const candidateRank = rankFraction(Number(candidate?.modelRank || candidate?._difficultyRank || candidate?.rank));
      let distance = targetRank === null ? 0.5 : Math.abs(targetRank - (candidateRank ?? 0.5)) * 2;
      let comparableSignals = targetRank === null ? 0 : 1;

      numericFields.forEach(field => {
        if (field === excludedField) return;
        const targetValue = Number(level?.[field]);
        const candidateValue = Number(candidate?.[field]);
        if (Number.isFinite(targetValue) && targetValue > 0 && Number.isFinite(candidateValue) && candidateValue > 0) {
          distance += Math.abs(Math.log(targetValue / candidateValue)) * 0.35;
          comparableSignals++;
        }
      });

      if (candidate.is2Player !== level.is2Player) distance += 0.45;
      if (String(candidate.tier || "").trim().toLowerCase() !== String(level.tier || "").trim().toLowerCase()) distance += 0.08;

      const targetVictorCount = Array.isArray(level.victors) ? level.victors.length : Number(level.victorCount);
      const candidateVictorCount = Array.isArray(candidate.victors) ? candidate.victors.length : Number(candidate.victorCount);
      if (Number.isFinite(targetVictorCount) && Number.isFinite(candidateVictorCount)) {
        distance += Math.abs(Math.log((1 + targetVictorCount) / (1 + candidateVictorCount))) * 0.2;
        comparableSignals++;
      }

      return {
        level: candidate,
        weight: 1 / Math.pow(0.2 + distance, 2),
        comparableSignals,
        distance,
      };
    })
    .sort((a, b) => a.distance - b.distance)
    .slice(0, 12);

  const result = neighbors.filter(neighbor => neighbor.comparableSignals > 0);
  byField.set(excludedField, result);
  return result;
}

function weightedMedian(values) {
  const usable = (Array.isArray(values) ? values : [])
    .filter(item => Number.isFinite(Number(item?.value)) && Number(item.value) > 0)
    .map(item => ({ value: Number(item.value), weight: Math.max(Number(item.weight) || 0, 0) }))
    .sort((a, b) => a.value - b.value);
  if (!usable.length) return null;

  const totalWeight = usable.reduce((sum, item) => sum + item.weight, 0);
  if (totalWeight <= 0) return usable[Math.floor(usable.length / 2)].value;
  let accumulated = 0;
  for (const item of usable) {
    accumulated += item.weight;
    if (accumulated >= totalWeight / 2) return item.value;
  }
  return usable[usable.length - 1].value;
}

function getEstimatedMainListRank(level, calibrationLevels = []) {
  const estimatedRank = Number(level?._difficultyRank);
  const estimatedListSize = Number(level?._estimatedRankMax);
  if (!level?.isUnverified || !Number.isFinite(estimatedRank) || estimatedRank <= 0
    || !Number.isFinite(estimatedListSize) || estimatedListSize <= 1
    || !Array.isArray(calibrationLevels) || calibrationLevels.length <= 1) return null;
  const normalizedRank = (estimatedRank - 1) / (estimatedListSize - 1);
  return Math.round(1 + normalizedRank * (calibrationLevels.length - 1));
}

function getTierEstimatedRankRange(level, calibrationLevels = [], estimatedListSize = 0) {
  if (!level?.isUnverified || !Array.isArray(calibrationLevels) || calibrationLevels.length < 2
    || !Number.isFinite(estimatedListSize) || estimatedListSize <= 1) return null;

  const tier = String(level.tier || level.tierName || "").trim().toLowerCase();
  if (!tier) return null;
  const tierRanks = calibrationLevels
    .filter(candidate => String(candidate?.tier || candidate?.tierName || "").trim().toLowerCase() === tier)
    .map(candidate => Number(candidate?.modelRank || candidate?._difficultyRank || candidate?.rank))
    .filter(rank => Number.isFinite(rank) && rank > 0);
  if (!tierRanks.length) return null;

  const range = {
    min: Math.min(...tierRanks),
    max: Math.max(...tierRanks),
  };
  return range.min <= range.max ? range : { min: range.max, max: range.min };
}

function buildEstimatedDifficultyAnchors(calibrationLevels, estimatedNames) {
  if (!Array.isArray(calibrationLevels) || !Array.isArray(estimatedNames)) return [];

  let byEstimatedNames = estimatedDifficultyAnchorCache.get(calibrationLevels);
  if (!byEstimatedNames) {
    byEstimatedNames = new WeakMap();
    estimatedDifficultyAnchorCache.set(calibrationLevels, byEstimatedNames);
  }
  const cached = byEstimatedNames.get(estimatedNames);
  if (cached) return cached;

  const estimatedRanks = new Map();
  estimatedNames.forEach((name, index) => {
    const key = normalizeLadderName(name);
    if (key && !estimatedRanks.has(key)) estimatedRanks.set(key, index + 1);
  });

  const anchors = calibrationLevels
    .map(level => ({
      estimatedRank: estimatedRanks.get(normalizeLadderName(level.name)),
      points: Number(level.points),
    }))
    .filter(anchor => Number.isFinite(anchor.estimatedRank) && Number.isFinite(anchor.points))
    .sort((a, b) => a.estimatedRank - b.estimatedRank)
    .filter((anchor, index, anchors) => index === 0 || anchor.estimatedRank !== anchors[index - 1].estimatedRank);
  byEstimatedNames.set(estimatedNames, anchors);
  return anchors;
}

function interpolateDifficultyPoints(level, calibrationLevels, estimatedNames) {
  const estimatedRank = Number(level?._difficultyRank);
  const estimatedListSize = Number(level?._estimatedRankMax);
  if (!level?.isUnverified || !Number.isFinite(estimatedRank) || estimatedRank <= 0
    || !Number.isFinite(estimatedListSize) || estimatedListSize <= 1) return null;

  const anchors = buildEstimatedDifficultyAnchors(calibrationLevels, estimatedNames);
  if (anchors.length < 2) return null;

  let left = anchors[0];
  let right = anchors[anchors.length - 1];
  for (let index = 1; index < anchors.length; index++) {
    if (anchors[index].estimatedRank >= estimatedRank) {
      right = anchors[index];
      left = anchors[index - 1];
      break;
    }
  }

  if (estimatedRank <= anchors[0].estimatedRank) {
    left = anchors[0];
    right = anchors[1];
  } else if (estimatedRank >= anchors[anchors.length - 1].estimatedRank) {
    left = anchors[anchors.length - 2];
    right = anchors[anchors.length - 1];
  }

  const span = right.estimatedRank - left.estimatedRank;
  if (span <= 0) return left.points;
  const ratio = (estimatedRank - left.estimatedRank) / span;
  return clamp(left.points + (right.points - left.points) * ratio, 10, 360);
}

const CALIBRATION_TIER_SCORES = {
  ethereal: 8,
  novice: 0,
  intermediate: 1,
  advanced: 2,
  insane: 3,
  legendary: 4,
  master: 5,
  divine: 6,
  transcendent: 7,
};

function getCalibrationFeatureVector(level, estimatedRanks, estimatedListSize) {
  const key = normalizeLadderName(level?.name);
  const estimatedRank = estimatedRanks.get(key);
  const rankPercentile = Number.isFinite(estimatedRank) && estimatedListSize > 1
    ? (estimatedListSize - estimatedRank) / (estimatedListSize - 1)
    : 0;
  const precision = Number(level?.precision);
  const length = Number(level?.length);
  const tps = Number(level?.tps);
  const tier = String(level?.tier || level?.tierName || "").trim().toLowerCase();
  const hasCreator = Boolean(String(level?.creators || level?.creator || "").trim());
  const hasId = Boolean(String(level?.id || level?.levelId || "").trim());
  const hasShowcase = Boolean(String(level?.showcaseVideo || level?.showcaseVideoUrl || "").trim());

  return [
    1,
    rankPercentile,
    Number.isFinite(precision) && precision > 0 ? Math.log1p(precision) : 0,
    Number.isFinite(precision) && precision > 0 ? 1 : 0,
    Number.isFinite(length) && length > 0 ? Math.log1p(length) : 0,
    Number.isFinite(length) && length > 0 ? 1 : 0,
    Number.isFinite(tps) && tps > 0 ? Math.log1p(tps) : 0,
    Number.isFinite(tps) && tps > 0 ? 1 : 0,
    level?.is2Player === true ? 1 : 0,
    CALIBRATION_TIER_SCORES[tier] ?? 0,
    hasCreator ? 1 : 0,
    hasId ? 1 : 0,
    hasShowcase ? 1 : 0,
  ];
}

function buildUnverifiedCalibrationModel(calibrationLevels, estimatedNames) {
  if (!Array.isArray(calibrationLevels) || !Array.isArray(estimatedNames)) return null;
  const estimatedRanks = new Map();
  estimatedNames.forEach((name, index) => {
    const key = normalizeLadderName(name);
    if (key && !estimatedRanks.has(key)) estimatedRanks.set(key, index + 1);
  });

  const rows = calibrationLevels
    .filter(level => Number.isFinite(Number(level?.points)) && Number(level.points) > 0)
    .filter(level => estimatedRanks.has(normalizeLadderName(level.name)))
    .map(level => ({
      x: getCalibrationFeatureVector(level, estimatedRanks, estimatedNames.length),
      y: level.points,
    }));
  return rows.length >= 20 ? trainLinearRegression(rows, 0.1) : null;
}

function getUnverifiedSourceConfidence(level) {
  if (!level?.isUnverified) return 1;

  const hasValue = value => value !== null && value !== undefined && String(value).trim() !== "";
  const countFrom = (collectionFields, countFields) => {
    const collectionCount = collectionFields
      .filter(field => Array.isArray(level?.[field]))
      .reduce((count, field) => Math.max(count, level[field].length), 0);
    const numericCount = countFields
      .map(field => Number(level?.[field]))
      .find(value => Number.isFinite(value) && value >= 0);
    return Math.max(collectionCount, numericCount || 0);
  };

  const evidenceScore = (
    (hasValue(level.id || level.levelId) ? 0.12 : 0)
    + (hasValue(level.creators || level.creator) ? 0.1 : 0)
    + (hasValue(level.showcaseVideo || level.showcaseVideoUrl) ? 0.12 : 0)
    + (hasValue(level.precision) ? 0.12 : 0)
    + (hasValue(level.length) ? 0.1 : 0)
    + (hasValue(level.tps) ? 0.12 : 0)
    + clamp(countFrom(["submissions", "verificationSubmissions"], [
      "submissionCount",
      "submissionsCount",
      "independentSubmissions",
    ]) / 3, 0, 1) * 0.16
    + clamp((Array.isArray(level.victors)
      ? level.victors.length
      : Number(level.recordedClearCount || level.clearCount || level.completionCount || level.victorCount) || 0) / 3, 0, 1) * 0.16
  );

  return clamp(evidenceScore, 0.25, 1);
}

function predictUnverifiedPoints(level, calibrationModel, estimatedNames) {
  if (!calibrationModel || !Array.isArray(estimatedNames)) return null;
  const estimatedRanks = new Map();
  estimatedNames.forEach((name, index) => {
    const key = normalizeLadderName(name);
    if (key && !estimatedRanks.has(key)) estimatedRanks.set(key, index + 1);
  });
  const features = getCalibrationFeatureVector(level, estimatedRanks, estimatedNames.length);
  const standardized = standardizeFeatureVector(features, calibrationModel.scaler);
  const logPoints = calibrationModel.weights.reduce((sum, weight, index) => sum + weight * standardized[index], 0);
  if (!Number.isFinite(logPoints)) return null;
  return clamp(Math.exp(logPoints), 10, 360);
}

function prepareUnverifiedData(verifications, estimatedNames, verifiedLevels = []) {
  const estimatedRanks = new Map();
  const verifiedIdentity = buildVerifiedIdentityIndex(verifiedLevels);
  (Array.isArray(estimatedNames) ? estimatedNames : []).forEach((name, index) => {
    const key = normalizeLadderName(name);
    if (key && !estimatedRanks.has(key)) estimatedRanks.set(key, index + 1);
  });

  const seenNames = new Set();
  return (Array.isArray(verifications) ? verifications : [])
    .filter(item => item && (item.name || item.levelName || item.id))
    .filter(item => !isVerifiedLevel(item, verifiedIdentity))
    .map((item, index) => ({
      item,
      name: String(item.name || item.levelName || "").trim(),
    }))
    .filter(({ name }) => {
      const key = normalizeLadderName(name);
      if (!key || seenNames.has(key)) return false;
      seenNames.add(key);
      return true;
    })
    .map(({ item, name }, index) => {
      const key = normalizeLadderName(name);
      return {
        ...item,
        name,
        rank: null,
        _difficultyRank: estimatedRanks.get(key)
          || null,
        _estimatedRankMax: Array.isArray(estimatedNames) ? estimatedNames.length : null,
        _ladderSource: "unverified",
      };
    });
}

function prepareFullSecretData(verifications, estimatedNames, verifiedLevels = []) {
  const verificationByName = new Map();
  (Array.isArray(verifications) ? verifications : []).forEach(item => {
    const key = normalizeLadderName(item?.name || item?.levelName);
    if (key && !verificationByName.has(key)) verificationByName.set(key, item);
  });

  const secretNames = [];
  const seenNames = new Set();
  (Array.isArray(estimatedNames) ? estimatedNames : []).forEach(name => {
    const key = normalizeLadderName(name);
    if (!key || seenNames.has(key)) return;
    seenNames.add(key);
    const metadata = verificationByName.get(key);
    secretNames.push(metadata ? { ...metadata, name: String(name).trim() } : { name: String(name).trim() });
  });

  return prepareUnverifiedData(secretNames, estimatedNames, verifiedLevels);
}

const preparedUnverifiedCache = new WeakMap();

function getPreparedUnverifiedData(verifications, estimatedNames, verifiedLevels, useFullSecretList) {
  if (!Array.isArray(verifications) || !Array.isArray(estimatedNames) || !Array.isArray(verifiedLevels)) {
    return useFullSecretList
      ? prepareFullSecretData(verifications, estimatedNames, verifiedLevels)
      : prepareUnverifiedData(verifications, estimatedNames, verifiedLevels);
  }

  let byEstimatedNames = preparedUnverifiedCache.get(verifications);
  if (!byEstimatedNames) {
    byEstimatedNames = new WeakMap();
    preparedUnverifiedCache.set(verifications, byEstimatedNames);
  }

  let byVerifiedLevels = byEstimatedNames.get(estimatedNames);
  if (!byVerifiedLevels) {
    byVerifiedLevels = new WeakMap();
    byEstimatedNames.set(estimatedNames, byVerifiedLevels);
  }

  let cached = byVerifiedLevels.get(verifiedLevels);
  if (!cached) {
    cached = {
      standard: prepareUnverifiedData(verifications, estimatedNames, verifiedLevels),
    };
    byVerifiedLevels.set(verifiedLevels, cached);
  }

  if (!useFullSecretList) return cached.standard;
  if (!cached.full) {
    cached.full = prepareFullSecretData(verifications, estimatedNames, verifiedLevels);
  }
  return cached.full;
}

function mergeLadderData(verified, verifications, estimatedNames, includeUnverified, useFullSecretList) {
  if (!includeUnverified) return verified;

  const verifiedItems = Array.isArray(verified) ? verified : [];
  const verifiedIdentity = buildVerifiedIdentityIndex(verifiedItems);
  const existingIds = verifiedIdentity.ids;
  const existingNames = verifiedIdentity.names;
  const maxVerifiedRank = Math.max(...verifiedItems.map(item => Number(item?.rank) || 0), 0);
  const supplemental = (useFullSecretList
    ? prepareFullSecretData(verifications, estimatedNames, verifiedItems)
    : prepareUnverifiedData(verifications, estimatedNames, verifiedItems))
    .filter(item => {
      const id = String(item.id || item.levelId || "").trim();
      const name = normalizeLadderName(item.name || item.levelName);
      if ((id && existingIds.has(id)) || (name && existingNames.has(name))) return false;
      if (id) existingIds.add(id);
      if (name) existingNames.add(name);
      return true;
    })
    ;

  return [...verifiedItems, ...supplemental];
}

function processRawData(data, options = {}) {
  const preserveDistinctIds = options.preserveDistinctIds === true;
  const rawLevels = data
    .filter(item => item.name)
    .map(item => {
      const victors = (item.victors || []).map(v => {
        const time = v.time || "";
        const attempts = Number(v.attempts) || null;
        return {
          name: v.name || "",
          date: v.date || "",
          time,
          seconds: parseTimeToSeconds(time),
          attempts,
          videoUrl: v.video || "",
        };
      });
      return {
        rank: item._ladderSource === "unverified" ? null : item.rank,
        modelRank: null,
        _difficultyRank: item._ladderSource === "unverified"
          ? item._difficultyRank
          : item._difficultyRank || item.rank,
        _estimatedRankMax: item._estimatedRankMax || null,
        _hasEstimatedRank: Number.isFinite(Number(item._difficultyRank)) && Number(item._difficultyRank) > 0,
        name: item.name,
        id: item.id,
        tps: parseLevelMetric(item.tps ?? item.TPS, LEVEL_METRIC_SCHEMA.tps),
        precision: parseLevelMetric(item.precision ?? item.Precision, LEVEL_METRIC_SCHEMA.precision),
        length: parseLevelMetric(item.length ?? item.levelLength, LEVEL_METRIC_SCHEMA.length),
        metricUnits: {
          tps: LEVEL_METRIC_SCHEMA.tps.unit,
          length: LEVEL_METRIC_SCHEMA.length.unit,
          precision: LEVEL_METRIC_SCHEMA.precision.unit,
        },
        tier: item.tier || item.tierName || "",
        creators: item.creators || item.creator || item.author || "",
        showcaseVideo: item.showcaseVideo || item.showcaseVideoUrl || item.video || "",
        submissions: Array.isArray(item.submissions)
          ? item.submissions
          : Array.isArray(item.verificationSubmissions)
            ? item.verificationSubmissions
            : [],
        submissionCount: item.submissionCount ?? item.submissionsCount ?? item.independentSubmissions ?? null,
        recordedClearCount: item.recordedClearCount ?? item.clearCount ?? item.completionCount ?? item.victorCount ?? null,
        sourceConfidence: Number.isFinite(Number(item.sourceConfidence))
          ? clamp(Number(item.sourceConfidence), 0, 1)
          : null,
        points: 0,
        victors,
        creator: item.creators,
        is2Player: Boolean(
          item.twoPlayer === true ||
          item.twoPlayer === "2 Player" ||
          item.twoPlayer === "2P" ||
          item.twoPlayer === "true" ||
          item.is2Player === true
        ),
        isUnverified: item._ladderSource === "unverified",
      };
    });

  const uniqueLevels = [];
  const seenNames = new Set();
  rawLevels.forEach(level => {
    const nameKey = String(level.name || "").trim().toLowerCase();
    if (!preserveDistinctIds && nameKey && seenNames.has(nameKey)) return;
    if (nameKey) seenNames.add(nameKey);
    uniqueLevels.push(level);
  });

  assignTiers(uniqueLevels.filter(level => !level.isUnverified));

  const estimatedListSize = Array.isArray(options.estimatedNames) ? options.estimatedNames.length : 0;
  uniqueLevels.forEach(level => {
    if (!level.isUnverified) return;
    const tierRange = getTierEstimatedRankRange(level, options.calibrationLevels, estimatedListSize);
    if (!tierRange) return;
    level._tierEstimatedRankRange = tierRange;
    const tierMidpoint = (tierRange.min + tierRange.max) / 2;
    level._tierPrimaryRank = Math.round(tierMidpoint);
    level._difficultyRank = level._tierPrimaryRank;
    level._estimatedRankMax = Math.max(
      ...options.calibrationLevels.map(candidate => (
        Number(candidate?.modelRank || candidate?._difficultyRank || candidate?.rank) || 0
      )),
      1,
    );
    level._hasEstimatedRank = true;
  });

  const maxRank = Math.max(...uniqueLevels.map(l => l._difficultyRank || l.rank || 0), 1);
  const calibrationLevels = Array.isArray(options.calibrationLevels) ? options.calibrationLevels : [];
  const calibrationModel = options.calibrationModel
    || (options.estimatedNames ? buildUnverifiedCalibrationModel(calibrationLevels, options.estimatedNames) : null);
  uniqueLevels.forEach(l => {
    const hasRankCalibration = l.isUnverified && calibrationLevels.length > 1;
    const calibratedRank = hasRankCalibration
      ? (Number.isFinite(Number(l._tierPrimaryRank))
        ? Number(l._tierPrimaryRank)
        : getEstimatedMainListRank(l, calibrationLevels))
      : null;
    const rankPoints = calculatePoints(
      calibratedRank || l._difficultyRank || l.rank,
      hasRankCalibration ? calibrationLevels.length : maxRank,
    );
    l.modelRank = calibratedRank || l.rank || l._difficultyRank || 0;
    l.tierEstimatedRankRange = l._tierEstimatedRankRange || null;
    const anchorPoints = l.isUnverified
      ? interpolateDifficultyPoints(l, calibrationLevels, options.estimatedNames)
      : null;
    const modelPoints = l.isUnverified && l._hasEstimatedRank
      ? predictUnverifiedPoints(l, calibrationModel, options.estimatedNames)
      : null;
    const rankBasedPoints = Number.isFinite(Number(l._tierPrimaryRank))
      ? rankPoints
      : (anchorPoints ?? rankPoints);
    if (l.isUnverified && !l._hasEstimatedRank) {
      l.points = 0;
    } else if (l.isUnverified) {
      l.metadataPointMultiplier = getUnverifiedMetadataPointMultiplier(l, calibrationLevels);
      const metadataAdjustedPoints = clamp(rankBasedPoints * l.metadataPointMultiplier, 10, 360);
      const evidenceAdjustedPoints = modelPoints === null
        ? metadataAdjustedPoints
        : clamp(modelPoints * l.metadataPointMultiplier, 10, 360);
      const evidenceConfidence = l.sourceConfidence ?? getUnverifiedSourceConfidence(l);
      l.evidenceConfidence = evidenceConfidence;
      l.evidenceAdjustedPoints = clamp(
        rankBasedPoints + (evidenceAdjustedPoints - rankBasedPoints) * evidenceConfidence,
        10,
        360,
      );
      l.points = clamp(
        rankBasedPoints * 0.65 + l.evidenceAdjustedPoints * 0.35,
        10,
        360,
      );
    } else if (modelPoints === null) {
      l.points = rankBasedPoints;
    } else {
      const confidence = l.sourceConfidence ?? getUnverifiedSourceConfidence(l);
      l.points = clamp(
        rankBasedPoints * (1 - confidence * 0.35) + modelPoints * confidence * 0.35,
        10,
        360,
      );
    }
  });

  uniqueLevels.forEach(level => {
    let minTimeSec = null;
    let minAttempts = null;
    let wrTimeObj = null;
    let wrAttemptsObj = null;

    const victorTimes = level.victors
      .map(v => v.seconds)
      .filter(t => t !== null && t > 0);
    const victorAttempts = level.victors
      .map(v => Number(v.attempts))
      .filter(a => Number.isFinite(a) && a > 0);

    level.avgVictorTime = victorTimes.length ? trimmedMean(victorTimes) : null;
    level.avgVictorAttempts = getRobustAttemptBaseline(victorAttempts);

    level.victors.forEach(v => {
      const sec = v.seconds;
      if (sec !== null && (minTimeSec === null || sec < minTimeSec)) {
        minTimeSec = sec;
        wrTimeObj = { name: v.name, time: v.time };
      }
      if (v.attempts !== null && v.attempts > 0 && (minAttempts === null || v.attempts < minAttempts)) {
        minAttempts = v.attempts;
        wrAttemptsObj = { name: v.name, attempts: v.attempts };
      }
    });

    level.wrTime = wrTimeObj;
    level.wrAttempts = wrAttemptsObj;
  });

  return uniqueLevels;
}

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

function trimmedMean(arr, trimFraction = 0.1) {
  if (!arr.length) return null;
  const sorted = [...arr].sort((a, b) => a - b);
  const trimCount = Math.floor(sorted.length * trimFraction);
  const end = sorted.length - trimCount;
  const source = trimCount < end ? sorted.slice(trimCount, end) : sorted;
  return source.reduce((a, b) => a + b, 0) / source.length;
}

function median(arr) {
  if (!Array.isArray(arr) || !arr.length) return null;
  const sorted = [...arr].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function getRobustAttemptStats(values) {
  const usable = (Array.isArray(values) ? values : [])
    .map(value => Number(value))
    .filter(value => Number.isFinite(value) && value > 0);
  if (!usable.length) return null;

  const sorted = [...usable].sort((a, b) => a - b);
  const lowerHalf = sorted.slice(0, Math.ceil(sorted.length / 2));
  const upperHalf = sorted.slice(Math.floor(sorted.length / 2));
  const q1 = median(lowerHalf) ?? sorted[0];
  const q3 = median(upperHalf) ?? sorted[sorted.length - 1];
  const attemptMedian = median(sorted) ?? sorted[0];
  const iqr = Math.max(0, q3 - q1);
  const upperFence = sorted.length <= 2 && sorted[sorted.length - 1] > sorted[0] * 3
    ? sorted[0] * 3
    : iqr > 0
    ? Math.min(q3 + 1.5 * iqr, attemptMedian * 2.5)
    : attemptMedian * 2.5;
  const lowerFence = Math.max(1, q1 - 1.5 * iqr);
  const winsorized = usable.map(value => clamp(value, lowerFence, upperFence));
  const nonOutlierValues = usable.filter(value => value <= upperFence);

  return {
    values: usable,
    winsorized,
    median: median(nonOutlierValues) ?? median(winsorized) ?? attemptMedian,
    upperFence,
  };
}

function getRobustAttemptBaseline(values) {
  return getRobustAttemptStats(values)?.median ?? null;
}

function geometricMean(arr) {
  if (!arr.length) return null;
  const logSum = arr.reduce((acc, v) => acc + Math.log(v), 0);
  return Math.exp(logSum / arr.length);
}

function formatHours(hours) {
  if (!Number.isFinite(hours) || hours <= 0) return "0h 0m 0s";

  const totalSeconds = Math.max(0, Math.round(hours * 3600));
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;

  const parts = [];
  if (h > 0) parts.push(`${h}h`);
  if (m > 0 || h > 0) parts.push(`${m}m`);
  if (s > 0 || (h === 0 && m === 0)) parts.push(`${s}s`);

  return parts.join(" ");
}

function formatSkillMultiplier(skill) {
  if (!Number.isFinite(skill) || skill <= 0) return "—";
  const percent = Math.round(skill * 100);
  return `${percent}% of average`;
}

function classifySkill(skill) {
  if (skill >= 1.25) return "Elite";
  if (skill >= 1) return "Above average";
  if (skill >= 0.9) return "Average";
  return "Below average";
}

function describeSkillRelative(skill) {
  if (skill >= 1) {
    const pct = Math.round((skill - 1) * 100);
    return pct > 0 ? `Compared to average victor: ${pct}% above average` : "Compared to average victor: on par";
  }

  const pct = Math.round((1 - skill) * 100);
  return `Compared to average victor: ${pct}% below average`;
}

function buildTimeModelFeatures(level) {
  const victorTimes = level.victors
    .map(v => v.seconds)
    .filter(t => t !== null && t > 0);
  const victorAttempts = level.victors
    .map(v => v.attempts)
    .filter(a => Number.isFinite(a) && a > 0);

  return {
    points: level.points || 0,
    rank: level.modelRank || level.rank || 0,
    victorCount: level.victors.length,
    avgVictorTime: victorTimes.length ? trimmedMean(victorTimes) : null,
    avgVictorAttempts: getRobustAttemptBaseline(victorAttempts),
    hasWrTime: level.wrTime ? 1 : 0,
    hasWrAttempts: level.wrAttempts ? 1 : 0,
  };
}

function timeModelVector(features) {
  return [
    1,
    features.points,
    features.rank,
    features.victorCount,
    features.avgVictorTime || 0,
    features.avgVictorAttempts || 0,
    features.hasWrTime,
    features.hasWrAttempts,
  ];
}

function buildAttemptModelFeatures(level) {
  const points = Number(level.points);
  const rank = Number(level.modelRank || level.rank);
  const precision = Number(level.precision);
  const length = Number(level.length);
  const tps = Number(level.tps);
  const tier = String(level.tier || level.tierName || "").trim().toLowerCase();
  const victorCount = Array.isArray(level.victors) ? level.victors.length : 0;

  return [
    1,
    Number.isFinite(points) && points > 0 ? Math.log1p(points) : 0,
    Number.isFinite(rank) && rank > 0 ? Math.log1p(rank) : 0,
    CALIBRATION_TIER_SCORES[tier] ?? 0,
    Number.isFinite(precision) && precision > 0 ? Math.log1p(precision) : 0,
    Number.isFinite(precision) && precision > 0 ? 1 : 0,
    Number.isFinite(tps) && tps > 0 ? Math.log1p(tps) : 0,
    Number.isFinite(tps) && tps > 0 ? 1 : 0,
    Number.isFinite(length) && length > 0 ? Math.log1p(length) : 0,
    Number.isFinite(length) && length > 0 ? 1 : 0,
    level.is2Player === true ? 1 : 0,
    Math.log1p(Math.max(0, victorCount)),
  ];
}

function buildFeatureScaler(rows) {
  if (!rows.length) return null;
  const p = rows[0].x.length;
  const means = Array(p).fill(0);
  const stds = Array(p).fill(0);
  const totalWeight = rows.reduce((sum, row) => sum + (Number.isFinite(row.weight) ? Math.max(row.weight, 0) : 1), 0);

  for (let i = 1; i < p; i++) {
    means[i] = rows.reduce((sum, row) => {
      const weight = Number.isFinite(row.weight) ? Math.max(row.weight, 0) : 1;
      return sum + weight * row.x[i];
    }, 0) / Math.max(totalWeight, 1e-6);
  }

  for (let i = 1; i < p; i++) {
    const variance = rows.reduce((sum, row) => {
      const diff = row.x[i] - means[i];
      const weight = Number.isFinite(row.weight) ? Math.max(row.weight, 0) : 1;
      return sum + weight * diff * diff;
    }, 0) / Math.max(totalWeight, 1e-6);
    const standardDeviation = Math.sqrt(variance);
    stds[i] = standardDeviation > 1e-9 ? standardDeviation : 1;
  }

  return { means, stds };
}

function standardizeFeatureVector(x, scaler) {
  if (!scaler) return x.slice();
  return x.map((value, index) => {
    if (index === 0) return 1;
    const std = scaler.stds[index];
    return std > 1e-9 ? (value - scaler.means[index]) / std : 0;
  });
}

function solveLinearSystem(a, b) {
  const n = a.length;
  const A = a.map(row => row.slice());
  const x = b.slice();

  for (let i = 0; i < n; i++) {
    let pivot = i;
    for (let j = i + 1; j < n; j++) {
      if (Math.abs(A[j][i]) > Math.abs(A[pivot][i])) pivot = j;
    }
    if (Math.abs(A[pivot][i]) < 1e-12) return null;
    [A[i], A[pivot]] = [A[pivot], A[i]];
    [x[i], x[pivot]] = [x[pivot], x[i]];

    const inv = 1 / A[i][i];
    A[i][i] = 1;
    for (let j = i + 1; j < n; j++) A[i][j] *= inv;
    x[i] *= inv;

    for (let j = 0; j < n; j++) {
      if (j === i) continue;
      const factor = A[j][i];
      A[j][i] = 0;
      for (let k = i + 1; k < n; k++) A[j][k] -= factor * A[i][k];
      x[j] -= factor * x[i];
    }
  }

  return x;
}

function trainLinearRegression(rows, ridge = 0.01, fixedScaler = null) {
  if (!rows.length) return null;
  const p = rows[0].x.length;
  const scaler = fixedScaler || buildFeatureScaler(rows);
  const standardizedRows = rows.map(({ x, y, weight }) => ({
    x: standardizeFeatureVector(x, scaler),
    y,
    weight: Number.isFinite(weight) ? Math.max(weight, 0) : 1,
  }));
  const xtx = Array.from({ length: p }, () => Array(p).fill(0));
  const xty = Array(p).fill(0);

  standardizedRows.forEach(({ x, y, weight }) => {
    const target = Math.log(Math.max(y, 1e-6));
    for (let i = 0; i < p; i++) {
      xty[i] += weight * x[i] * target;
      for (let j = 0; j < p; j++) {
        xtx[i][j] += weight * x[i] * x[j];
      }
    }
  });

  for (let i = 0; i < p; i++) {
    xtx[i][i] += ridge * (i === 0 ? 0 : 1);
  }

  const weights = solveLinearSystem(xtx, xty);
  return weights ? { weights, featureCount: p, scaler } : null;
}

const globalTimeModelCache = new WeakMap();
const globalAttemptsModelCache = new WeakMap();

function getCachedGlobalTimeModel(levels) {
  if (globalTimeModelCache.has(levels)) return globalTimeModelCache.get(levels);
  const model = buildGlobalTimeModel(levels);
  globalTimeModelCache.set(levels, model);
  return model;
}

function buildGlobalTimeModel(levels) {
  const rows = [];

  levels.forEach(lvl => {
    const features = buildTimeModelFeatures(lvl);
    if (!features.avgVictorTime) return;
    const validVictors = lvl.victors.filter(v => v.seconds !== null && v.seconds > 0);
    const victorWeight = validVictors.length ? 1 / validVictors.length : 1;

    validVictors.forEach(v => {
      const sec = v.seconds;
      rows.push({ x: timeModelVector(features), y: sec, weight: victorWeight });
    });
  });

  if (!rows.length) return null;

  const model = trainLinearRegression(rows, 0.001);
  if (model) return { weights: model.weights, featureCount: model.featureCount, scaler: model.scaler };

  const totalWeight = rows.reduce((sum, row) => sum + row.weight, 0);
  const meanTime = rows.reduce((sum, row) => sum + row.weight * Math.log(Math.max(row.y, 1e-6)), 0)
    / Math.max(totalWeight, 1e-6);
  return {
    weights: [Math.exp(meanTime), 0, 0, 0, 0, 0, 0, 0],
    featureCount: timeModelVector(buildTimeModelFeatures(levels[0] || {})).length,
    scaler: null,
  };
}

function getCachedGlobalAttemptsModel(levels) {
  if (globalAttemptsModelCache.has(levels)) return globalAttemptsModelCache.get(levels);
  const model = buildGlobalAttemptsModel(levels);
  globalAttemptsModelCache.set(levels, model);
  return model;
}

function buildGlobalAttemptsModel(levels) {
  const rows = [];

  levels.forEach(level => {
    const features = buildAttemptModelFeatures(level);
    const attemptStats = getRobustAttemptStats(level.victors.map(v => v.attempts));
    if (!attemptStats) return;
    rows.push({
      x: features,
      y: attemptStats.median,
      weight: 1,
    });
  });

  if (!rows.length) return null;

  const model = trainLinearRegression(rows, 0.1);
  if (model) return { weights: model.weights, featureCount: model.featureCount, scaler: model.scaler };

  const totalWeight = rows.reduce((sum, row) => sum + row.weight, 0);
  const meanAttempts = rows.reduce((sum, row) => sum + row.weight * Math.log(Math.max(row.y, 1e-6)), 0)
    / Math.max(totalWeight, 1e-6);
  const featureCount = buildAttemptModelFeatures(levels[0] || {}).length;
  return {
    weights: [meanAttempts, ...Array(featureCount - 1).fill(0)],
    featureCount,
    scaler: null,
  };
}

function blendRegressionModels(priorModel, localModel, weight) {
  if (!priorModel && !localModel) return null;
  if (!priorModel) return localModel;
  if (!localModel) return priorModel;

  const effectiveWeight = clamp(weight, 0.05, 0.5);
  const priorWeight = 1 - effectiveWeight;
  const weights = priorModel.weights.map((value, index) => value * priorWeight + (localModel.weights[index] || 0) * effectiveWeight);

  return {
    weights,
    featureCount: priorModel.featureCount || localModel.featureCount,
    scaler: priorModel.scaler || localModel.scaler,
  };
}

function trainPlayerTimeModel(levels, playerName) {
  const playerRows = [];
  const ratios = [];
  const globalModel = getCachedGlobalTimeModel(levels);

  levels.forEach(lvl => {
    const parsedEntries = lvl.victors
      .map(v => ({
        name: v.name,
        sec: v.seconds,
        attempts: Number.isFinite(v.attempts) ? v.attempts : null,
      }))
      .filter(v => v.sec !== null && v.sec > 0);

    const playerEntry = parsedEntries.find(v => v.name === playerName);
    if (!playerEntry) return;

    const features = buildTimeModelFeatures(lvl);
    if (!features.avgVictorTime) return;

    playerRows.push({ x: timeModelVector(features), y: playerEntry.sec });

    if (playerEntry.sec > 0 && features.avgVictorTime > 0) {
      ratios.push(playerEntry.sec / features.avgVictorTime);
    }
  });

  const localModel = playerRows.length >= 15
    ? trainLinearRegression(playerRows, 0.1, globalModel?.scaler || null)
    : null;

  const localWeight = localModel
    ? clamp((playerRows.length - 14) / 10, 0.05, 0.5)
    : 0;

  const blendedModel = blendRegressionModels(
    globalModel,
    localModel ? { weights: localModel.weights, featureCount: localModel.featureCount, scaler: localModel.scaler } : null,
    localWeight,
  );

  const playerSkillRatio = ratios.length ? geometricMean(ratios) : null;
  const skillRatio = playerSkillRatio
    ? clamp(playerSkillRatio * (playerRows.length >= 15 ? localWeight : 0) + 1 * (1 - (playerRows.length >= 15 ? localWeight : 0)), 0.5, 2.0)
    : null;

  return {
    model: blendedModel,
    skillRatio,
  };
}

function predictPlayerTime(level, model) {
  if (!model || !model.model || !model.model.weights) return null;
  const features = buildTimeModelFeatures(level);
  if (!features.avgVictorTime) return null;
  const x = timeModelVector(features);
  const standardizedX = model.model.scaler ? standardizeFeatureVector(x, model.model.scaler) : x;
  const logSeconds = model.model.weights.reduce((sum, w, i) => sum + w * standardizedX[i], 0);
  if (!Number.isFinite(logSeconds)) return null;
  return Math.exp(logSeconds);
}

function getCalibrationAttemptsBaseline(level, calibrationLevels) {
  if (!Array.isArray(calibrationLevels) || !calibrationLevels.length) return null;
  const neighbors = getNearestCalibrationNeighbors(level, calibrationLevels);
  const attempts = neighbors
    .map(neighbor => {
      const values = (neighbor.level.victors || [])
        .map(victor => Number(victor.attempts))
        .filter(value => Number.isFinite(value) && value > 0);
      return values.length
        ? { value: getRobustAttemptBaseline(values), weight: neighbor.weight }
        : null;
    })
    .filter(Boolean);
  return weightedMedian(attempts);
}

function predictPlayerAttempts(level, model, calibrationLevels = []) {
  if (!model || !model.weights) return null;
  const x = buildAttemptModelFeatures(level);
  const standardizedX = model.scaler ? standardizeFeatureVector(x, model.scaler) : x;
  const logAttempts = model.weights.reduce((sum, weight, index) => sum + weight * standardizedX[index], 0);
  if (!Number.isFinite(logAttempts)) return null;
  const modelPrediction = clamp(Math.exp(logAttempts), 1, 1000000);
  const localBaseline = getCalibrationAttemptsBaseline(level, calibrationLevels);
  if (localBaseline === null) return modelPrediction;
  return clamp(Math.exp(Math.log(modelPrediction) * 0.4 + Math.log(localBaseline) * 0.6), 1, 1000000);
}

function calculateSkillComponents(levels, playerName) {
  const speedRatios = [];
  const attemptRatios = [];
  const speedWeights = [];
  const attemptWeights = [];
  const skillSamples = [];
  const specializedRatios = {
    precision: [],
    highTps: [],
    endurance: [],
    coordination: [],
  };

  const metricValues = (field) => levels
    .map(level => Number(level?.[field]))
    .filter(value => Number.isFinite(value) && value > 0)
    .sort((a, b) => a - b);
  const upperQuartile = (values) => values.length
    ? values[Math.min(values.length - 1, Math.floor((values.length - 1) * 0.75))]
    : null;
  const precisionThreshold = upperQuartile(metricValues("precision"));
  const tpsThreshold = upperQuartile(metricValues("tps"));
  const lengthThreshold = upperQuartile(metricValues("length"));

  const addSpecializedRatio = (dimension, ratio, weight) => {
    if (Number.isFinite(ratio) && ratio > 0) specializedRatios[dimension].push({ ratio, weight });
  };

  levels.forEach(lvl => {
    const parsedEntries = lvl.victors
      .map(v => ({
        name: v.name,
        sec: v.seconds,
        attempts: Number.isFinite(v.attempts) ? v.attempts : null,
      }))
      .filter(v => v.sec !== null && v.sec > 0);
    if (parsedEntries.length < 2) return;

    const playerEntry = parsedEntries.find(v => v.name === playerName);
    if (!playerEntry) return;

    const comparisonEntries = parsedEntries.filter(v => v.name !== playerName);
    if (!comparisonEntries.length) return;

    const timeBaseline = median(comparisonEntries.map(v => v.sec));
    const attemptsWithData = comparisonEntries.filter(v => v.attempts !== null && v.attempts > 0);
    const attemptBaseline = attemptsWithData.length
      ? median(attemptsWithData.map(v => v.attempts))
      : null;

    if (!timeBaseline || timeBaseline <= 0) return;

    const timeRatio = Math.log(playerEntry.sec / timeBaseline);
    const attemptRatio = attemptBaseline && attemptBaseline > 0 && playerEntry.attempts !== null && playerEntry.attempts > 0
      ? Math.log(playerEntry.attempts / attemptBaseline)
      : 0;

    const difficultyWeight = Number.isFinite(Number(lvl.points)) && Number(lvl.points) > 0
      ? clamp(Math.log1p(Number(lvl.points)) / Math.log1p(220), 0.35, 1.8)
      : 1;
    const sampleWeight = clamp(0.45 + parsedEntries.length * 0.18, 0.5, 2.5);
    const tierSimilarity = String(lvl.tier || "").trim().toLowerCase() === String(levels[0]?.tier || "").trim().toLowerCase()
      ? 1.15
      : 1;
    const modeSimilarity = Boolean(lvl.is2Player) === Boolean(playerEntry.is2Player)
      ? 1.15
      : 1;
    const precisionSignal = Number.isFinite(Number(lvl.precision)) && Number(lvl.precision) > 0 && comparisonEntries.length >= 2
      ? clamp(1.25 - Math.min(1, Math.abs(Math.log(Number(lvl.precision) / median(comparisonEntries.map(v => Number(v.precision || lvl.precision)).filter(value => Number.isFinite(value) && value > 0) || [lvl.precision]))) / 1.8), 0.8, 1.3)
      : 1;
    const stabilityWeight = comparisonEntries.length >= 3 ? 1.15 : comparisonEntries.length === 2 ? 1.05 : 1;
    const isTimeWr = String(lvl?.wrTime?.name || "").trim() === String(playerName || "").trim();
    const isAttemptWr = String(lvl?.wrAttempts?.name || "").trim() === String(playerName || "").trim();
    const recordCount = (isTimeWr ? 1 : 0) + (isAttemptWr ? 1 : 0);
    const recordBoost = 1 + 0.05 * Math.log1p(recordCount);
    const confidenceWeight = difficultyWeight * sampleWeight * tierSimilarity * modeSimilarity * precisionSignal * stabilityWeight * recordBoost;
    const zScore = 0.7 * timeRatio + 0.3 * attemptRatio;

    skillSamples.push({ z: zScore, weight: confidenceWeight });
    speedRatios.push(timeRatio);
    speedWeights.push(confidenceWeight);

    if (precisionThreshold !== null && Number(lvl.precision) >= precisionThreshold) {
      addSpecializedRatio("precision", timeRatio, confidenceWeight);
    }
    if (tpsThreshold !== null && Number(lvl.tps) >= tpsThreshold) {
      addSpecializedRatio("highTps", timeRatio, confidenceWeight);
    }
    if (lengthThreshold !== null && Number(lvl.length) >= lengthThreshold) {
      addSpecializedRatio("endurance", timeRatio, confidenceWeight);
    }
    if (lvl.is2Player === true) {
      addSpecializedRatio("coordination", timeRatio, confidenceWeight);
    }

    if (attemptBaseline && attemptBaseline > 0 && playerEntry.attempts !== null && playerEntry.attempts > 0) {
      const attemptRatioLog = Math.log(playerEntry.attempts / attemptBaseline);
      attemptRatios.push(attemptRatioLog);
      attemptWeights.push(confidenceWeight);
    }
  });

  const summarizeRatios = (items) => {
    if (!items.length) return 1;
    const weightedMeanLog = items.reduce((sum, item) => sum + item.ratio * item.weight, 0)
      / items.reduce((sum, item) => sum + item.weight, 0);
    const robustLogRatio = median(items.map(item => item.ratio)) ?? weightedMeanLog;
    const factor = Math.exp((weightedMeanLog * 0.6) + (robustLogRatio * 0.4));
    const confidence = Math.min(1, items.length / 4);
    return clamp(1 + (factor - 1) * confidence, 0.7, 1.5);
  };

  const weightedSkill = skillSamples.length
    ? skillSamples.reduce((sum, sample) => sum + sample.z * sample.weight, 0)
      / skillSamples.reduce((sum, sample) => sum + sample.weight, 0)
    : 0;

  const combinedSpeed = speedRatios.length
    ? (() => {
      const weightedMeanLog = speedRatios.reduce((sum, ratio, index) => sum + ratio * speedWeights[index], 0)
        / speedWeights.reduce((sum, weight) => sum + weight, 0);
      const robustLogRatio = median(speedRatios) ?? weightedMeanLog;
      return Math.exp((weightedMeanLog * 0.6) + (robustLogRatio * 0.4));
    })()
    : 1;

  const combinedAttempts = attemptRatios.length
    ? (() => {
      const weightedMeanLog = attemptRatios.reduce((sum, ratio, index) => sum + ratio * attemptWeights[index], 0)
        / attemptWeights.reduce((sum, weight) => sum + weight, 0);
      const robustLogRatio = median(attemptRatios) ?? weightedMeanLog;
      return Math.exp((weightedMeanLog * 0.6) + (robustLogRatio * 0.4));
    })()
    : 1;

  const speedScore = clamp(1 + (combinedSpeed - 1) * Math.min(1, speedRatios.length / 6), 0.7, 1.5);
  const attemptsScore = clamp(1 + (combinedAttempts - 1) * Math.min(1, attemptRatios.length / 6), 0.7, 1.5);
  const precisionScore = summarizeRatios(specializedRatios.precision);
  const highTpsScore = summarizeRatios(specializedRatios.highTps);
  const enduranceScore = summarizeRatios(specializedRatios.endurance);
  const coordinationScore = summarizeRatios(specializedRatios.coordination);
  const model = trainPlayerTimeModel(levels, playerName);
  const attemptsModel = getCachedGlobalAttemptsModel(levels);

  return {
    speed: speedScore,
    attempts: attemptsScore,
    precision: precisionScore,
    highTps: highTpsScore,
    endurance: enduranceScore,
    coordination: coordinationScore,
    consistency: attemptsScore,
    model,
    attemptsModel,
    skillRatio: model ? model.skillRatio : null,
    weightedSkill,
  };
}

function calculatePlayerSkill(levels, playerName) {
  const components = calculateSkillComponents(levels, playerName);
  const speedFactor = Number.isFinite(components.speed) && components.speed > 0
    ? components.speed
    : 1;
  const weightedFactor = Number.isFinite(components.weightedSkill)
    ? clamp(Math.exp(components.weightedSkill), 0.5, 2)
    : (components.skillRatio ?? 1);
  const attemptsFactor = Number.isFinite(components.attempts) && components.attempts > 0
    ? components.attempts
    : 1;
  const rawSkill = Math.exp(
    0.55 * Math.log(speedFactor)
    + 0.25 * Math.log(weightedFactor)
    + 0.2 * Math.log(attemptsFactor)
  );

  const recordCount = (Array.isArray(levels) ? levels : []).reduce((count, lvl) => {
    const timeWr = String(lvl?.wrTime?.name || "").trim() === String(playerName || "").trim();
    const attemptWr = String(lvl?.wrAttempts?.name || "").trim() === String(playerName || "").trim();
    return count + (timeWr ? 1 : 0) + (attemptWr ? 1 : 0);
  }, 0);
  const recordBonus = 1 + 0.05 * Math.log1p(recordCount);
  const leaderboard = typeof buildLeaderboard === "function" ? buildLeaderboard(levels) : [];
  const playerIndex = leaderboard.findIndex(player => player.name === playerName);
  const rankPercentile = playerIndex >= 0 && leaderboard.length > 1
    ? 1 - playerIndex / (leaderboard.length - 1)
    : 0.5;
  const rankPrior = 0.85 + 0.45 * clamp(rankPercentile, 0, 1);

  const displaySkill = (Number.isFinite(rawSkill) && rawSkill > 0 ? 1 / rawSkill : 1)
    * recordBonus
    * rankPrior;
  return clamp(displaySkill, 0.55, 1.8);
}

function calculateAvgTimePerPoint(levels) {
  const weightedRatios = [];
  levels.forEach(lvl => {
    const times = lvl.victors.map(v => v.seconds).filter(t => t !== null && t > 0);
    if (times.length > 0 && lvl.points > 0) {
      weightedRatios.push({ ratio: trimmedMean(times) / lvl.points, weight: lvl.points });
    }
  });
  if (!weightedRatios.length) return null;
  const totalWeight = weightedRatios.reduce((sum, item) => sum + item.weight, 0);
  return weightedRatios.reduce((sum, item) => sum + item.ratio * item.weight, 0) / totalWeight;
}

function calculateAvgAttemptsPerPoint(levels) {
  const weightedRatios = [];
  levels.forEach(lvl => {
    const attempts = lvl.victors
      .map(v => Number(v.attempts))
      .filter(a => Number.isFinite(a) && a > 0);
    if (attempts.length > 0 && lvl.points > 0) {
      const baseline = getRobustAttemptBaseline(attempts);
      if (baseline !== null) weightedRatios.push({ ratio: baseline / lvl.points, weight: lvl.points });
    }
  });
  if (!weightedRatios.length) return null;
  const totalWeight = weightedRatios.reduce((sum, item) => sum + item.weight, 0);
  return weightedRatios.reduce((sum, item) => sum + item.ratio * item.weight, 0) / totalWeight;
}

function getVerifiedPrecisionBaseline(level, calibrationLevels) {
  if (!level.isUnverified || !Array.isArray(calibrationLevels)) return 525.4;
  const neighbors = getNearestCalibrationNeighbors(level, calibrationLevels, "precision");
  return weightedMedian(neighbors.map(neighbor => ({
    value: neighbor.level.precision,
    weight: neighbor.weight,
  }))) ?? 525.4;
}

function getVerifiedTpsBaseline(level, calibrationLevels) {
  if (!level.isUnverified || !Array.isArray(calibrationLevels)) return null;
  const neighbors = getNearestCalibrationNeighbors(level, calibrationLevels, "tps");
  const nearby = weightedMedian(neighbors.map(neighbor => ({
    value: neighbor.level.tps,
    weight: neighbor.weight,
  })));
  if (nearby !== null) return nearby;

  const allTps = calibrationLevels
    .map(candidate => candidate.tps)
    .filter(tps => Number.isFinite(tps) && tps > 0);
  return allTps.length ? trimmedMean(allTps, 0.2) : null;
}

function getTpsDifficultyMultiplier(level, calibrationLevels = []) {
  const tps = Number(level?.tps);
  if (!level?.isUnverified || !Number.isFinite(tps) || tps <= 0) return 1;
  const baseline = getVerifiedTpsBaseline(level, calibrationLevels);
  const calibratedMultiplier = baseline && baseline > 0 ? clamp(tps / baseline, 1, 1.8) : 1;
  const hardTimingMultiplier = tps > 240
    ? clamp(1 + (tps - 240) / 1200, 1, 1.5)
    : 1;
  return Math.max(calibratedMultiplier, hardTimingMultiplier);
}

function getUnverifiedRankDifficultyMultiplier(level, maxPoints, calibrationLevels = []) {
  if (!level?.isUnverified) return 1;
  const rank = Number(level.modelRank || level._difficultyRank || level.rank);
  const maxRank = Math.max(1, Number(level._estimatedRankMax) || Number(maxPoints));
  if (!Number.isFinite(rank) || rank <= 0 || maxRank <= 1) return 1;

  const rankPercentile = clamp((maxRank - rank) / (maxRank - 1), 0, 1);
  const rankMultiplier = 0.85 + 0.45 * Math.pow(rankPercentile, 0.85);
  const precisionMultiplier = getPrecisionDifficultyMultiplier(level, calibrationLevels);
  return clamp(rankMultiplier * precisionMultiplier, 0.7, 2.2);
}

function getUnverifiedUncertaintyMultiplier(level) {
  if (!level?.isUnverified) return 1;
  const confidence = level.sourceConfidence ?? getUnverifiedSourceConfidence(level);
  return clamp(1.12 - confidence * 0.12, 1, 1.12);
}

function getUnverifiedMetadataPointMultiplier(level, calibrationLevels = []) {
  if (!level?.isUnverified) return 1;

  const precisionMultiplier = getPrecisionDifficultyMultiplier(level, calibrationLevels);
  const lengthMultiplier = getLengthDifficultyMultiplier(level, calibrationLevels);
  const tpsMultiplier = getTpsDifficultyMultiplier(level, calibrationLevels);
  const tierMultiplier = getTierDifficultyMultiplier(level);
  const elevatedSignals = [precisionMultiplier, lengthMultiplier, tpsMultiplier]
    .filter(multiplier => multiplier >= 1.2).length;
  const extremeCombinationMultiplier = elevatedSignals >= 2 ? 1.05 : 1;
  const coordinationMultiplier = level.is2Player === true ? 1.08 : 1;

  return clamp(
    Math.pow(precisionMultiplier, 0.35)
      * Math.pow(lengthMultiplier, 0.35)
      * Math.pow(tierMultiplier, 0.2)
      * Math.pow(tpsMultiplier, 0.35)
      * extremeCombinationMultiplier
      * coordinationMultiplier,
    0.85,
    1.65,
  );
}

function getUnverifiedCoordinationDifficultyMultiplier(level) {
  return level?.isUnverified && level.is2Player === true ? 1.12 : 1;
}

function getVerifiedTimeCalibration(level, calibrationLevels) {
  if (!level.isUnverified || !Array.isArray(calibrationLevels)) return 1;
  const ratios = getNearestCalibrationNeighbors(level, calibrationLevels, null)
    .map(neighbor => {
      const candidate = neighbor.level;
      const times = candidate.victors.map(v => v.seconds).filter(seconds => seconds > 0);
      return times.length && candidate.points > 0
        ? { value: trimmedMean(times) / candidate.points, weight: neighbor.weight }
        : null;
    })
    .filter(ratio => ratio && Number.isFinite(ratio.value) && ratio.value > 0);
  if (!ratios.length) return 1;
  const overall = calibrationLevels
    .flatMap(candidate => candidate.victors.map(v => v.seconds).filter(seconds => seconds > 0))
    .filter(seconds => seconds > 0);
  const overallRatio = overall.length
    ? trimmedMean(overall) / Math.max(trimmedMean(calibrationLevels.map(candidate => candidate.points).filter(points => points > 0)), 1)
    : null;
  const nearbyRatio = weightedMedian(ratios);
  return overallRatio && nearbyRatio ? clamp(nearbyRatio / overallRatio, 0.7, 1.5) : 1;
}

function getUnverifiedMinimumSeconds(level, avgTimePerPoint) {
  if (!level?.isUnverified) return 0;
  const calibratedFloor = Number.isFinite(avgTimePerPoint) && avgTimePerPoint > 0 && level.points > 0
    ? level.points * avgTimePerPoint * 0.75
    : 0;
  return Math.max(8 * 60, calibratedFloor);
}

function estimateLevelOutcome(level, components, avgTimePerPoint, avgAttemptsPerPoint, maxPoints, calibrationLevels = []) {
  const victorTimes = level.victors
    .map(v => v.seconds)
    .filter(t => t !== null && t > 0);
  const hasObservedTime = victorTimes.length > 0;

  const victorAttempts = level.victors
    .map(v => v.attempts)
    .filter(a => Number.isFinite(a) && a > 0);

  let baseTime;
  if (victorTimes.length > 0) {
    baseTime = trimmedMean(victorTimes);
  } else if (avgTimePerPoint !== null && level.points > 0) {
    baseTime = level.points * avgTimePerPoint;
  } else {
    baseTime = 7200;
  }

  if (!hasObservedTime) {
    baseTime *= getVerifiedTimeCalibration(level, calibrationLevels);
  }

  if (level.isUnverified && !hasObservedTime) {
    baseTime *= getUnverifiedRankDifficultyMultiplier(level, maxPoints, calibrationLevels);
    baseTime *= getTpsDifficultyMultiplier(level, calibrationLevels);
    baseTime *= getUnverifiedCoordinationDifficultyMultiplier(level);
  }

  let baseAttempts = null;
  if (victorAttempts.length > 0) {
    baseAttempts = getRobustAttemptBaseline(victorAttempts);
  } else if (avgAttemptsPerPoint !== null && level.points > 0) {
    baseAttempts = level.points * avgAttemptsPerPoint;
  }

  const modelPredictedAttempts = predictPlayerAttempts(
    level,
    components && components.attemptsModel ? components.attemptsModel : null,
    calibrationLevels,
  );
  if (modelPredictedAttempts !== null) baseAttempts = modelPredictedAttempts;

  function difficultyModifier(level, maxPoints) {
    const maxP = Math.max(1, maxPoints || 1);
    const norm = (level.points || 0) / maxP;
    const mod = 1 + (norm - 0.5) * 0.8;
    const attempts = level.victors
      .map(v => Number(v.attempts))
      .filter(a => Number.isFinite(a) && a > 0);
    const medianAttempts = getRobustAttemptBaseline(attempts);
    const attemptsFactor = medianAttempts === null ? 1 : clamp(1 + (medianAttempts / 50 - 1) * 0.25, 0.8, 2.0);
    const tierMultiplier = level.isUnverified ? getTierDifficultyMultiplier(level) : 1;
    return clamp(
      mod
      * attemptsFactor
      * tierMultiplier
      * getPrecisionDifficultyMultiplier(level, calibrationLevels)
      * getLengthDifficultyMultiplier(level, calibrationLevels),
      0.7,
      2.2,
    );
  }

  function familiarityModifier(level, playerName) {
    if (!playerName) return 1;
    const has = level.victors.some(v => v.name === playerName);
    if (has) return 0.85;
    return 1.0;
  }

  const famMod = familiarityModifier(level, components && components._playerName ? components._playerName : null);
  const dimensionSkillValues = [];
  if (Number(level.precision) > 0 && components?.precision) dimensionSkillValues.push(components.precision);
  if (Number(level.tps) > 0 && components?.highTps) dimensionSkillValues.push(components.highTps);
  if (Number(level.length) > 0 && components?.endurance) dimensionSkillValues.push(components.endurance);
  if (level.is2Player === true && components?.coordination) dimensionSkillValues.push(components.coordination);
  const dimensionSkillModifier = dimensionSkillValues.length
    ? geometricMean(dimensionSkillValues)
    : 1;

  const modelPredictedSeconds = predictPlayerTime(level, components && components.model ? components.model : null);
  if (modelPredictedSeconds !== null && !hasObservedTime) {
      const expectedAttempts = baseAttempts && baseAttempts > 0
        ? baseAttempts * (components && components.attempts ? components.attempts : 1) * famMod
        : null;
      const wrTimeSeconds = level.wrTime ? parseTimeToSeconds(level.wrTime.time) : null;
      const minObserved = victorTimes.length ? Math.min(...victorTimes) : null;
      const bestObserved = wrTimeSeconds !== null ? wrTimeSeconds : minObserved;
      const LOWER_BOUND_FACTOR = 0.6;
      const lowerBound = bestObserved !== null ? bestObserved * LOWER_BOUND_FACTOR : null;

      let expectedSeconds = modelPredictedSeconds
        * dimensionSkillModifier
        * (level.isUnverified ? getTierDifficultyMultiplier(level) : 1)
        * getPrecisionDifficultyMultiplier(level, calibrationLevels)
        * getLengthDifficultyMultiplier(level, calibrationLevels);
      if (level.isUnverified) {
        expectedSeconds *= getTpsDifficultyMultiplier(level, calibrationLevels);
        expectedSeconds *= getUnverifiedCoordinationDifficultyMultiplier(level);
      }
      if (lowerBound !== null && Number.isFinite(expectedSeconds) && expectedSeconds < lowerBound) {
        expectedSeconds = lowerBound;
      }
      return { expectedSeconds, expectedAttempts };
  }

  const diffMod = hasObservedTime ? 1 : difficultyModifier(level, maxPoints);

  const predictedMultiplier = (components && components.speed ? components.speed : 1)
    * dimensionSkillModifier
    * diffMod
    * famMod;
  const predicted = baseTime && baseTime > 0 ? baseTime * predictedMultiplier : null;

  const wrTimeSeconds = level.wrTime ? parseTimeToSeconds(level.wrTime.time) : null;
  const minObserved = victorTimes.length ? Math.min(...victorTimes) : null;
  const bestObserved = wrTimeSeconds !== null ? wrTimeSeconds : minObserved;
  const LOWER_BOUND_FACTOR = 0.6;
  const lowerBound = bestObserved !== null ? bestObserved * LOWER_BOUND_FACTOR : null;

  const expectedSeconds = predicted !== null && lowerBound !== null
    ? Math.max(predicted, lowerBound)
    : predicted;
  const expectedAttempts = baseAttempts && baseAttempts > 0
    ? baseAttempts * (components && components.attempts ? components.attempts : 1) * famMod
    : null;

  return { expectedSeconds, expectedAttempts };
}

function recordMultiplier(recordCount) {
  if (!Number.isFinite(recordCount) || recordCount <= 0) return 1;

  const multipliers = {
    0: 1,
    1: 1.15,
    2: 1.35,
    3: 1.6
  };

  return multipliers[Math.min(recordCount, 3)] || 1;
}

function getTimeScore(playerSeconds, bestSeconds) {
  if (!Number.isFinite(playerSeconds)) return 0;
  if (!Number.isFinite(bestSeconds) || bestSeconds < 0) return 0;
  if (playerSeconds === 0) return bestSeconds >= 0 ? 1 : 0;
  if (bestSeconds <= 0) return 0;
  return Math.min(bestSeconds / playerSeconds, 1);
}

function getTierCompletionMultiplier(completions) {
  if (!Number.isFinite(completions) || completions <= 0) return 1;
  const tierCompletionDecay = typeof TIER_COMPLETION_DECAY !== "undefined"
    ? TIER_COMPLETION_DECAY
    : 0.95;
  return Math.pow(tierCompletionDecay, completions);
}

function projectedMultiplierFor(level, expectedSeconds, expectedAttempts, playerName, completions) {
  const completionMultiplier = getTierCompletionMultiplier(completions);
  const firstVictorBonus = typeof FIRST_VICTOR_BONUS !== "undefined" ? FIRST_VICTOR_BONUS : 0.1;
  const fastestCompletionBonus = typeof FASTEST_COMPLETION_BONUS !== "undefined" ? FASTEST_COMPLETION_BONUS : 0.1;
  const lowestAttemptsBonus = typeof LOWEST_ATTEMPTS_BONUS !== "undefined" ? LOWEST_ATTEMPTS_BONUS : 0.1;

  const syntheticPlayer = {
    name: String(playerName || "projected-player").trim() || "projected-player",
    seconds: Number.isFinite(expectedSeconds) && expectedSeconds > 0 ? expectedSeconds : null,
    attempts: Number.isFinite(expectedAttempts) && expectedAttempts > 0 ? expectedAttempts : null,
    date: "0000-01-01T00:00:00.000Z",
  };

  const validEntries = (level.victors || [])
    .filter(isEligibleVictor)
    .map(victor => ({
      ...victor,
      name: String(victor.name || "").trim(),
      seconds: Number.isFinite(victor.seconds) ? victor.seconds : null,
      attempts: Number.isFinite(victor.attempts) && victor.attempts > 0 ? victor.attempts : null,
    }));

  const sortedValidEntries = sortVictorsByDate(validEntries);
  const players = [...sortedValidEntries, syntheticPlayer];
  const sortedPlayers = sortVictorsByDate(players);
  const existingVictorCount = sortedValidEntries.length;
  const victorOrderBonus = typeof getVictorOrderBonus === "function"
    ? getVictorOrderBonus(existingVictorCount)
    : (existingVictorCount === 0 ? firstVictorBonus : 0);
  const canHoldRecord = existingVictorCount > 0;

  const timeRankings = sortedPlayers
    .filter(victor => Number.isFinite(victor.seconds))
    .sort((a, b) => {
      if (a.seconds !== b.seconds) return a.seconds - b.seconds;
      const aDate = getVictorSortValue(a);
      const bDate = getVictorSortValue(b);
      if (aDate == null && bDate == null) return 0;
      if (aDate == null) return 1;
      if (bDate == null) return -1;
      return aDate - bDate;
    });

  const attemptRankings = sortedPlayers
    .filter(victor => Number.isFinite(victor.attempts) && victor.attempts > 0)
    .sort((a, b) => a.attempts - b.attempts);

  const bestTimeSeconds = timeRankings.length ? Number(timeRankings[0].seconds) : null;
  const timeScore = bestTimeSeconds !== null && Number.isFinite(expectedSeconds) && expectedSeconds > 0
    ? getTimeScore(expectedSeconds, bestTimeSeconds)
    : 0;

  const timeRank = timeRankings.findIndex(victor => String(victor.name || "").trim() === syntheticPlayer.name) + 1;
  const attemptRank = attemptRankings.findIndex(victor => String(victor.name || "").trim() === syntheticPlayer.name) + 1;

  const bonusMultiplier = 1 +
    victorOrderBonus +
    (canHoldRecord && timeRank === 1 ? fastestCompletionBonus : 0) +
    (canHoldRecord && attemptRank === 1 ? lowestAttemptsBonus : 0);

  const leaderboardStyleMultiplier = timeScore * bonusMultiplier * completionMultiplier;
  if (Number.isFinite(leaderboardStyleMultiplier) && leaderboardStyleMultiplier > 0) {
    return leaderboardStyleMultiplier;
  }

  const wrTimeSeconds = level.wrTime ? parseTimeToSeconds(level.wrTime.time) : null;
  const timePossible = canHoldRecord
    && wrTimeSeconds !== null && expectedSeconds !== null && expectedSeconds < wrTimeSeconds;

  const wrAttempts = level.wrAttempts ? Number(level.wrAttempts.attempts) : null;
  const attemptsPossible = canHoldRecord
    && wrAttempts !== null && Number.isFinite(wrAttempts) && expectedAttempts !== null && expectedAttempts < wrAttempts;

  const firstVictoryPossible = existingVictorCount === 0 ? 1 : 0;
  const recordCount = firstVictoryPossible + (timePossible ? 1 : 0) + (attemptsPossible ? 1 : 0);
  return recordMultiplier(recordCount);
}

function buildRecommendations(levels, player, avgTimePerPoint, avgAttemptsPerPoint, maxPoints, allLevels = levels, calibrationLevels = []) {
  if (!player) return [];
  const beaten = new Set(player.levels);
  const components = calculateSkillComponents(
    calibrationLevels.length ? calibrationLevels : levels,
    player.name,
  );

  components._playerName = player.name;

  const allOrderedLevels = [...allLevels].sort((a, b) => {
    const tierA = (a.tier || "unknown").toLowerCase();
    const tierB = (b.tier || "unknown").toLowerCase();
    if (tierA !== tierB) return tierA.localeCompare(tierB);
    return (b.points || 0) - (a.points || 0);
  });

  const playerTierCompletions = new Map();
  const completionCountsByLevel = new Map();

  allOrderedLevels.forEach((lvl) => {
    const tierKey = `${(lvl.tier || "unknown").toLowerCase()}|${player.name}`;
    const currentCompletions = playerTierCompletions.get(tierKey) || 0;
    if (!beaten.has(lvl.name)) {
      completionCountsByLevel.set(lvl.name, currentCompletions);
    }
    if (beaten.has(lvl.name)) {
      playerTierCompletions.set(tierKey, currentCompletions + 1);
    }
  });

  const recommendations = allOrderedLevels
    .filter(lvl => !beaten.has(lvl.name))
    .map(lvl => {
      const basePoints = lvl.points || 0;
      if (basePoints <= 0) return null;

      const { expectedSeconds, expectedAttempts } = estimateLevelOutcome(lvl, components, avgTimePerPoint, avgAttemptsPerPoint, maxPoints, calibrationLevels);
      if (expectedSeconds === null || expectedSeconds <= 0) {
        console.log("Rejected prediction:", {
          level: lvl.name,
          points: lvl.points,
          expectedSeconds,
          model: components.model,
        });
        return null;
      }

      const completions = completionCountsByLevel.get(lvl.name) || 0;
      const expectedHours = expectedSeconds / 3600;
      const projectedMult = projectedMultiplierFor(lvl, expectedSeconds, expectedAttempts, player.name, completions);
      const projectedPoints = basePoints * projectedMult;
      const expectedValue = projectedPoints / expectedHours;
      const wrTimeSeconds = lvl.wrTime ? parseTimeToSeconds(lvl.wrTime.time) : null;
      const wrAttempts = lvl.wrAttempts ? Number(lvl.wrAttempts.attempts) : null;
      const levelAvgVictorTime = lvl.avgVictorTime ?? null;
      const levelAvgAttempts = lvl.avgVictorAttempts ?? null;
      const victorCount = lvl.victors.length;
      const confidence = victorCount > 0
        ? (victorCount / (victorCount + 3))
        : (lvl.isUnverified ? getUnverifiedSourceConfidence(lvl) * 0.5 : 0);
      const uncertainty = lvl.isUnverified
        ? clamp(0.35 - confidence * 0.2, 0.1, 0.35)
        : clamp(0.18 - confidence * 0.1, 0.05, 0.18);

      const timeWrPossible = wrTimeSeconds !== null
        && expectedSeconds !== null
        && expectedSeconds < wrTimeSeconds;
      const attemptsWrPossible = wrAttempts !== null
        && Number.isFinite(wrAttempts)
        && expectedAttempts !== null
        && expectedAttempts < wrAttempts;
      const hasWrTime = wrTimeSeconds !== null;
      const hasWrAttempts = wrAttempts !== null && Number.isFinite(wrAttempts);

      return {
        id: lvl.id || lvl.name,
        level: lvl.name,
        is2Player: lvl.is2Player === true,
        isUnverified: lvl.isUnverified === true,
        rank: lvl.rank || null,
        estimatedMainListRank: getEstimatedMainListRank(lvl, calibrationLevels),
        estimatedMainListRankRange: lvl.tierEstimatedRankRange || null,
        basePoints,
        projectedMult,
        projectedPoints,
        expectedHours,
        expectedSeconds,
        expectedAttempts,
        expectedValue,
        pointUncertainty: uncertainty,
        timeUncertainty: uncertainty,
        projectedPointsLower: projectedPoints * (1 - uncertainty),
        projectedPointsUpper: projectedPoints * (1 + uncertainty),
        expectedHoursLower: expectedHours * (1 - uncertainty),
        expectedHoursUpper: expectedHours * (1 + uncertainty),
        victorCount: victorCount,
        timeWrPossible,
        attemptsWrPossible,
        hasWrTime,
        hasWrAttempts,
        wrConfidence: confidence,
      };
    })
    .filter(Boolean)
    .reduce((unique, rec) => {
      const key = String(rec.id).trim().toLowerCase();
      if (!key || unique.some(item => String(item.id).trim().toLowerCase() === key)) return unique;
      unique.push(rec);
      return unique;
    }, []);

  return recommendations.sort((a, b) => b.expectedValue - a.expectedValue);
}

function pruneDominatedRecommendations(recommendations) {
  if (!Array.isArray(recommendations) || recommendations.length <= 1) return recommendations;

  const bonusPotential = recommendation => ({
    timeWrPossible: recommendation.timeWrPossible === true,
    attemptsWrPossible: recommendation.attemptsWrPossible === true,
    wrConfidence: recommendation.wrConfidence || 0,
  });
  const noWorseBonusPotential = (dominator, candidate) => {
    const dominatorBonus = bonusPotential(dominator);
    const candidateBonus = bonusPotential(candidate);
    return dominatorBonus.timeWrPossible >= candidateBonus.timeWrPossible
      && dominatorBonus.attemptsWrPossible >= candidateBonus.attemptsWrPossible
      && dominatorBonus.wrConfidence >= candidateBonus.wrConfidence;
  };

  return recommendations.filter((candidate, candidateIndex) => {
    const candidatePoints = candidate.projectedPoints || 0;
    const candidateHours = candidate.expectedHours || 0;

    return !recommendations.some((other, otherIndex) => {
      if (candidateIndex === otherIndex) return false;

      const otherPoints = other.projectedPoints || 0;
      const otherHours = other.expectedHours || 0;
      const otherPointsLower = other.projectedPointsLower ?? otherPoints;
      const candidatePointsUpper = candidate.projectedPointsUpper ?? candidatePoints;
      const otherHoursUpper = other.expectedHoursUpper ?? otherHours;
      const candidateHoursLower = candidate.expectedHoursLower ?? candidateHours;
      const dominates = otherPointsLower >= candidatePointsUpper
        && otherHoursUpper <= candidateHoursLower
        && noWorseBonusPotential(other, candidate);
      const strictlyBetter = otherPoints > candidatePoints
        || otherHours < candidateHours
        || (other.timeWrPossible === true && candidate.timeWrPossible !== true)
        || (other.attemptsWrPossible === true && candidate.attemptsWrPossible !== true)
        || (other.wrConfidence || 0) > (candidate.wrConfidence || 0);

      return dominates && strictlyBetter;
    });
  });
}

function refineRouteLocalSearch(picks, items, targetPoints, maxIterations = 400) {
  if (!picks.length) return { picks, time: 0 };

  let currentPicks = [...picks];
  let currentIds = new Set(currentPicks.map(p => p.id));
  let currentPoints = currentPicks.reduce((s, p) => s + (p.projectedPoints || 0), 0);
  let currentTime = currentPicks.reduce((s, p) => s + (p.expectedHours || 0), 0);

  let improved = true;
  let iterations = 0;

  while (improved && iterations < maxIterations) {
    improved = false;
    iterations++;

    for (let i = 0; i < currentPicks.length; i++) {
      const outgoing = currentPicks[i];
      const pointsWithout = currentPoints - (outgoing.projectedPoints || 0);
      const timeWithout = currentTime - (outgoing.expectedHours || 0);

      if (pointsWithout >= targetPoints && timeWithout < currentTime - 1e-9) {
        currentPicks.splice(i, 1);
        currentIds.delete(outgoing.id);
        currentPoints = pointsWithout;
        currentTime = timeWithout;
        improved = true;
        break;
      }

      for (const candidate of items) {
        if (currentIds.has(candidate.id)) continue;
        const swappedPoints = pointsWithout + (candidate.projectedPoints || 0);
        const swappedTime = timeWithout + (candidate.expectedHours || 0);
        if (swappedPoints >= targetPoints && swappedTime < currentTime - 1e-9) {
          currentPicks[i] = candidate;
          currentIds.delete(outgoing.id);
          currentIds.add(candidate.id);
          currentPoints = swappedPoints;
          currentTime = swappedTime;
          improved = true;
          break;
        }
      }
      if (improved) break;
    }
  }

  return { picks: currentPicks, time: currentTime };
}

function buildFallbackRoute(items, targetPoints) {
  const sortedItems = [...items].sort((a, b) => {
    const aScore = (a.projectedPoints || 0) / Math.max(a.expectedHours || 1, 0.001);
    const bScore = (b.projectedPoints || 0) / Math.max(b.expectedHours || 1, 0.001);
    return bScore - aScore;
  });

  const picks = [];
  let totalTime = 0;
  let totalPoints = 0;

  for (const item of sortedItems) {
    picks.push(item);
    totalTime += item.expectedHours || 0;
    totalPoints += item.projectedPoints || 0;
    if (totalPoints + 1e-9 >= targetPoints) {
      return { time: totalTime, picks, fallback: false };
    }
  }

  return { time: totalTime, picks, fallback: true };
}

function optimizeParetoRoute(items, targetUnits, targetPoints, maxStates = 12000) {
  let states = [{ units: 0, time: 0, picks: [] }];

  for (const item of items) {
    const expanded = states.concat(states.map(state => ({
      units: state.units + item.units,
      time: state.time + item.expectedHours,
      picks: [...state.picks, item],
    })));

    expanded.sort((a, b) => a.units - b.units || a.time - b.time || a.picks.length - b.picks.length);
    const frontier = [];
    let bestTime = Infinity;
    for (const state of expanded) {
      if (state.time < bestTime - 1e-9) {
        frontier.push(state);
        bestTime = state.time;
      }
    }

    if (frontier.length > maxStates) {
      frontier.sort((a, b) => {
        const aDistance = Math.abs(a.units - targetUnits);
        const bDistance = Math.abs(b.units - targetUnits);
        return aDistance - bDistance || a.time - b.time;
      });
      frontier.length = maxStates;
    }
    states = frontier;
  }

  const validStates = states.filter(state => state.units >= targetUnits);
  const best = (validStates.length ? validStates : states)
    .sort((a, b) => a.time - b.time || Math.abs(a.units - targetUnits) - Math.abs(b.units - targetUnits))[0];
  if (!best || !best.picks.length) return null;

  const refined = refineRouteLocalSearch(best.picks, items, targetPoints);
  return { time: refined.time, picks: refined.picks, fallback: !validStates.length };
}

function optimizeRoute(recommendations, targetPoints, granularity = 20) {
  if (!Array.isArray(recommendations) || !recommendations.length || targetPoints <= 0) {
    return { time: 0, picks: [], fallback: false };
  }

  const MAX_DP_UNITS = 60000;

  const effectiveGranularity = Number.isFinite(granularity) && granularity > 0
    ? granularity
    : 20;
  const adaptiveGranularity = Math.max(1, Math.min(100, Math.round(100 / Math.max(1, targetPoints))));
  let resolvedGranularity = Math.max(effectiveGranularity, adaptiveGranularity);

  const toUnits = item => Math.max(1, Math.round(((item.basePoints || item.projectedPoints) || 0) * resolvedGranularity));

  let items = pruneDominatedRecommendations(recommendations)
    .map(item => ({
      ...item,
      units: toUnits(item),
    }))
    .filter(item => item.units > 0)
    .sort((a, b) => {
      const aScore = (a.projectedPoints || 0) / Math.max(a.expectedHours || 1, 0.001);
      const bScore = (b.projectedPoints || 0) / Math.max(b.expectedHours || 1, 0.001);
      return bScore - aScore;
    });

  if (!items.length) {
    return { time: 0, picks: [], fallback: false };
  }

  let targetUnits = Math.max(1, Math.round(targetPoints * resolvedGranularity));
  let totalUnits = items.reduce((sum, item) => sum + item.units, 0);
  let largestItemUnits = Math.max(...items.map(item => item.units));
  let maxUnits = Math.min(totalUnits, targetUnits + largestItemUnits);

  if (maxUnits > MAX_DP_UNITS) {
    const paretoResult = optimizeParetoRoute(items, targetUnits, targetPoints);
    if (paretoResult) return paretoResult;

    const scale = MAX_DP_UNITS / maxUnits;
    resolvedGranularity = Math.max(1, Math.floor(resolvedGranularity * scale));
    items = items.map(item => ({
      ...item,
      units: toUnits(item),
    }));
    targetUnits = Math.max(1, Math.round(targetPoints * resolvedGranularity));
    totalUnits = items.reduce((sum, item) => sum + item.units, 0);
    largestItemUnits = Math.max(...items.map(item => item.units));
    maxUnits = Math.min(totalUnits, targetUnits + largestItemUnits);
  }

  const dpTime = new Float64Array(maxUnits + 1).fill(Infinity);
  const dpLevels = new Int32Array(maxUnits + 1).fill(Infinity);
  const dpParentUnits = new Int32Array(maxUnits + 1).fill(-1);
  const dpParentItem = new Int32Array(maxUnits + 1).fill(-1);
  dpTime[0] = 0;
  dpLevels[0] = 0;

  for (let itemIdx = 0; itemIdx < items.length; itemIdx++) {
    const item = items[itemIdx];
    for (let units = maxUnits; units >= 0; units--) {
      if (dpTime[units] === Infinity) continue;

      const nextUnits = units + item.units;
      if (nextUnits > maxUnits) continue;
      const nextTime = dpTime[units] + item.expectedHours;
      const nextLevels = dpLevels[units] + 1;

      if (nextTime < dpTime[nextUnits] - 1e-9
        || (Math.abs(nextTime - dpTime[nextUnits]) < 1e-9 && nextLevels < dpLevels[nextUnits])) {
        dpTime[nextUnits] = nextTime;
        dpLevels[nextUnits] = nextLevels;
        dpParentUnits[nextUnits] = units;
        dpParentItem[nextUnits] = itemIdx;
      }
    }
  }

  let bestUnits = 0;
  let bestTime = Infinity;
  let bestLevels = Infinity;

  for (let units = targetUnits; units <= maxUnits; units++) {
    if (dpTime[units] === Infinity) continue;

    const overshootUnits = units - targetUnits;
    const bestOvershootUnits = bestUnits - targetUnits;
    const isBetter = dpTime[units] < bestTime - 1e-9
      || (Math.abs(dpTime[units] - bestTime) < 1e-9 && (
        overshootUnits < bestOvershootUnits
        || (overshootUnits === bestOvershootUnits && dpLevels[units] < bestLevels)
      ));

    if (isBetter) {
      bestUnits = units;
      bestTime = dpTime[units];
      bestLevels = dpLevels[units];
    }
  }

  if (bestUnits === 0) {
    for (let units = maxUnits; units > 0; units--) {
      if (dpTime[units] < Infinity) {
        bestUnits = units;
        bestTime = dpTime[units];
        break;
      }
    }
  }

  if (bestUnits === 0 || dpTime[bestUnits] === Infinity) {
    return buildFallbackRoute(items, targetPoints);
  }

  const picks = [];
  let cursor = bestUnits;
  while (dpParentItem[cursor] !== -1) {
    picks.push(items[dpParentItem[cursor]]);
    cursor = dpParentUnits[cursor];
  }

  picks.reverse();

  const refined = refineRouteLocalSearch(picks, items, targetPoints);
  const totalProjectedPoints = refined.picks.reduce((sum, rec) => sum + (rec.projectedPoints || 0), 0);

  if (totalProjectedPoints + 1e-9 < targetPoints) {
    return buildFallbackRoute(items, targetPoints);
  }

  return {
    time: refined.time,
    picks: refined.picks,
    fallback: false,
  };
}

function reoptimizeRouteWithModifications(
  recommendations,
  targetPoints,
  currentPicks,
  lockedLevelIds = [],
  removedLevelIds = []
) {
  if (!Array.isArray(recommendations) || !recommendations.length || targetPoints <= 0) {
    return { time: 0, picks: [], fallback: false, message: "No recommendations available" };
  }

  const lockedSet = new Set(lockedLevelIds.map(id => String(id).trim().toLowerCase()));
  const removedSet = new Set(removedLevelIds.map(id => String(id).trim().toLowerCase()));
  const lockedPicks = [];
  const availableForReopt = [];

  recommendations.forEach(rec => {
    const recId = String(rec.id || rec.level).trim().toLowerCase();
    if (lockedSet.has(recId)) {
      lockedPicks.push(rec);
    } else if (!removedSet.has(recId)) {
      availableForReopt.push(rec);
    }
  });
  const lockedPoints = lockedPicks.reduce((sum, rec) => sum + (rec.basePoints || 0), 0);
  const lockedTime = lockedPicks.reduce((sum, rec) => sum + (rec.expectedHours || 0), 0);
  const remainingPointsNeeded = Math.max(0, targetPoints - lockedPoints);
  if (remainingPointsNeeded <= 0) {
    return {
      time: lockedTime,
      picks: lockedPicks,
      fallback: false,
      message: "Locked levels meet target",
    };
  }
  if (availableForReopt.length === 0) {
    return {
      time: lockedTime,
      picks: lockedPicks,
      fallback: true,
    };
  }
  const reoptResult = optimizeRoute(availableForReopt, remainingPointsNeeded);
  const combinedPicks = [...lockedPicks, ...reoptResult.picks];
  const combinedTime = lockedTime + reoptResult.time;

  return {
    time: combinedTime,
    picks: combinedPicks,
    fallback: reoptResult.fallback,
    lockedCount: lockedPicks.length,
    reoptCount: reoptResult.picks.length,
  };
}

function defaultTarget(leaderboard, currentName) {
  const idx = leaderboard.findIndex(p => p.name === currentName);
  if (idx <= 0) return leaderboard.find(p => p.name !== currentName) || null;
  return leaderboard[idx - 1];
}

const SURPASS_MARGIN = 0.01;

function targetRankSurpassPoints(leaderboard, targetPlayer) {
  if (!targetPlayer) return 0;
  return targetPlayer.points + SURPASS_MARGIN;
}

function projectLevelsAfterRoute(levels, picks) {
  if (!Array.isArray(levels) || !Array.isArray(picks) || !picks.length) return levels;

  const pickByLevel = new Map(
    picks.map(pick => [String(pick.id || pick.level).trim().toLowerCase(), pick])
  );
  const projectedPlayerName = "__projected-ladder-player__";

  return levels.map(level => {
    const levelKey = String(level.id || level.name).trim().toLowerCase();
    const pick = pickByLevel.get(levelKey);
    if (!pick) return level;

    const victors = Array.isArray(level.victors) ? [...level.victors] : [];
    victors.push({
      name: projectedPlayerName,
      date: "9999-12-31",
      seconds: Number.isFinite(pick.expectedSeconds) ? pick.expectedSeconds : null,
      attempts: Number.isFinite(pick.expectedAttempts) ? pick.expectedAttempts : null,
    });
    return { ...level, victors };
  });
}

function projectTargetPointsAfterRoute(levels, targetPlayer, picks) {
  if (!targetPlayer || !Array.isArray(levels) || !Array.isArray(picks) || !picks.length) {
    return (targetPlayer?.points || 0) + SURPASS_MARGIN;
  }

  const projectedLevels = projectLevelsAfterRoute(levels, picks);

  const projectedTarget = buildLeaderboard(projectedLevels)
    .find(player => player.name === targetPlayer.name);
  return (projectedTarget?.points ?? targetPlayer.points) + SURPASS_MARGIN;
}

function updateRecommendationsIncrementally(recommendations, selectedIds, removedIds) {
  if (!Array.isArray(recommendations)) return [];
  const excludedIds = new Set([...selectedIds, ...removedIds]);
  return recommendations.filter(recommendation => {
    const id = String(recommendation.id || recommendation.level).trim().toLowerCase();
    return id && !excludedIds.has(id);
  });
}

function hasValidIncrementalRoute(recommendations, targetPoints, routePoints) {
  if (routePoints + 1e-9 >= targetPoints) return true;
  return recommendations.some(recommendation => (recommendation.projectedPoints || 0) > 0);
}

const projectedRecommendationCache = new WeakMap();

function buildCachedProjectedRecommendations(
  levels,
  selected,
  currentPlayer,
  avgTimePerPoint,
  avgAttemptsPerPoint,
  maxPoints,
  calibrationLevels,
) {
  if (!Array.isArray(levels) || !Array.isArray(calibrationLevels)) return [];

  let byCalibration = projectedRecommendationCache.get(levels);
  if (!byCalibration) {
    byCalibration = new WeakMap();
    projectedRecommendationCache.set(levels, byCalibration);
  }
  let byRoute = byCalibration.get(calibrationLevels);
  if (!byRoute) {
    byRoute = new Map();
    byCalibration.set(calibrationLevels, byRoute);
  }

  const selectedIds = selected
    .map(pick => String(pick.id || pick.level).trim().toLowerCase())
    .sort();
  const playerLevels = Array.isArray(currentPlayer?.levels)
    ? currentPlayer.levels.map(level => String(level).trim().toLowerCase()).sort()
    : [];
  const key = JSON.stringify([
    currentPlayer?.name || "",
    playerLevels,
    selectedIds,
    avgTimePerPoint,
    avgAttemptsPerPoint,
    maxPoints,
  ]);
  if (byRoute.has(key)) return byRoute.get(key);

  const projectedLevels = projectLevelsAfterRoute(levels, selected);
  const projectedPlayer = {
    ...currentPlayer,
    levels: [...(currentPlayer.levels || []), ...selected.map(pick => pick.level)],
  };
  const recommendations = buildRecommendations(
    projectedLevels,
    projectedPlayer,
    avgTimePerPoint,
    avgAttemptsPerPoint,
    maxPoints,
    projectedLevels,
    calibrationLevels,
  );
  byRoute.set(key, recommendations);
  return recommendations;
}

function optimizeSequentialRoute(
  recommendations,
  levels,
  currentPlayer,
  targetPoints,
  avgTimePerPoint,
  avgAttemptsPerPoint,
  maxPoints,
  lockedLevelIds,
  removedLevelIds,
  calibrationLevels = []
) {
  const candidateIds = new Set(
    recommendations.map(rec => String(rec.id || rec.level).trim().toLowerCase())
  );
  const lockedSet = new Set(lockedLevelIds.map(id => String(id).trim().toLowerCase()));
  const removedSet = new Set(removedLevelIds.map(id => String(id).trim().toLowerCase()));
  const strategies = [
    rec => (rec.projectedPoints || 0) / Math.max(rec.expectedHours || 1, 0.001),
    rec => rec.projectedPoints || 0,
    rec => -(rec.expectedHours || 0),
  ];
  const routes = [];

  strategies.forEach(score => {
    const selected = [];
    const selectedIds = new Set();
    let routePoints = 0;
    let routeTime = 0;
    let workingRecommendations = recommendations;
    let incrementalValid = true;

    const select = (pick) => {
      const pickId = String(pick.id || pick.level).trim().toLowerCase();
      if (selectedIds.has(pickId)) return;
      selected.push(pick);
      selectedIds.add(pickId);
      routePoints += pick.projectedPoints || 0;
      routeTime += pick.expectedHours || 0;
    };

    recommendations
      .filter(rec => lockedSet.has(String(rec.id || rec.level).trim().toLowerCase()))
      .forEach(select);

    while (routePoints + 1e-9 < targetPoints) {
      const next = workingRecommendations
        .filter(rec => {
          const recId = String(rec.id || rec.level).trim().toLowerCase();
          return candidateIds.has(recId) && !selectedIds.has(recId) && !removedSet.has(recId);
        })
        .sort((a, b) => score(b) - score(a))[0];
      if (!next) break;

      select(next);
      if (incrementalValid) {
        workingRecommendations = updateRecommendationsIncrementally(
          workingRecommendations,
          selectedIds,
          removedSet,
        );
        incrementalValid = hasValidIncrementalRoute(workingRecommendations, targetPoints, routePoints);
      }

      if (!incrementalValid) {
        workingRecommendations = buildCachedProjectedRecommendations(
          levels,
          selected,
          currentPlayer,
          avgTimePerPoint,
          avgAttemptsPerPoint,
          maxPoints,
          calibrationLevels,
        ).filter(rec => candidateIds.has(String(rec.id || rec.level).trim().toLowerCase()));
        incrementalValid = true;
      }
    }

    routes.push({
      time: routeTime,
      picks: selected,
      fallback: routePoints + 1e-9 < targetPoints,
    });
  });

  return routes
    .filter(route => !route.fallback)
    .sort((a, b) => a.time - b.time)[0]
    || routes.sort((a, b) => b.picks.length - a.picks.length)[0]
    || { time: 0, picks: [], fallback: false };
}

function optimizeRouteWithProjectedTarget(
  recommendations,
  targetPlayer,
  levels,
  currentPoints,
  lockedLevelIds = [],
  removedLevelIds = [],
  currentPlayer = null,
  avgTimePerPoint = 0,
  avgAttemptsPerPoint = 0,
  maxPoints = 1,
  calibrationLevels = []
) {
  let targetPoints = (targetPlayer?.points || 0) + SURPASS_MARGIN;
  const pointsNeeded = Math.max(0, targetPoints - currentPoints);
  const result = currentPlayer
    ? optimizeSequentialRoute(
        recommendations,
        levels,
        currentPlayer,
        pointsNeeded,
        avgTimePerPoint,
        avgAttemptsPerPoint,
        maxPoints,
        lockedLevelIds,
        removedLevelIds,
        calibrationLevels
      )
    : lockedLevelIds.length > 0 || removedLevelIds.length > 0
      ? reoptimizeRouteWithModifications(recommendations, pointsNeeded, [], lockedLevelIds, removedLevelIds)
      : optimizeRoute(recommendations, pointsNeeded);

  return {
    ...result,
    targetPoints,
    pointsNeeded: Math.max(0, targetPoints - currentPoints),
  };
}