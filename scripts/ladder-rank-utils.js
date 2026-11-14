(function (root) {
  const ESTIMATED_RANK_METRIC_WEIGHTS = Object.freeze({
    tps: 1,
    length: 0.75,
    levelVolume: 1,
    precision: 1.25,
    iaPerSecond: 1,
    ratio: 1,
    victorCount: 0.2,
    victorTime: 0.4,
    victorAttempts: 0.4,
  });

  const FEATURE_FIELDS = Object.freeze(Object.keys(ESTIMATED_RANK_METRIC_WEIGHTS));

  const FEATURE_LABELS = Object.freeze({
    tps: "TPS",
    length: "Length",
    levelVolume: "TPS × Length",
    precision: "Precision",
    iaPerSecond: "IA/s",
    ratio: "Ratio",
    victorCount: "Victor count",
    victorTime: "Victor times",
    victorAttempts: "Victor attempts",
  });

  const ESTIMATED_RANK_PENALTIES = Object.freeze({
    tierMismatch: 0.05,
    twoPlayerMismatch: 0.15,
  });

  const ESTIMATED_RANK_NORMALIZATION = "percentile";

  const MODEL = Object.freeze({
    minTierPool: 4,
    minFeatureSamples: 4,
    maxValidationSamples: 128,
    factorIterations: 50,
    factorTolerance: 1e-7,
    bandwidths: Object.freeze([0.15, 0.3, 0.6, 1e6]),
    kernelFloor: 0.001,
    ridge: 0.002,
    minVariance: 1,
    minSkill: 0.02,
    tierPriorMaxPrecisionRatio: 4,
    timeNormalizationRidge: 0.05,
    timeNormalizationStrength: 0.25,
    // Leave-one-out fit on the 199 levels shared by secret.txt and levels.json.
    priorBlend: 0,
    inferredRankShift: -0.82,
    difficultyCurveExponent: 1.6,
    rankIntervalCoverage: 0.8,
    // 80th percentile of absolute rank error / spread across 400 leave-one-out estimates.
    rankIntervalScale: 0.5814800029047544,
  });

  const predictionModelCache = new WeakMap();
  const victorFactorModelCache = new WeakMap();
  const victorFactorModelIds = new WeakMap();
  const victorLogValueCache = new WeakMap();
  const featureVectorCache = new WeakMap();
  let nextVictorFactorModelId = 1;

  const GAMEMODE_DIFFICULTY_ORDER = Object.freeze({
    SH: 8,
    U: 7,
    R: 6,
    SW: 5,
    C: 4,
    B: 3,
    SP: 2,
    W: 1,
  });

  const SPEED_DIFFICULTY_ORDER = Object.freeze({
    "4x": 5,
    "3x": 4,
    "2x": 3,
    "1x": 2,
    "0.5x": 1,
  });

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function rankToPoints(rank, maxRank) {
    if (!Number.isFinite(rank) || !Number.isFinite(maxRank) || maxRank <= 1) return 360;
    const normalizedRank = clamp(rank, 1, maxRank);
    const ratio = (maxRank - normalizedRank) / (maxRank - 1);
    return 10 + 350 * Math.pow(ratio, MODEL.difficultyCurveExponent);
  }

  function pointsToRank(points, maxRank) {
    if (!Number.isFinite(points) || !Number.isFinite(maxRank) || maxRank <= 1) return 1;
    const ratio = Math.pow(clamp((points - 10) / 350, 0, 1), 1 / MODEL.difficultyCurveExponent);
    return maxRank - ratio * (maxRank - 1);
  }

  function normalizeName(value) {
    return String(value || "").trim().toLowerCase().replace(/\s+/g, " ");
  }

  function getLevelName(level) {
    return normalizeName(level?.name || level?.levelName);
  }

  function getLevelTier(level) {
    const tier = normalizeName(level?.tier || level?.tierName);
    return tier === "pending" ? "" : tier;
  }

  function getPercentile(value, sortedValues) {
    if (!Number.isFinite(value) || !sortedValues.length) return null;
    let lower = 0;
    let upper = sortedValues.length;
    while (lower < upper) {
      const middle = lower + Math.floor((upper - lower) / 2);
      if (sortedValues[middle] < value) lower = middle + 1;
      else upper = middle;
    }
    const lowerCount = lower;
    upper = sortedValues.length;
    while (lower < upper) {
      const middle = lower + Math.floor((upper - lower) / 2);
      if (sortedValues[middle] <= value) lower = middle + 1;
      else upper = middle;
    }
    const equalCount = lower - lowerCount;
    return (lowerCount + equalCount / 2) / sortedValues.length;
  }

  function getFeaturePosition(value, feature) {
    if (feature.field !== "levelVolume") return getPercentile(value, feature.sortedValues);
    const minimum = feature.sortedValues[0];
    const maximum = feature.sortedValues[feature.sortedValues.length - 1];
    const logRange = Math.log(maximum) - Math.log(minimum);
    return logRange > 0 ? (Math.log(value) - Math.log(minimum)) / logRange : 0.5;
  }

  function parseVictorTime(value) {
    if (Number.isFinite(Number(value)) && Number(value) > 0) return Number(value);
    if (typeof value !== "string") return null;
    const parts = { h: 0, m: 0, s: 0 };
    const matches = [...value.matchAll(/(\d+(?:\.\d+)?)\s*([hms])/gi)];
    if (!matches.length) return null;
    matches.forEach(match => {
      parts[match[2].toLowerCase()] = Number(match[1]);
    });
    const seconds = parts.h * 3600 + parts.m * 60 + parts.s;
    return Number.isFinite(seconds) && seconds > 0 ? seconds : null;
  }

  function getRatioDifficultyScore(value) {
    const text = String(value || "");
    if (!text.trim()) return null;

    const modeScores = [];
    const modePattern = /\b(Ship|UFO|Robot|Swing|Cube|Ball|Spider|Wave)\s+(\d+(?:\.\d+)?)%/gi;
    const shortModePattern = /(?:^|\s)(SH|SP|SW|C|B|U|W|R)(\d+(?:\.\d+)?)\(\d+\)/g;
    const modeKeys = {
      ship: "SH",
      ufo: "U",
      robot: "R",
      swing: "SW",
      cube: "C",
      ball: "B",
      spider: "SP",
      wave: "W",
    };
    for (const match of text.matchAll(modePattern)) {
      modeScores.push({ score: GAMEMODE_DIFFICULTY_ORDER[modeKeys[match[1].toLowerCase()]], percent: Number(match[2]) });
    }
    for (const match of text.matchAll(shortModePattern)) {
      modeScores.push({ score: GAMEMODE_DIFFICULTY_ORDER[match[1]], percent: Number(match[2]) });
    }

    const speedScores = [];
    const speedPattern = /\b(0\.5x|1x|2x|3x|4x)\s+(\d+(?:\.\d+)?)%/gi;
    const shortSpeedPattern = /(?:^|\s)(0\.5|1|2|3|4)X(\d+(?:\.\d+)?)\(\d+\)/g;
    for (const match of text.matchAll(speedPattern)) {
      speedScores.push({ score: SPEED_DIFFICULTY_ORDER[match[1].toLowerCase()], percent: Number(match[2]) });
    }
    for (const match of text.matchAll(shortSpeedPattern)) {
      speedScores.push({ score: SPEED_DIFFICULTY_ORDER[`${match[1]}x`], percent: Number(match[2]) });
    }

    const weightedScore = (entries, maximum) => {
      const usable = entries.filter(entry => Number.isFinite(entry.score) && Number.isFinite(entry.percent) && entry.percent > 0);
      const totalPercent = usable.reduce((sum, entry) => sum + entry.percent, 0);
      return totalPercent ? usable.reduce((sum, entry) => sum + entry.score * entry.percent, 0) / totalPercent / maximum : null;
    };
    const mirrorSwitches = Number(text.match(/\bMirror\s*\((\d+)\)/i)?.[1] || 0);
    const dualPercent = Number(text.match(/\bDual\s+(\d+(?:\.\d+)?)%/i)?.[1] || text.match(/\bD(\d+(?:\.\d+)?)/i)?.[1] || 0);
    const inversePercent = Number(text.match(/\bInverse\s+(\d+(?:\.\d+)?)%/i)?.[1] || text.match(/\bIM(\d+(?:\.\d+)?)/i)?.[1] || 0);
    const signals = [
      [weightedScore(modeScores, 8), 0.4],
      [weightedScore(speedScores, 5), 0.25],
      [dualPercent > 0 ? Math.min(dualPercent / 100, 1) : null, 0.15],
      [inversePercent > 0 ? Math.min(inversePercent / 100, 1) : null, 0.1],
      [mirrorSwitches > 0 ? Math.min(Math.log1p(mirrorSwitches) / Math.log1p(12), 1) : null, 0.1],
    ].filter(([score]) => score !== null);
    const totalWeight = signals.reduce((sum, [, weight]) => sum + weight, 0);
    return totalWeight
      ? signals.reduce((sum, [score, weight]) => sum + score * weight, 0) / totalWeight
      : null;
  }

  function getMetricValue(level, field) {
    if (field === "length") return parseVictorTime(level?.[field]);
    if (field === "ratio") return getRatioDifficultyScore(level?.ratio);
    const value = Number(field === "iaPerSecond"
      ? level?.iaPerSecond ?? level?.inputActivityPerSecond
      : level?.[field]);
    return Number.isFinite(value) ? value : null;
  }

  function getUsableVictors(level) {
    return (Array.isArray(level?.victors) ? level.victors : [])
      .map(victor => ({
        name: normalizeName(victor?.name),
        seconds: parseVictorTime(victor?.seconds ?? victor?.time),
        attempts: Number(victor?.attempts),
      }))
      .filter(victor => victor.name && (victor.seconds || (Number.isFinite(victor.attempts) && victor.attempts > 0)));
  }

  function getVictorCount(level) {
    const reportedCount = Number(
      level?.recordedClearCount
      ?? level?.clearCount
      ?? level?.completionCount
      ?? level?.victorCount,
    );
    if (Number.isFinite(reportedCount) && reportedCount > 0) return reportedCount;
    if (Array.isArray(level?.victors)) {
      const count = getUsableVictors(level).length;
      return count > 0 ? count : null;
    }
    return null;
  }

  function getSourceConfidence(level) {
    const value = level?.sourceConfidence;
    if (value === null || value === undefined || String(value).trim() === "") return 1;
    const confidence = Number(value);
    return Number.isFinite(confidence) ? clamp(confidence, 0, 1) : 1;
  }

  function getMedian(values) {
    if (!values.length) return null;
    const sorted = [...values].sort((left, right) => left - right);
    const middle = Math.floor(sorted.length / 2);
    return sorted.length % 2
      ? sorted[middle]
      : (sorted[middle - 1] + sorted[middle]) / 2;
  }

  function getLevelIdentityKey(level, fallbackIndex = "") {
    const id = String(level?.id || level?.levelId || "").trim();
    if (id) return `id:${id}`;
    const name = getLevelName(level);
    return name ? `name:${name}` : `index:${fallbackIndex}`;
  }

  function fitVictorTimeNormalization(levels) {
    const observations = [];
    levels.forEach(level => {
      const length = getMetricValue(level, "length");
      const tps = getMetricValue(level, "tps");
      if (!Number.isFinite(length) || length <= 0 || !Number.isFinite(tps) || tps <= 0) return;
      const timeValues = getVictorLogValues(level, "time");
      if (!timeValues.size) return;
      observations.push({
        logLength: Math.log(length),
        logTps: Math.log(tps),
        logTimePerLength: getMedian([...timeValues.values()]),
      });
    });

    const normalization = {
      meanLogLength: 0,
      meanLogTps: 0,
      lengthAdjustment: 0,
      tpsExponent: 0,
    };
    if (observations.length < MODEL.minFeatureSamples) return normalization;

    const total = observations.length;
    normalization.meanLogLength = observations.reduce((sum, point) => sum + point.logLength, 0) / total;
    normalization.meanLogTps = observations.reduce((sum, point) => sum + point.logTps, 0) / total;
    const meanTimePerLength = observations.reduce((sum, point) => sum + point.logTimePerLength, 0) / total;
    let lengthVariance = 0;
    let tpsVariance = 0;
    let crossCovariance = 0;
    let lengthTimeCovariance = 0;
    let tpsTimeCovariance = 0;
    observations.forEach(point => {
      const lengthDelta = point.logLength - normalization.meanLogLength;
      const tpsDelta = point.logTps - normalization.meanLogTps;
      const timeDelta = point.logTimePerLength - meanTimePerLength;
      lengthVariance += lengthDelta ** 2;
      tpsVariance += tpsDelta ** 2;
      crossCovariance += lengthDelta * tpsDelta;
      lengthTimeCovariance += lengthDelta * timeDelta;
      tpsTimeCovariance += tpsDelta * timeDelta;
    });

    const ridge = MODEL.timeNormalizationRidge * Math.max(lengthVariance, tpsVariance, 1);
    const regularizedLengthVariance = lengthVariance + ridge;
    const regularizedTpsVariance = tpsVariance + ridge;
    const determinant = regularizedLengthVariance * regularizedTpsVariance - crossCovariance ** 2;
    if (!Number.isFinite(determinant) || determinant <= 0) return normalization;

    normalization.lengthAdjustment = clamp(
      (
        lengthTimeCovariance * regularizedTpsVariance
        - tpsTimeCovariance * crossCovariance
      ) / determinant,
      -1,
      1,
    );
    normalization.tpsExponent = clamp(
      (
        tpsTimeCovariance * regularizedLengthVariance
        - lengthTimeCovariance * crossCovariance
      ) / determinant,
      0,
      1.5,
    );
    normalization.lengthAdjustment *= MODEL.timeNormalizationStrength;
    normalization.tpsExponent *= MODEL.timeNormalizationStrength;
    return normalization;
  }

  function buildVictorFactorModel(levels, field, timeNormalization = null) {
    const calibrationLevelsByKey = new Map();
    const observationsByLevel = new Map();
    levels.forEach((level, levelIndex) => {
      calibrationLevelsByKey.set(getLevelIdentityKey(level, levelIndex), level);
      const playerValues = getVictorLogValues(level, field, timeNormalization);
      if (playerValues.size) observationsByLevel.set(levelIndex, playerValues);
    });

    const informativeLevels = new Map(
      [...observationsByLevel].filter(([, playerValues]) => playerValues.size >= 2),
    );
    const observationsByPlayer = new Map();
    informativeLevels.forEach((playerValues, levelIndex) => {
      playerValues.forEach((value, player) => {
        if (!observationsByPlayer.has(player)) observationsByPlayer.set(player, []);
        observationsByPlayer.get(player).push({ levelIndex, value });
      });
    });

    const levelEffects = new Map();
    informativeLevels.forEach((playerValues, levelIndex) => {
      levelEffects.set(levelIndex, getMedian([...playerValues.values()]));
    });
    const playerEffects = new Map([...observationsByPlayer.keys()].map(player => [player, 0]));
    const playerReliabilities = new Map([...observationsByPlayer.keys()].map(player => [player, 0]));

    for (let iteration = 0; iteration < MODEL.factorIterations; iteration++) {
      let maxChange = 0;
      informativeLevels.forEach((playerValues, levelIndex) => {
        let reliableWeight = 0;
        let effectSum = 0;
        playerValues.forEach((value, player) => {
          const reliability = playerReliabilities.get(player) || 0;
          reliableWeight += reliability;
          effectSum += reliability * (value - playerEffects.get(player));
        });
        const effect = reliableWeight
          ? effectSum / reliableWeight
          : getMedian([...playerValues.values()]);
        maxChange = Math.max(maxChange, Math.abs(effect - levelEffects.get(levelIndex)));
        levelEffects.set(levelIndex, effect);
      });

      const playerResiduals = new Map();
      observationsByPlayer.forEach((rows, player) => {
        const residuals = rows.map(row => row.value - levelEffects.get(row.levelIndex));
        const effect = residuals.reduce((sum, residual) => sum + residual, 0) / residuals.length;
        const variance = residuals.reduce((sum, residual) => sum + (residual - effect) ** 2, 0)
          / residuals.length;
        playerResiduals.set(player, { effect, variance, count: residuals.length });
      });

      const playerMeans = [...playerResiduals.values()].map(player => player.effect);
      const populationMean = playerMeans.reduce((sum, effect) => sum + effect, 0) / playerMeans.length;
      const populationVariance = playerMeans.reduce(
        (sum, effect) => sum + (effect - populationMean) ** 2,
        0,
      ) / playerMeans.length;
      const averageSamplingVariance = [...playerResiduals.values()].reduce(
        (sum, player) => sum + player.variance / player.count,
        0,
      ) / playerResiduals.size;
      const betweenPlayerVariance = Math.max(0, populationVariance - averageSamplingVariance);

      playerResiduals.forEach((player, name) => {
        const repeatConsistency = player.count > 1 ? (player.count - 1) / player.count : 0;
        const samplingVariance = player.variance / player.count;
        const reliability = betweenPlayerVariance + samplingVariance > 0
          ? repeatConsistency * betweenPlayerVariance / (betweenPlayerVariance + samplingVariance)
          : 0;
        const effect = player.effect * reliability;
        maxChange = Math.max(
          maxChange,
          Math.abs(effect - playerEffects.get(name)),
          Math.abs(reliability - playerReliabilities.get(name)),
        );
        playerEffects.set(name, effect);
        playerReliabilities.set(name, reliability);
      });

      const playerOffset = playerEffects.size
        ? [...playerEffects.values()].reduce((sum, effect) => sum + effect, 0) / playerEffects.size
        : 0;
      if (playerOffset) {
        playerEffects.forEach((effect, player) => playerEffects.set(player, effect - playerOffset));
        levelEffects.forEach((effect, levelIndex) => levelEffects.set(levelIndex, effect + playerOffset));
      }
      if (maxChange < MODEL.factorTolerance) break;
    }

    const calibratedLevels = new Map();
    observationsByLevel.forEach((playerValues, levelIndex) => {
      let reliableWeight = 0;
      let reliableConsensus = 0;
      playerValues.forEach((value, player) => {
        const reliability = playerReliabilities.get(player) || 0;
        if (!reliability) return;
        reliableWeight += reliability;
        reliableConsensus += reliability * (value - playerEffects.get(player));
      });
      if (!reliableWeight) {
        calibratedLevels.set(getLevelIdentityKey(levels[levelIndex], levelIndex), null);
        return;
      }
      reliableConsensus /= reliableWeight;
      const shrunkConsensus = [...playerValues].reduce((sum, [player, value]) => {
        const reliability = playerReliabilities.get(player) || 0;
        const adjusted = value - playerEffects.get(player);
        return sum + reliability * adjusted + (1 - reliability) * reliableConsensus;
      }, 0) / playerValues.size;
      calibratedLevels.set(
        getLevelIdentityKey(levels[levelIndex], levelIndex),
        Math.exp(shrunkConsensus),
      );
    });
    return {
      playerEffects,
      playerReliabilities,
      calibratedLevels,
      calibrationLevelsByKey,
      timeNormalization,
    };
  }

  function getCachedFeatureVector(level, victorFactorModels) {
    let vectorsByLevel = featureVectorCache.get(victorFactorModels);
    if (!vectorsByLevel) {
      vectorsByLevel = new WeakMap();
      featureVectorCache.set(victorFactorModels, vectorsByLevel);
    }
    let vector = vectorsByLevel.get(level);
    if (!vector) {
      vector = getFeatureVector(level, victorFactorModels);
      vectorsByLevel.set(level, vector);
    }
    return vector;
  }

  function buildVictorFactorModels(levels) {
    const timeNormalization = fitVictorTimeNormalization(levels);
    return {
      time: buildVictorFactorModel(levels, "time", timeNormalization),
      attempts: buildVictorFactorModel(levels, "attempts"),
    };
  }

  function getVictorFactorEstimate(level, field, factorModel) {
    const identityKey = getLevelIdentityKey(level);
    if (factorModel.calibrationLevelsByKey.get(identityKey) === level) {
      return factorModel.calibratedLevels.get(identityKey) ?? null;
    }
    const playerValues = getVictorLogValues(level, field, factorModel.timeNormalization);
    let reliableWeight = 0;
    let reliableConsensus = 0;
    playerValues.forEach((value, player) => {
      const reliability = factorModel.playerReliabilities.get(player) || 0;
      if (!reliability) return;
      reliableWeight += reliability;
      reliableConsensus += reliability * (value - factorModel.playerEffects.get(player));
    });
    if (!reliableWeight) return null;
    reliableConsensus /= reliableWeight;
    const shrunkConsensus = [...playerValues].reduce((sum, [player, value]) => {
      const reliability = factorModel.playerReliabilities.get(player) || 0;
      const adjusted = value - (factorModel.playerEffects.get(player) || 0);
      return sum + reliability * adjusted + (1 - reliability) * reliableConsensus;
    }, 0) / playerValues.size;
    return Math.exp(shrunkConsensus);
  }

  function getVictorEvidence(level, victorFactorModels) {
    return {
      time: getVictorFactorEstimate(level, "time", victorFactorModels.time),
      attempts: getVictorFactorEstimate(level, "attempts", victorFactorModels.attempts),
    };
  }

  function positiveOrNull(value) {
    return Number.isFinite(value) && value > 0 ? value : null;
  }

  function getFeatureVector(level, victorFactorModels) {
    const evidence = getVictorEvidence(level, victorFactorModels);
    const victorCount = getVictorCount(level);
    return {
      tps: positiveOrNull(getMetricValue(level, "tps")),
      length: positiveOrNull(getMetricValue(level, "length")),
      levelVolume: positiveOrNull(
        getMetricValue(level, "tps") * getMetricValue(level, "length"),
      ),
      precision: positiveOrNull(getMetricValue(level, "precision")),
      iaPerSecond: positiveOrNull(getMetricValue(level, "iaPerSecond")),
      ratio: positiveOrNull(getMetricValue(level, "ratio")),
      victorCount: victorCount === null ? null : Math.log1p(victorCount),
      victorTime: positiveOrNull(evidence?.time),
      victorAttempts: positiveOrNull(evidence?.attempts),
    };
  }

  function isSameLevel(target, candidate) {
    const targetId = String(target?.id || target?.levelId || "").trim();
    const candidateId = String(candidate?.id || candidate?.levelId || "").trim();
    if (targetId && candidateId) return targetId === candidateId;
    const targetName = getLevelName(target);
    const candidateName = getLevelName(candidate);
    return Boolean(targetName && candidateName && targetName === candidateName);
  }

  function readExplicitRange(level) {
    const range = level.rankRange || level.estimatedRankRange;
    const min = Number(range?.min ?? level.estimatedRankMin);
    const max = Number(range?.max ?? level.estimatedRankMax);
    if (!Number.isFinite(min) || !Number.isFinite(max) || min <= 0 || max <= 0) return null;
    return { min: Math.min(min, max), max: Math.max(min, max) };
  }

  function buildEstimatedRankMap(estimatedNames, calibrationRankCount) {
    const ranks = new Map();
    const names = Array.isArray(estimatedNames) ? estimatedNames : [];
    names.forEach((name, index) => {
      const key = normalizeName(name);
      if (!key || ranks.has(key)) return;
      const estimatedRank = index + 1;
      const normalizedPosition = names.length > 1
        ? (estimatedRank - 1) / (names.length - 1)
        : 0;
      ranks.set(key, 1 + normalizedPosition * Math.max(0, calibrationRankCount - 1));
    });
    return ranks;
  }

  function collectRankedCandidates(level, calibrationLevels, estimatedRanks) {
    const targetTier = getLevelTier(level);
    const checksTwoPlayer = level.is2Player !== undefined;
    return calibrationLevels
      .filter(candidate => !isSameLevel(level, candidate))
      .map(candidate => {
        const candidateRank = Number(candidate?.modelRank || candidate?._difficultyRank || candidate?.rank);
        const rank = Number.isFinite(candidateRank) && candidateRank > 0
          ? candidateRank
          : estimatedRanks.get(getLevelName(candidate));
        const tier = getLevelTier(candidate);
        let weight = 1;
        if (targetTier && tier !== targetTier) weight *= ESTIMATED_RANK_PENALTIES.tierMismatch;
        if (checksTwoPlayer && Boolean(level.is2Player) !== Boolean(candidate?.is2Player)) {
          weight *= ESTIMATED_RANK_PENALTIES.twoPlayerMismatch;
        }
        weight *= getSourceConfidence(candidate);
        return { candidate, rank, tier, weight };
      })
      .filter(entry => Number.isFinite(entry.rank) && entry.rank > 0 && entry.weight > 0);
  }

  function getRankSpan(entries) {
    const ranks = entries.map(entry => entry.rank);
    return { min: Math.min(...ranks), max: Math.max(...ranks) };
  }

  function selectRegressionPool(ranked, sameTier, bounds, explicit, preferTier = false) {
    if (explicit) {
      const inRange = ranked.filter(entry => entry.rank >= bounds.min && entry.rank <= bounds.max);
      if (inRange.length >= MODEL.minTierPool) return { entries: inRange, scope: "range" };
    }
    if (preferTier && sameTier.length >= MODEL.minTierPool) {
      return { entries: sameTier, scope: "tier" };
    }
    return { entries: ranked, scope: "all" };
  }

  function predictLocalLinear(points, targetX, bandwidth, skipIndex = -1) {
    let sumWeight = 0;
    let sumX = 0;
    let sumY = 0;
    let sumXX = 0;
    let sumXY = 0;
    for (let index = 0; index < points.length; index++) {
      const point = points[index];
      if (index === skipIndex) continue;
      const z = (point.x - targetX) / bandwidth;
      const weight = point.weight * (Math.exp(-0.5 * z * z) + MODEL.kernelFloor);
      sumWeight += weight;
      sumX += weight * point.x;
      sumY += weight * point.y;
      sumXX += weight * point.x * point.x;
      sumXY += weight * point.x * point.y;
    }
    if (!(sumWeight > 0)) return null;

    const meanX = sumX / sumWeight;
    const meanY = sumY / sumWeight;
    const sxx = sumXX - sumWeight * meanX * meanX;
    const sxy = sumXY - sumWeight * meanX * meanY;
    const slope = sxy / (sxx + MODEL.ridge * sumWeight);
    return meanY + slope * (targetX - meanX);
  }

  function selectFeatureBandwidth(points) {
    if (points.length < MODEL.minFeatureSamples) return null;
    let best = null;
    MODEL.bandwidths.forEach(bandwidth => {
      let errorSum = 0;
      let weightSum = 0;
      const validationCount = Math.min(points.length, MODEL.maxValidationSamples);
      const validationStep = points.length / validationCount;
      for (let sample = 0; sample < validationCount; sample++) {
        const index = Math.floor(sample * validationStep);
        const point = points[index];
        const predicted = predictLocalLinear(points, point.x, bandwidth, index);
        if (predicted === null) continue;
        errorSum += point.weight * (clamp(predicted, 10, 360) - point.y) ** 2;
        weightSum += point.weight;
      }
      if (!weightSum) return;
      const mse = errorSum / weightSum;
      if (!best || mse < best.mse) best = { bandwidth, mse };
    });
    return best
      ? { bandwidth: best.bandwidth, variance: Math.max(MODEL.minVariance, best.mse) }
      : null;
  }

  function getWeightedPointsVariance(entries) {
    let totalWeight = 0;
    let pointsSum = 0;
    entries.forEach(entry => {
      totalWeight += entry.weight;
      pointsSum += entry.weight * entry.points;
    });
    const mean = pointsSum / totalWeight;
    let squares = 0;
    entries.forEach(entry => {
      squares += entry.weight * (entry.points - mean) ** 2;
    });
    return squares / totalWeight;
  }

  function getPredictionCacheKey(pool, victorFactorModels) {
    let factorModelId = victorFactorModelIds.get(victorFactorModels);
    if (!factorModelId) {
      factorModelId = nextVictorFactorModelId++;
      victorFactorModelIds.set(victorFactorModels, factorModelId);
    }
    const entries = pool.entries.map(entry => {
      const identity = String(entry.candidate?.id || entry.candidate?.levelId || getLevelName(entry.candidate));
      return `${identity}:${entry.rank}:${entry.weight}`;
    });
    return `${factorModelId}|${pool.scope}|${entries.join(";")}`;
  }

  function getVictorLogValues(level, field, timeNormalization = null) {
    const victors = Array.isArray(level?.victors) ? level.victors : [];
    const rawLength = getMetricValue(level, "length");
    const rawTps = getMetricValue(level, "tps");
    const levelLength = Number.isFinite(rawLength) && rawLength > 0 ? rawLength : null;
    const levelTps = Number.isFinite(rawTps) && rawTps > 0 ? rawTps : null;
    let cached = level && typeof level === "object" ? victorLogValueCache.get(level) : null;
    if (!cached
        || cached.victors !== victors
        || cached.length !== levelLength
        || cached.tps !== levelTps) {
      cached = {
        victors,
        length: levelLength,
        tps: levelTps,
        values: new Map(),
        normalizedTime: new WeakMap(),
      };
      if (level && typeof level === "object") victorLogValueCache.set(level, cached);
    }

    let valuesByPlayer = cached.values.get(field);
    if (!valuesByPlayer) {
      valuesByPlayer = new Map();
      victors.forEach(victor => {
        const player = normalizeName(victor?.name);
        const timeSeconds = field === "time"
          ? parseVictorTime(victor?.seconds ?? victor?.time)
          : null;
        const value = field === "time"
          ? (Number.isFinite(timeSeconds) && levelLength !== null
            ? timeSeconds / levelLength
            : null)
          : Number(victor?.attempts);
        if (!player || !Number.isFinite(value) || value <= 0) return;
        if (!valuesByPlayer.has(player)) valuesByPlayer.set(player, []);
        valuesByPlayer.get(player).push(Math.log(value));
      });
      valuesByPlayer.forEach((values, player) => {
        valuesByPlayer.set(player, values.reduce((sum, value) => sum + value, 0) / values.length);
      });
      cached.values.set(field, valuesByPlayer);
    }

    if (field !== "time" || !timeNormalization) return valuesByPlayer;
    const normalizedValues = cached.normalizedTime.get(timeNormalization);
    if (normalizedValues) return normalizedValues;

    const lengthOffset = levelLength !== null
      ? timeNormalization.lengthAdjustment * (Math.log(levelLength) - timeNormalization.meanLogLength)
      : 0;
    const tpsOffset = levelTps !== null
      ? timeNormalization.tpsExponent * (Math.log(levelTps) - timeNormalization.meanLogTps)
      : 0;
    const adjustedValues = new Map([...valuesByPlayer].map(([player, value]) => [
      player,
      value - lengthOffset - tpsOffset,
    ]));
    cached.normalizedTime.set(timeNormalization, adjustedValues);
    return adjustedValues;
  }

  function getSharedVictorLogRatio(left, right, playerReliabilities) {
    let difference = 0;
    const sharedPlayers = [];
    left.forEach((leftValue, player) => {
      const rightValue = right.get(player);
      const reliability = playerReliabilities.get(player) || 0;
      if (!Number.isFinite(rightValue) || !reliability) return;
      difference += reliability * (leftValue - rightValue);
      sharedPlayers.push(player);
    });
    const sharedWeight = sharedPlayers.reduce(
      (sum, player) => sum + playerReliabilities.get(player),
      0,
    );
    return sharedPlayers.length
      ? {
        difference: difference / sharedWeight,
        sharedCount: sharedPlayers.length,
        sharedWeight,
        sharedPlayers,
      }
      : null;
  }

  function selectHeadToHeadBandwidth(points) {
    if (points.length < MODEL.minFeatureSamples) return null;
    let best = null;
    MODEL.bandwidths.forEach(bandwidth => {
      let errorSum = 0;
      let weightSum = 0;
      const validationCount = Math.min(points.length, MODEL.maxValidationSamples);
      const validationStep = points.length / validationCount;
      for (let sample = 0; sample < validationCount; sample++) {
        const index = Math.floor(sample * validationStep);
        const point = points[index];
        const predicted = predictLocalLinear(points, point.x, bandwidth, index);
        if (predicted === null) continue;
        errorSum += point.weight * (clamp(predicted, -350, 350) - point.y) ** 2;
        weightSum += point.weight;
      }
      if (!weightSum) return;
      const mse = errorSum / weightSum;
      if (!best || mse < best.mse) best = { bandwidth, mse };
    });
    return best
      ? { bandwidth: best.bandwidth, variance: Math.max(MODEL.minVariance, best.mse) }
      : null;
  }

  function aggregateHeadToHeadPoints(points) {
    const bins = new Map();
    const binWidth = 0.01;
    points.forEach(point => {
      const key = Math.round(point.x / binWidth);
      let bin = bins.get(key);
      if (!bin) {
        bin = { weight: 0, x: 0, y: 0 };
        bins.set(key, bin);
      }
      bin.weight += point.weight;
      bin.x += point.weight * point.x;
      bin.y += point.weight * point.y;
    });
    return [...bins.values()].map(bin => ({
      x: bin.x / bin.weight,
      y: bin.y / bin.weight,
      weight: bin.weight,
    }));
  }

  function buildHeadToHeadModels(pool, victorFactorModels) {
    const fields = ["time", "attempts"];
    return fields.map(field => {
      const comparisonsByPair = new Map();
      const observationsByPlayer = new Map();
      const factorModel = victorFactorModels[field];
      const playerReliabilities = factorModel.playerReliabilities;
      pool.entries.forEach((entry, index) => {
        getVictorLogValues(entry.candidate, field, factorModel.timeNormalization).forEach((value, player) => {
          if (!(playerReliabilities.get(player) > 0)) return;
          if (!observationsByPlayer.has(player)) observationsByPlayer.set(player, []);
          observationsByPlayer.get(player).push({
            index,
            value,
            reliability: playerReliabilities.get(player),
          });
        });
      });
      observationsByPlayer.forEach(observations => {
        for (let left = 0; left < observations.length; left++) {
          for (let right = left + 1; right < observations.length; right++) {
            const leftObservation = observations[left];
            const rightObservation = observations[right];
            const pairKey = `${leftObservation.index}:${rightObservation.index}`;
            if (!comparisonsByPair.has(pairKey)) {
              comparisonsByPair.set(pairKey, {
                leftIndex: leftObservation.index,
                rightIndex: rightObservation.index,
                difference: 0,
                sharedCount: 0,
                sharedWeight: 0,
              });
            }
            const comparison = comparisonsByPair.get(pairKey);
            comparison.difference += leftObservation.reliability
              * (leftObservation.value - rightObservation.value);
            comparison.sharedCount++;
            comparison.sharedWeight += leftObservation.reliability;
          }
        }
      });
      const comparisons = [...comparisonsByPair.values()].map(comparison => {
        const leftEntry = pool.entries[comparison.leftIndex];
        const rightEntry = pool.entries[comparison.rightIndex];
        return {
          x: comparison.difference / comparison.sharedWeight,
          y: leftEntry.points - rightEntry.points,
          weight: Math.sqrt(leftEntry.weight * rightEntry.weight) * comparison.sharedWeight,
        };
      });
      const predictionPoints = aggregateHeadToHeadPoints(comparisons);
      const calibration = selectHeadToHeadBandwidth(comparisons);
      return {
        field,
        playerReliabilities,
        timeNormalization: factorModel.timeNormalization,
        comparisons: comparisons.length,
        points: predictionPoints,
        bandwidth: calibration?.bandwidth ?? null,
        variance: calibration?.variance ?? null,
      };
    });
  }

  function predictHeadToHead(level, pool, models) {
    const estimates = [];
    const metrics = [];
    const candidateIndexes = new Set();
    const sharedPlayers = new Set();
    let comparisonCount = 0;
    models.forEach(model => {
      if (model.bandwidth === null) return;
      const targetValues = getVictorLogValues(level, model.field, model.timeNormalization);
      pool.entries.forEach((entry, index) => {
        const candidateValues = getVictorLogValues(entry.candidate, model.field, model.timeNormalization);
        const shared = getSharedVictorLogRatio(
          targetValues,
          candidateValues,
          model.playerReliabilities,
        );
        if (!shared) return;
        const pointsDifference = predictLocalLinear(model.points, shared.difference, model.bandwidth);
        if (!Number.isFinite(pointsDifference)) return;
        estimates.push({
          points: clamp(entry.points + pointsDifference, 10, 360),
          weight: entry.weight * shared.sharedWeight,
          variance: model.variance,
        });
        comparisonCount += shared.sharedCount;
        candidateIndexes.add(index);
        shared.sharedPlayers.forEach(player => sharedPlayers.add(player));
        if (!metrics.includes(model.field)) metrics.push(model.field);
      });
    });
    if (!estimates.length) return null;

    const totalWeight = estimates.reduce((sum, estimate) => sum + estimate.weight, 0);
    const points = estimates.reduce((sum, estimate) => sum + estimate.weight * estimate.points, 0) / totalWeight;
    const residualVariance = estimates.reduce(
      (sum, estimate) => sum + estimate.weight * estimate.variance,
      0,
    ) / totalWeight;
    const estimateVariance = estimates.reduce(
      (sum, estimate) => sum + estimate.weight * (estimate.points - points) ** 2,
      0,
    ) / totalWeight;
    const effectiveComparisons = Math.max(
      1,
      Math.min(candidateIndexes.size, sharedPlayers.size),
    );
    const variance = (residualVariance + estimateVariance) / effectiveComparisons;
    return {
      points,
      pointsSpread: Math.sqrt(Math.max(MODEL.minVariance, variance)),
      comparisons: comparisonCount,
      candidates: candidateIndexes.size,
      sharedPlayers: sharedPlayers.size,
      metrics,
    };
  }

  function combinePredictions(featurePrediction, headToHead, maxRank) {
    if (!headToHead) return featurePrediction;
    const hasFeaturePrediction = Number.isFinite(featurePrediction.points);
    const featureVariance = Math.max(MODEL.minVariance, (featurePrediction.pointsSpread || 0) ** 2);
    const headToHeadVariance = Math.max(MODEL.minVariance, headToHead.pointsSpread ** 2);
    let points = headToHead.points;
    let pointsSpread = headToHead.pointsSpread;

    if (hasFeaturePrediction) {
      const featurePrecision = 1 / featureVariance;
      const headToHeadPrecision = 1 / headToHeadVariance;
      const totalPrecision = featurePrecision + headToHeadPrecision;
      points = (
        featurePrediction.points * featurePrecision + headToHead.points * headToHeadPrecision
      ) / totalPrecision;
      const disagreementVariance = featurePrecision * headToHeadPrecision
        / (totalPrecision * totalPrecision)
        * (featurePrediction.points - headToHead.points) ** 2;
      pointsSpread = Math.sqrt(1 / totalPrecision + disagreementVariance);
    }

    const boundedPoints = clamp(points, 10, 360);
    const rankSpread = (
      pointsToRank(boundedPoints - pointsSpread, maxRank)
      - pointsToRank(boundedPoints + pointsSpread, maxRank)
    ) / 2;
    return {
      ...featurePrediction,
      points: boundedPoints,
      pointsSpread,
      spread: rankSpread,
      headToHead: {
        comparisons: headToHead.comparisons,
        candidates: headToHead.candidates,
        sharedPlayers: headToHead.sharedPlayers,
        metrics: headToHead.metrics,
      },
    };
  }

  function getPredictionModel(level, pool, victorFactorModels, poolCache, maxRank) {
    const targetVector = getFeatureVector(level, victorFactorModels);
    const availableFields = FEATURE_FIELDS.filter(field => targetVector[field] !== null);
    const poolKey = getPredictionCacheKey(pool, victorFactorModels);
    let poolModel = poolCache.get(poolKey);
    if (!poolModel) {
      const poolPoints = pool.entries.map(entry => entry.points);
      poolModel = {
        poolVectors: pool.entries.map(entry => getCachedFeatureVector(entry.candidate, victorFactorModels)),
        pointsMin: Math.min(...poolPoints),
        pointsMax: Math.max(...poolPoints),
        pointsVariance: Math.max(getWeightedPointsVariance(pool.entries), MODEL.minVariance),
        features: new Map(),
        composites: new Map(),
        headToHead: null,
      };
      poolCache.set(poolKey, poolModel);
      if (poolCache.size > 64) poolCache.delete(poolCache.keys().next().value);
    }

    availableFields.forEach(field => {
      if (poolModel.features.has(field)) return;
      const sampleIndexes = poolModel.poolVectors
        .map((vector, index) => (vector[field] === null ? -1 : index))
        .filter(index => index >= 0);
      if (sampleIndexes.length < MODEL.minFeatureSamples) {
        poolModel.features.set(field, null);
        return;
      }
      const sortedValues = sampleIndexes.map(index => poolModel.poolVectors[index][field]).sort((a, b) => a - b);
      const points = sampleIndexes.map(index => ({
        x: getFeaturePosition(poolModel.poolVectors[index][field], { field, sortedValues }),
        y: pool.entries[index].points,
        weight: pool.entries[index].weight,
      }));
      const fit = selectFeatureBandwidth(points);
      if (!fit) {
        poolModel.features.set(field, null);
        return;
      }
      const skill = clamp(1 - fit.variance / poolModel.pointsVariance, MODEL.minSkill, 1);
      poolModel.features.set(field, {
        field,
        sortedValues,
        weight: ESTIMATED_RANK_METRIC_WEIGHTS[field] * skill,
      });
    });

    const activeFeatures = availableFields
      .map(field => poolModel.features.get(field))
      .filter(Boolean);
    const missing = FEATURE_FIELDS.filter(field => !activeFeatures.some(feature => feature.field === field));
    if (!activeFeatures.length) {
      return {
        targetVector,
        model: {
          maxRank,
          pointsMin: poolModel.pointsMin,
          pointsMax: poolModel.pointsMax,
          missing,
          used: [],
          features: [],
          bandwidth: null,
          headToHead: poolModel.headToHead,
        },
        poolModel,
      };
    }

    const compositeKey = activeFeatures.map(feature => feature.field).join(",");
    let composite = poolModel.composites.get(compositeKey);
    if (!composite) {
      const completeFeatureIndexes = poolModel.poolVectors
        .map((vector, index) => (
          activeFeatures.every(feature => vector[feature.field] !== null) ? index : -1
        ))
        .filter(index => index >= 0);
      const calibrationIndexes = completeFeatureIndexes.length >= MODEL.minFeatureSamples
        ? completeFeatureIndexes
        : pool.entries.map((_, index) => index);
      const getComposite = vector => {
        let totalWeight = 0;
        let weighted = 0;
        activeFeatures.forEach(feature => {
          const value = vector[feature.field];
          if (value === null) return;
          totalWeight += feature.weight;
          weighted += feature.weight * getFeaturePosition(value, feature);
        });
        return totalWeight ? weighted / totalWeight : null;
      };
      const compositePoints = calibrationIndexes
        .map(index => ({
          x: getComposite(poolModel.poolVectors[index]),
          y: pool.entries[index].points,
          weight: pool.entries[index].weight,
        }))
        .filter(point => point.x !== null);
      const calibration = selectFeatureBandwidth(compositePoints);
      composite = {
        compositePoints,
        bandwidth: calibration?.bandwidth ?? null,
        variance: calibration?.variance ?? null,
      };
      poolModel.composites.set(compositeKey, composite);
    }
    const model = {
      maxRank,
      pointsMin: poolModel.pointsMin,
      pointsMax: poolModel.pointsMax,
      missing,
      used: activeFeatures.map(feature => feature.field),
      features: activeFeatures,
      compositePoints: composite.compositePoints,
      bandwidth: composite.bandwidth,
      variance: composite.variance,
      headToHead: poolModel.headToHead,
    };
    return { model, targetVector, poolModel };
  }

  function predictFromFeatures(level, pool, victorFactorModels, calibrationLevels, maxRank) {
    let cache = predictionModelCache.get(calibrationLevels);
    if (!cache) {
      cache = new Map();
      predictionModelCache.set(calibrationLevels, cache);
    }
    const { model, targetVector, poolModel } = getPredictionModel(level, pool, victorFactorModels, cache, maxRank);
    const empty = { points: null, spread: null, used: model.used, missing: model.missing };
    const hasVictorEvidence = getVictorLogValues(level, "time", victorFactorModels.time.timeNormalization).size
      || getVictorLogValues(level, "attempts").size;
    if (hasVictorEvidence && !poolModel.headToHead) {
      poolModel.headToHead = buildHeadToHeadModels(pool, victorFactorModels);
    }
    const headToHead = hasVictorEvidence
      ? predictHeadToHead(level, pool, poolModel.headToHead)
      : null;
    if (model.bandwidth === null) return combinePredictions(empty, headToHead, maxRank);

    let totalWeight = 0;
    let weightedPercentile = 0;
    model.features.forEach(feature => {
      const value = targetVector[feature.field];
      if (value === null) return;
      totalWeight += feature.weight;
      weightedPercentile += feature.weight * getFeaturePosition(value, feature);
    });
    if (!totalWeight) return combinePredictions(empty, headToHead, maxRank);
    const compositeTarget = weightedPercentile / totalWeight;
    const points = predictLocalLinear(model.compositePoints, compositeTarget, model.bandwidth);
    if (!Number.isFinite(points)) return combinePredictions(empty, headToHead, maxRank);
    const boundedPoints = clamp(points, 10, 360);
    const pointsSpread = Math.sqrt(model.variance);
    const rankSpread = (
      pointsToRank(boundedPoints - pointsSpread, maxRank)
      - pointsToRank(boundedPoints + pointsSpread, maxRank)
    ) / 2;
    return combinePredictions({
      points: boundedPoints,
      pointsSpread,
      spread: rankSpread,
      used: model.used,
      missing: model.missing,
    }, headToHead, maxRank);
  }

  function finalizeEstimate(min, max, rank, prior, explicit, spread, maxRank, constrainToBounds = false) {
    const shift = explicit ? 0 : MODEL.inferredRankShift;
    let value = rank - shift;
    if (Number.isFinite(prior)) {
      const shiftedPrior = Math.max(1, prior - shift);
      value = value * (1 - MODEL.priorBlend) + shiftedPrior * MODEL.priorBlend;
    }
    if (!explicit && constrainToBounds && (rank <= min || rank >= max)) {
      value = clamp(rank, min, max);
    }
    let lower = explicit ? min : Math.max(1, min - shift);
    let upper = explicit ? max : Math.max(lower, max - shift);
    if (explicit) value = clamp(value, lower, upper);
    let estimatedRank = Math.max(1, Math.round(value));
    if (constrainToBounds) estimatedRank = clamp(estimatedRank, min, max);
    if (constrainToBounds && !explicit && (!Number.isFinite(spread) || spread <= 0)) {
      lower = upper = estimatedRank;
    } else if (!explicit && Number.isFinite(spread) && spread > 0) {
      const halfWidth = spread * MODEL.rankIntervalScale;
      lower = clamp(Math.ceil(estimatedRank - halfWidth), 1, maxRank);
      upper = clamp(Math.floor(estimatedRank + halfWidth), 1, maxRank);
      if (constrainToBounds) {
        lower = Math.max(min, lower);
        upper = Math.min(max, upper);
      }
      if (lower > upper) lower = upper = estimatedRank;
    }
    return {
      min: lower,
      max: upper,
      estimatedRank,
      estimatedRankValue: constrainToBounds ? clamp(value, min, max) : value,
    };
  }

  function getEstimatedRankRange(level, calibrationLevels, estimatedNames = []) {
    if (!level || !Array.isArray(calibrationLevels) || !calibrationLevels.length) return null;

    const estimatedRanks = buildEstimatedRankMap(estimatedNames, calibrationLevels.length);
    const ranked = collectRankedCandidates(level, calibrationLevels, estimatedRanks);
    if (!ranked.length) return null;

    const explicit = readExplicitRange(level);
    const tier = getLevelTier(level);
    const sameTier = tier ? ranked.filter(entry => entry.tier === tier) : ranked;
    const bounds = explicit || getRankSpan(ranked);
    let tierPrior = null;
    if (sameTier.length) {
      const tierEntries = sameTier.map(entry => ({
        rank: entry.rank,
        weight: entry.weight,
      }));
      const totalWeight = tierEntries.reduce((sum, entry) => sum + entry.weight, 0);
      const tierMean = tierEntries.reduce((sum, entry) => sum + entry.rank * entry.weight, 0) / totalWeight;
      const tierVariance = tierEntries.reduce(
        (sum, entry) => sum + entry.weight * (entry.rank - tierMean) ** 2,
        0,
      ) / totalWeight;
      tierPrior = { mean: tierMean, variance: Math.max(MODEL.minVariance, tierVariance) };
    }
    ranked.forEach(entry => {
      entry.points = rankToPoints(entry.rank, calibrationLevels.length);
    });
    const pool = selectRegressionPool(ranked, sameTier, bounds, explicit);
    let victorFactorModels = victorFactorModelCache.get(calibrationLevels);
    if (!victorFactorModels) {
      victorFactorModels = buildVictorFactorModels(calibrationLevels);
      victorFactorModelCache.set(calibrationLevels, victorFactorModels);
    }
    const prediction = predictFromFeatures(level, pool, victorFactorModels, calibrationLevels, calibrationLevels.length);

    let rank = Number.isFinite(prediction.points)
      ? pointsToRank(prediction.points, calibrationLevels.length)
      : (tierPrior?.mean ?? (bounds.min + bounds.max) / 2);
    if (tierPrior && Number.isFinite(prediction.points)) {
      const predictionVariance = Math.max(
        MODEL.minVariance,
        Number.isFinite(prediction.spread) ? prediction.spread ** 2 : 0,
      );
      const predictionPrecision = 1 / predictionVariance;
      const tierPrecision = Math.min(
        1 / tierPrior.variance,
        predictionPrecision * MODEL.tierPriorMaxPrecisionRatio,
      );
      rank = (rank * predictionPrecision + tierPrior.mean * tierPrecision)
        / (predictionPrecision + tierPrecision);
    }
    const prior = estimatedRanks.get(getLevelName(level)) ?? null;
    const result = finalizeEstimate(
      bounds.min,
      bounds.max,
      rank,
      prior,
      explicit,
      prediction.spread,
      calibrationLevels.length,
      Boolean(explicit),
    );

    return {
      ...result,
      spread: prediction.spread,
      intervalCoverage: !explicit && Number.isFinite(prediction.spread)
        ? MODEL.rankIntervalCoverage
        : null,
      scope: pool.scope,
      headToHead: prediction.headToHead ?? {
        comparisons: 0,
        candidates: 0,
        sharedPlayers: 0,
        metrics: [],
      },
      basis: {
        used: prediction.used.map(field => FEATURE_LABELS[field]),
        missing: prediction.missing.map(field => FEATURE_LABELS[field]),
      },
    };
  }

  function summarizeRankBacktest(predictions) {
    if (!predictions.length) {
      return {
        count: 0,
        meanAbsoluteError: null,
        medianAbsoluteError: null,
        rootMeanSquaredError: null,
        within5Rate: null,
        within10Rate: null,
        intervalCoverage: null,
      };
    }

    const errors = predictions.map(prediction => prediction.absoluteError);
    const within5Count = errors.filter(error => error <= 5).length;
    const within10Count = errors.filter(error => error <= 10).length;
    const squaredError = errors.reduce((sum, error) => sum + error ** 2, 0);
    const intervalPredictions = predictions.filter(prediction => (
      Number.isFinite(prediction.rankRange?.min) && Number.isFinite(prediction.rankRange?.max)
    ));
    const coveredIntervals = intervalPredictions.filter(prediction => (
      prediction.actualRank >= prediction.rankRange.min
      && prediction.actualRank <= prediction.rankRange.max
    )).length;

    return {
      count: predictions.length,
      meanAbsoluteError: errors.reduce((sum, error) => sum + error, 0) / errors.length,
      medianAbsoluteError: getMedian(errors),
      rootMeanSquaredError: Math.sqrt(squaredError / errors.length),
      within5Rate: within5Count / errors.length,
      within10Rate: within10Count / errors.length,
      intervalCoverage: intervalPredictions.length
        ? coveredIntervals / intervalPredictions.length
        : null,
    };
  }

  async function backtestEstimatedRanks(levels, estimatedNames = []) {
    if (!Array.isArray(levels)) throw new TypeError("levels must be an array");
    if (!Array.isArray(estimatedNames)) throw new TypeError("estimatedNames must be an array");

    const backtestLevels = levels.map(level => ({ ...level }));
    const tierMarkers = [];
    const seenTiers = new Set();
    backtestLevels.forEach((level, index) => {
      const tier = String(level.tier || level.tierName || "").trim();
      if (tier && !seenTiers.has(tier.toLowerCase())) {
        seenTiers.add(tier.toLowerCase());
        tierMarkers.push({ index, tier });
      }
    });
    tierMarkers.forEach((marker, markerIndex) => {
      const end = markerIndex + 1 < tierMarkers.length
        ? tierMarkers[markerIndex + 1].index
        : backtestLevels.length;
      for (let index = marker.index; index < end; index += 1) {
        backtestLevels[index].tier = marker.tier;
      }
    });

    const rankedLevels = backtestLevels
      .map(level => ({ level, rank: Number(level?.rank) }))
      .filter(entry => Number.isFinite(entry.rank) && entry.rank > 0);
    const maximumActualRank = Math.max(...rankedLevels.map(entry => entry.rank), 1);
    const predictions = [];

    for (const { level, rank: actualRank } of rankedLevels) {
      const targetKey = getLevelName(level);
      const targetId = String(level?.id || level?.levelId || "").trim();
      if (!targetKey && !targetId) {
        await new Promise(resolve => setTimeout(resolve, 0));
        continue;
      }

      const heldOutLevel = {
        ...level,
        isUnverified: true,
        rank: undefined,
        modelRank: undefined,
        _difficultyRank: undefined,
        _tierPrimaryRank: undefined,
        _tierEstimatedRankRange: undefined,
        rankRange: undefined,
        estimatedRankRange: undefined,
        estimatedRankMin: undefined,
        estimatedRankMax: undefined,
      };
      const heldOutNames = estimatedNames.map(name => (
        normalizeName(name) === targetKey ? "" : name
      ));
      // Keep observed features available, but candidate collection excludes this target by identity.
      const estimate = getEstimatedRankRange(heldOutLevel, backtestLevels, heldOutNames);
      if (!estimate || !Number.isFinite(estimate.estimatedRankValue)) {
        await new Promise(resolve => setTimeout(resolve, 0));
        continue;
      }

      const scaleRank = value => {
        const percentile = backtestLevels.length > 1
          ? clamp((value - 1) / (backtestLevels.length - 1), 0, 1)
          : 0;
        return 1 + percentile * (maximumActualRank - 1);
      };
      const predictedRank = scaleRank(estimate.estimatedRankValue);
      const rankRange = {
        min: scaleRank(estimate.min),
        max: scaleRank(estimate.max),
      };
      const trainingLevels = backtestLevels.filter(candidate => !isSameLevel(level, candidate));
      const getValidRank = candidate => {
        const rank = Number(candidate?.rank);
        return Number.isFinite(rank) && rank > 0 ? rank : null;
      };
      const trainingRanks = trainingLevels.map(getValidRank).filter(rank => Number.isFinite(rank));
      const tierRanks = trainingLevels
        .filter(candidate => getLevelTier(candidate) === getLevelTier(level))
        .map(getValidRank)
        .filter(rank => Number.isFinite(rank));
      const baselineRanks = tierRanks.length ? tierRanks : trainingRanks;
      const tierMidpointRank = baselineRanks.length
        ? (Math.min(...baselineRanks) + Math.max(...baselineRanks)) / 2
        : null;
      predictions.push({
        name: String(level?.name || level?.levelName || ""),
        tier: getLevelTier(level) || "unknown",
        actualRank,
        predictedRank,
        absoluteError: Math.abs(predictedRank - actualRank),
        rankRange,
        tierMidpointRank,
        tierMidpointError: Number.isFinite(tierMidpointRank)
          ? Math.abs(tierMidpointRank - actualRank)
          : null,
      });
      await new Promise(resolve => setTimeout(resolve, 0));
    }

    const tiers = new Map();
    predictions.forEach(prediction => {
      if (!tiers.has(prediction.tier)) tiers.set(prediction.tier, []);
      tiers.get(prediction.tier).push(prediction);
    });

    return {
      totalLevels: levels.length,
      eligibleLevels: rankedLevels.length,
      evaluatedLevels: predictions.length,
      skippedLevels: rankedLevels.length - predictions.length,
      metrics: summarizeRankBacktest(predictions),
      baselineMetrics: {
        tierMidpoint: summarizeRankBacktest(predictions
          .filter(prediction => Number.isFinite(prediction.tierMidpointError))
          .map(prediction => ({
            actualRank: prediction.actualRank,
            absoluteError: prediction.tierMidpointError,
          }))),
      },
      byTier: Object.fromEntries([...tiers].map(([tier, tierPredictions]) => [
        tier,
        summarizeRankBacktest(tierPredictions),
      ])),
      predictions,
    };
  }

  root.LadderUtils = root.LadderUtils || {};
  root.LadderUtils.ESTIMATED_RANK_METRIC_WEIGHTS = ESTIMATED_RANK_METRIC_WEIGHTS;
  root.LadderUtils.ESTIMATED_RANK_PENALTIES = ESTIMATED_RANK_PENALTIES;
  root.LadderUtils.ESTIMATED_RANK_NORMALIZATION = ESTIMATED_RANK_NORMALIZATION;
  root.LadderUtils.getEstimatedRankRange = getEstimatedRankRange;
  root.LadderUtils.backtestEstimatedRanks = backtestEstimatedRanks;
}(typeof window !== "undefined" ? window : globalThis));