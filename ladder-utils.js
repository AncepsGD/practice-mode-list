const LOCAL_KEY = "pml_edit_data";

function getTierByName(name) {
  if (typeof name !== "string") return "";
  const normalized = name.toLowerCase();
  const mapping = {
    "WEINERclub": "Novice",
    "Rainstorm": "Intermediate",
    "Sakupen End": "Advanced",
    "Silent lake": "Insane",
    "Bye Level": "Legendary",
    "Bloodiest Water": "Master",
    "Nightmarish": "Divine",
    "The Twilight Zone (Unnerfed)": "Transcendent"
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
    { key: "Silent lake", tier: "Insane" },
    { key: "Bye Level", tier: "Legendary" },
    { key: "Bloodiest Water", tier: "Master" },
    { key: "Nightmarish", tier: "Divine" },
    { key: "The Twilight Zone (Unnerfed)", tier: "Transcendent" }
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

function processRawData(data) {
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
        rank: item.rank,
        name: item.name,
        id: item.id,
        tier: item.tier || item.tierName || "",
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
      };
    });

  const uniqueLevels = [];
  const seenIds = new Set();
  const seenNames = new Set();
  rawLevels.forEach(level => {
    const idKey = String(level.id || "").trim();
    const nameKey = String(level.name || "").trim().toLowerCase();
    if (idKey && seenIds.has(idKey)) return;
    if (nameKey && seenNames.has(nameKey)) return;
    if (idKey) seenIds.add(idKey);
    if (nameKey) seenNames.add(nameKey);
    uniqueLevels.push(level);
  });

  assignTiers(uniqueLevels);

  const maxRank = Math.max(...uniqueLevels.map(l => l.rank), 1);
  uniqueLevels.forEach(l => {
    l.points = calculatePoints(l.rank, maxRank);
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
    level.avgVictorAttempts = victorAttempts.length ? trimmedMean(victorAttempts) : null;

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
  return `${skill.toFixed(2)}×`;
}

function classifySkill(skill) {
  if (skill < 0.75) return "Elite";
  if (skill < 1) return "Above average";
  if (skill <= 1.25) return "Average";
  return "Below average";
}

function describeSkillRelative(skill) {
  if (skill <= 1) {
    const pct = Math.round((1 - skill) * 100);
    return pct > 0 ? `Compared to average victor: ${pct}% faster` : "Compared to average victor: on par";
  }

  const pct = Math.round((skill - 1) * 100);
  return `Compared to average victor: ${pct}% slower`;
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
    rank: level.rank || 0,
    victorCount: level.victors.length,
    avgVictorTime: victorTimes.length ? trimmedMean(victorTimes) : null,
    avgVictorAttempts: victorAttempts.length ? trimmedMean(victorAttempts) : null,
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

function buildFeatureScaler(rows) {
  if (!rows.length) return null;
  const p = rows[0].x.length;
  const means = Array(p).fill(0);
  const stds = Array(p).fill(0);
  const n = rows.length;

  for (let i = 1; i < p; i++) {
    means[i] = rows.reduce((sum, row) => sum + row.x[i], 0) / n;
  }

  for (let i = 1; i < p; i++) {
    const variance = rows.reduce((sum, row) => {
      const diff = row.x[i] - means[i];
      return sum + diff * diff;
    }, 0) / n;
    stds[i] = Math.sqrt(variance) || 1;
  }

  return { means, stds };
}

function standardizeFeatureVector(x, scaler) {
  if (!scaler) return x.slice();
  return x.map((value, index) => {
    if (index === 0) return 1;
    const std = scaler.stds[index];
    return std > 0 ? (value - scaler.means[index]) / std : 0;
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
  const standardizedRows = rows.map(({ x, y }) => ({ x: standardizeFeatureVector(x, scaler), y }));
  const xtx = Array.from({ length: p }, () => Array(p).fill(0));
  const xty = Array(p).fill(0);

  standardizedRows.forEach(({ x, y }) => {
    const target = Math.log(Math.max(y, 1e-6));
    for (let i = 0; i < p; i++) {
      xty[i] += x[i] * target;
      for (let j = 0; j < p; j++) {
        xtx[i][j] += x[i] * x[j];
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

    lvl.victors.forEach(v => {
      const sec = v.seconds;
      if (sec !== null && sec > 0) {
        rows.push({ x: timeModelVector(features), y: sec });
      }
    });
  });

  if (!rows.length) return null;

  const model = trainLinearRegression(rows, 0.001);
  if (model) return { weights: model.weights, featureCount: model.featureCount, scaler: model.scaler };

  const meanTime = rows.reduce((sum, row) => sum + Math.log(Math.max(row.y, 1e-6)), 0) / rows.length;
  return {
    weights: [Math.exp(meanTime), 0, 0, 0, 0, 0, 0, 0],
    featureCount: timeModelVector(buildTimeModelFeatures(levels[0] || {})).length,
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

function calculateSkillComponents(levels, playerName) {
  const speedRatios = [];
  const attemptRatios = [];
  const weights = [];

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

    const timeBaseline = trimmedMean(parsedEntries.map(v => v.sec), 0.2);
    const attemptsWithData = parsedEntries.filter(v => v.attempts !== null && v.attempts > 0);
    const attemptBaseline = attemptsWithData.length
      ? trimmedMean(attemptsWithData.map(v => v.attempts), 0.2)
      : null;

    if (!timeBaseline || timeBaseline <= 0) return;

    const speedRatio = playerEntry.sec / timeBaseline;
    speedRatios.push(speedRatio);

    if (attemptBaseline && attemptBaseline > 0 && playerEntry.attempts !== null && playerEntry.attempts > 0) {
      const attemptRatio = playerEntry.attempts / attemptBaseline;
      attemptRatios.push(attemptRatio);
    }

    weights.push(Math.min(1.6, 0.35 + parsedEntries.length * 0.2));
  });

  const combinedSpeed = speedRatios.length
    ? (() => {
      const weightedMean = speedRatios.reduce((sum, ratio, index) => sum + ratio * weights[index], 0)
        / weights.reduce((sum, weight) => sum + weight, 0);
      const robustRatio = trimmedMean(speedRatios, 0.25) ?? weightedMean;
      return (weightedMean * 0.6) + (robustRatio * 0.4);
    })()
    : 1;

  const combinedAttempts = attemptRatios.length
    ? (() => {
      const weightedMean = attemptRatios.reduce((sum, ratio, index) => sum + ratio * weights[index], 0)
        / weights.reduce((sum, weight) => sum + weight, 0);
      const robustRatio = trimmedMean(attemptRatios, 0.25) ?? weightedMean;
      return (weightedMean * 0.6) + (robustRatio * 0.4);
    })()
    : 1;

  const speedScore = clamp(1 + (combinedSpeed - 1) * Math.min(1, speedRatios.length / 6), 0.7, 1.5);
  const attemptsScore = clamp(1 + (combinedAttempts - 1) * Math.min(1, attemptRatios.length / 6), 0.7, 1.5);
  const model = trainPlayerTimeModel(levels, playerName);

  return {
    speed: speedScore,
    attempts: attemptsScore,
    model,
    skillRatio: model ? model.skillRatio : null,
  };
}

function calculatePlayerSkill(levels, playerName) {
  const components = calculateSkillComponents(levels, playerName);
  return components.skillRatio ?? ((components.speed + components.attempts) / 2);
}

function calculateAvgTimePerPoint(levels) {
  const ratios = [];
  levels.forEach(lvl => {
    const times = lvl.victors.map(v => v.seconds).filter(t => t !== null && t > 0);
    if (times.length > 0 && lvl.points > 0) {
      ratios.push(trimmedMean(times) / lvl.points);
    }
  });
  return ratios.length ? trimmedMean(ratios) : null;
}

function calculateAvgAttemptsPerPoint(levels) {
  const ratios = [];
  levels.forEach(lvl => {
    const attempts = lvl.victors
      .map(v => Number(v.attempts))
      .filter(a => Number.isFinite(a) && a > 0);
    if (attempts.length > 0 && lvl.points > 0) {
      ratios.push(trimmedMean(attempts) / lvl.points);
    }
  });
  return ratios.length ? trimmedMean(ratios) : null;
}

function estimateLevelOutcome(level, components, avgTimePerPoint, avgAttemptsPerPoint, maxPoints) {
  const victorTimes = level.victors
    .map(v => v.seconds)
    .filter(t => t !== null && t > 0);

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

  let baseAttempts = null;
  if (victorAttempts.length > 0) {
    baseAttempts = trimmedMean(victorAttempts);
  } else if (avgAttemptsPerPoint !== null && level.points > 0) {
    baseAttempts = level.points * avgAttemptsPerPoint;
  }

  function difficultyModifier(level, maxPoints) {
    const maxP = Math.max(1, maxPoints || 1);
    const norm = (level.points || 0) / maxP;
    const mod = 1 + (norm - 0.5) * 0.8;
    const attempts = level.victors
      .map(v => Number(v.attempts))
      .filter(a => Number.isFinite(a) && a > 0);
    const medianAttempts = attempts.length ? trimmedMean(attempts) : null;
    const attemptsFactor = medianAttempts === null ? 1 : clamp(1 + (medianAttempts / 50 - 1) * 0.25, 0.8, 2.0);
    return clamp(mod * attemptsFactor, 0.7, 2.2);
  }

  function familiarityModifier(level, playerName) {
    if (!playerName) return 1;
    const has = level.victors.some(v => v.name === playerName);
    if (has) return 0.85;
    return 1.0;
  }

  const modelPredictedSeconds = predictPlayerTime(level, components && components.model ? components.model : null);
  if (modelPredictedSeconds !== null) {
    const MAX_REASONABLE_SECONDS = 10 * 365 * 24 * 3600;
    const isReasonablePrediction = Number.isFinite(modelPredictedSeconds) && modelPredictedSeconds > 0 && modelPredictedSeconds < MAX_REASONABLE_SECONDS;
    if (!isReasonablePrediction) {
      console.warn("Rejected unreasonable model prediction for level:", level.name, { modelPredictedSeconds });
    } else {
      const expectedAttempts = baseAttempts && baseAttempts > 0
        ? baseAttempts * (components && components.attempts ? components.attempts : 1)
        : null;
      const wrTimeSeconds = level.wrTime ? parseTimeToSeconds(level.wrTime.time) : null;
      const minObserved = victorTimes.length ? Math.min(...victorTimes) : null;
      const bestObserved = wrTimeSeconds !== null ? wrTimeSeconds : minObserved;
      const LOWER_BOUND_FACTOR = 0.6;
      const lowerBound = bestObserved !== null ? bestObserved * LOWER_BOUND_FACTOR : null;

      let expectedSeconds = modelPredictedSeconds;
      if (lowerBound !== null && Number.isFinite(expectedSeconds) && expectedSeconds < lowerBound) {
        expectedSeconds = lowerBound;
      }

      return { expectedSeconds, expectedAttempts };
    }
  }

  const diffMod = difficultyModifier(level, maxPoints);
  const famMod = familiarityModifier(level, components && components._playerName ? components._playerName : null);

  const predictedMultiplier = (components && components.speed ? components.speed : 1) * diffMod * famMod;
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
  if (!Number.isFinite(playerSeconds) || playerSeconds <= 0) return 0;
  if (!Number.isFinite(bestSeconds) || bestSeconds <= 0) return 0;
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
    .filter(victor => {
      const candidateName = String(victor && victor.name ? victor.name : "").trim();
      return Boolean(candidateName) && candidateName !== "-" && !/^(?:redacted\s+player\s*#\d+|player\s*#\d+)$/i.test(candidateName) && !/^[-+]?\d+(?:\.\d+)?$/.test(candidateName);
    })
    .map(victor => ({
      ...victor,
      name: String(victor.name || "").trim(),
      seconds: Number.isFinite(victor.seconds) ? victor.seconds : null,
      attempts: Number.isFinite(victor.attempts) && victor.attempts > 0 ? victor.attempts : null,
    }));

  const players = [...validEntries, syntheticPlayer];
  const sortedPlayers = sortVictorsByDate(players);

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

  const projectedIndex = sortedPlayers.findIndex(victor => String(victor.name || "").trim() === syntheticPlayer.name);
  const timeRank = timeRankings.findIndex(victor => String(victor.name || "").trim() === syntheticPlayer.name) + 1;
  const attemptRank = attemptRankings.findIndex(victor => String(victor.name || "").trim() === syntheticPlayer.name) + 1;

  const bonusMultiplier = 1 +
    (projectedIndex === 0 ? firstVictorBonus : 0) +
    (timeRank === 1 ? fastestCompletionBonus : 0) +
    (attemptRank === 1 ? lowestAttemptsBonus : 0);

  const leaderboardStyleMultiplier = timeScore * bonusMultiplier * completionMultiplier;
  if (Number.isFinite(leaderboardStyleMultiplier) && leaderboardStyleMultiplier > 0) {
    return leaderboardStyleMultiplier;
  }

  const wrTimeSeconds = level.wrTime ? parseTimeToSeconds(level.wrTime.time) : null;
  const timePossible = wrTimeSeconds !== null && expectedSeconds !== null && expectedSeconds < wrTimeSeconds;

  const wrAttempts = level.wrAttempts ? Number(level.wrAttempts.attempts) : null;
  const attemptsPossible = wrAttempts !== null && Number.isFinite(wrAttempts) && expectedAttempts !== null && expectedAttempts < wrAttempts;

  const firstVictoryPossible = level.victors.length === 0 ? 1 : 0;
  const recordCount = firstVictoryPossible + (timePossible ? 1 : 0) + (attemptsPossible ? 1 : 0);
  return recordMultiplier(recordCount);
}

function buildRecommendations(levels, player, avgTimePerPoint, avgAttemptsPerPoint, maxPoints, allLevels = levels) {
  if (!player) return [];
  const beaten = new Set(player.levels);
  const components = calculateSkillComponents(levels, player.name);

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

      const { expectedSeconds, expectedAttempts } = estimateLevelOutcome(lvl, components, avgTimePerPoint, avgAttemptsPerPoint, maxPoints);
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
      const confidence = victorCount > 0 ? (victorCount / (victorCount + 3)) : 0;

      const wrHolderTimeRatio = wrTimeSeconds !== null && levelAvgVictorTime && levelAvgVictorTime > 0
        ? wrTimeSeconds / levelAvgVictorTime
        : null;
      const wrHolderAttemptsRatio = wrAttempts !== null && Number.isFinite(wrAttempts) && wrAttempts > 0 && levelAvgAttempts && levelAvgAttempts > 0
        ? wrAttempts / levelAvgAttempts
        : null;
      const playerIsBetterThanWrHolderInTime = wrHolderTimeRatio !== null && components.speed !== null
        ? components.speed < wrHolderTimeRatio
        : false;
      const playerIsBetterThanWrHolderInAttempts = wrHolderAttemptsRatio !== null && components.attempts !== null
        ? components.attempts < wrHolderAttemptsRatio
        : false;
      const timeWrPossible = (wrTimeSeconds !== null && expectedSeconds !== null && expectedSeconds < wrTimeSeconds)
        || playerIsBetterThanWrHolderInTime;
      const attemptsWrPossible = (wrAttempts !== null && Number.isFinite(wrAttempts) && expectedAttempts !== null && expectedAttempts < wrAttempts)
        || playerIsBetterThanWrHolderInAttempts;
      const hasWrTime = wrTimeSeconds !== null;
      const hasWrAttempts = wrAttempts !== null && Number.isFinite(wrAttempts);

      return {
        id: lvl.id || lvl.name,
        level: lvl.name,
        rank: lvl.rank || null,
        basePoints,
        projectedMult,
        projectedPoints,
        expectedHours,
        expectedValue,
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

  const sorted = [...recommendations].sort((a, b) => {
    const pa = a.projectedPoints || 0;
    const pb = b.projectedPoints || 0;
    if (pb !== pa) return pb - pa;
    return (a.expectedHours || 0) - (b.expectedHours || 0);
  });

  const deduped = [];
  let i = 0;
  while (i < sorted.length) {
    let j = i;
    let groupMinHours = Infinity;
    while (j < sorted.length && (sorted[j].projectedPoints || 0) === (sorted[i].projectedPoints || 0)) {
      const hours = sorted[j].expectedHours || 0;
      if (hours <= groupMinHours) {
        deduped.push(sorted[j]);
        groupMinHours = Math.min(groupMinHours, hours);
      }
      j++;
    }
    i = j;
  }

  const kept = [];
  let runningMinHours = Infinity;
  for (const candidate of deduped) {
    const hours = candidate.expectedHours || 0;
    if (hours < runningMinHours) {
      kept.push(candidate);
    }
  }

  let minSeen = Infinity;
  const result = [];
  for (const candidate of kept) {
    const hours = candidate.expectedHours || 0;
    if (hours < minSeen) {
      result.push(candidate);
      minSeen = hours;
    }
  }

  return result;
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

  let items = recommendations
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

  const dpCost = new Float64Array(maxUnits + 1).fill(Infinity);
  const dpTime = new Float64Array(maxUnits + 1).fill(Infinity);
  const dpParentUnits = new Int32Array(maxUnits + 1).fill(-1);
  const dpParentItem = new Int32Array(maxUnits + 1).fill(-1);
  dpCost[0] = 0;
  dpTime[0] = 0;

  const penaltyBase = Math.max(0.01, Math.min(0.2, targetPoints / 1000));

  for (let itemIdx = 0; itemIdx < items.length; itemIdx++) {
    const item = items[itemIdx];
    for (let units = maxUnits; units >= 0; units--) {
      if (dpCost[units] === Infinity) continue;

      const nextUnits = Math.min(maxUnits, units + item.units);
      const nextTime = dpTime[units] + item.expectedHours;
      const overshootUnits = Math.max(0, nextUnits - targetUnits);
      const nextCost = nextTime + overshootUnits * penaltyBase;

      if (nextCost < dpCost[nextUnits] - 1e-9
        || (Math.abs(nextCost - dpCost[nextUnits]) < 1e-9 && nextTime < dpTime[nextUnits])) {
        dpCost[nextUnits] = nextCost;
        dpTime[nextUnits] = nextTime;
        dpParentUnits[nextUnits] = units;
        dpParentItem[nextUnits] = itemIdx;
      }
    }
  }

  let bestUnits = 0;
  let bestCost = Infinity;
  let bestTime = Infinity;

  for (let units = targetUnits; units <= maxUnits; units++) {
    if (dpCost[units] === Infinity) continue;

    const isBetter = dpCost[units] < bestCost - 1e-9
      || (Math.abs(dpCost[units] - bestCost) < 1e-9 && dpTime[units] < bestTime);

    if (isBetter) {
      bestUnits = units;
      bestCost = dpCost[units];
      bestTime = dpTime[units];
    }
  }

  if (bestUnits === 0) {
    for (let units = maxUnits; units > 0; units--) {
      if (dpCost[units] < Infinity) {
        bestUnits = units;
        bestCost = dpCost[units];
        bestTime = dpTime[units];
        break;
      }
    }
  }

  if (bestUnits === 0 || dpCost[bestUnits] === Infinity) {
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

function targetRankSurpassPoints(leaderboard, targetPlayer) {
  if (!targetPlayer) return 0;
  return targetPlayer.points;
}