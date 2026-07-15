const LOCAL_KEY = "pml_edit_data";

function parseTimeToSeconds(timeStr) {
  if (!timeStr || typeof timeStr !== "string") return null;
  const s = timeStr.trim();
  if (!s) return null;

  const parts = {};
  const tokenRegex = /(\d+)\s*([hms])/gi;
  let match;

  while ((match = tokenRegex.exec(s)) !== null) {
    const unit = match[2].toLowerCase();
    if (parts[unit] !== undefined) return null;
    parts[unit] = parseInt(match[1], 10);
  }

  if (Object.keys(parts).length === 0) return null;

  if ("h" in parts && "m" in parts && parts["m"] >= 60) return null;
  if (("h" in parts || "m" in parts) && "s" in parts && parts["s"] >= 60) return null;

  const h = parts["h"] || 0;
  const m = parts["m"] || 0;
  const sec = parts["s"] || 0;
  const total = h * 3600 + m * 60 + sec;
  return total > 0 ? total : null;
}

function calculatePoints(rank, maxRank) {
  if (!rank || !maxRank) return 0;
  const base = 10, top = 360;
  if (maxRank === 1) return top;
  const ratio = Math.pow(top / base, 1 / (maxRank - 1));
  return base * Math.pow(ratio, maxRank - rank);
}

function loadLevelsJson() {
  const saved = localStorage.getItem(LOCAL_KEY);
  if (saved) {
    try {
      return Promise.resolve(JSON.parse(saved));
    } catch (_) { }
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);
  return fetch("levels.json", { signal: controller.signal })
    .then(r => {
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json();
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
        points: 0,
        victors,
        creator: item.creators,
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

function trainLinearRegression(rows, ridge = 0.01) {
  if (!rows.length) return null;
  const p = rows[0].x.length;
  const xtx = Array.from({ length: p }, () => Array(p).fill(0));
  const xty = Array(p).fill(0);

  rows.forEach(({ x, y }) => {
    const target = Math.log(Math.max(y, 1e-6));
    for (let i = 0; i < p; i++) {
      xty[i] += x[i] * target;
      for (let j = 0; j < p; j++) {
        xtx[i][j] += x[i] * x[j];
      }
    }
  });

  for (let i = 0; i < p; i++) {
    xtx[i][i] += ridge;
  }

  const weights = solveLinearSystem(xtx, xty);
  return weights ? { weights, featureCount: p } : null;
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
  if (model) return { weights: model.weights, featureCount: model.featureCount };

  const meanTime = rows.reduce((sum, row) => sum + Math.log(Math.max(row.y, 1e-6)), 0) / rows.length;
  return {
    weights: [Math.exp(meanTime), 0, 0, 0, 0, 0, 0, 0],
    featureCount: timeModelVector(buildTimeModelFeatures(levels[0] || {})).length,
  };
}

function blendRegressionModels(priorModel, localModel, weight) {
  if (!priorModel && !localModel) return null;
  if (!priorModel) return localModel;
  if (!localModel) return priorModel;

  const effectiveWeight = clamp(weight, 0.05, 0.95);
  const priorWeight = 1 - effectiveWeight;
  const weights = priorModel.weights.map((value, index) => value * priorWeight + (localModel.weights[index] || 0) * effectiveWeight);

  return { weights, featureCount: priorModel.featureCount || localModel.featureCount };
}

function trainPlayerTimeModel(levels, playerName) {
  const rows = [];
  const ratios = [];
  const playerRows = [];
  const globalModel = buildGlobalTimeModel(levels);

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

    const row = { x: timeModelVector(features), y: playerEntry.sec };
    rows.push(row);
    playerRows.push(row);

    if (playerEntry.sec > 0 && features.avgVictorTime > 0) {
      ratios.push(playerEntry.sec / features.avgVictorTime);
    }
  });

  const localModel = playerRows.length >= 3
    ? trainLinearRegression(playerRows, 0.001)
    : null;
  const localWeight = clamp(playerRows.length / 8, 0.2, 0.9);
  const blendedModel = blendRegressionModels(globalModel, localModel ? { weights: localModel.weights, featureCount: localModel.featureCount } : null, localWeight);
  const playerSkillRatio = ratios.length ? geometricMean(ratios) : null;
  const skillRatio = playerSkillRatio
    ? clamp(playerSkillRatio * localWeight + 1 * (1 - localWeight), 0.5, 2.0)
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
  const logSeconds = model.model.weights.reduce((sum, w, i) => sum + w * x[i], 0);
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
    const expectedAttempts = baseAttempts && baseAttempts > 0
      ? baseAttempts * (components && components.attempts ? components.attempts : 1)
      : null;
    const baselineSeconds = baseTime && baseTime > 0 ? baseTime : 7200;
    return { expectedSeconds: Math.max(baselineSeconds, modelPredictedSeconds), expectedAttempts };
  }

  const diffMod = difficultyModifier(level, maxPoints);
  const famMod = familiarityModifier(level, components && components._playerName ? components._playerName : null);

  const predictedMultiplier = (components && components.speed ? components.speed : 1) * diffMod * famMod;

  const expectedSeconds = baseTime && baseTime > 0
    ? Math.max(baseTime, baseTime * predictedMultiplier)
    : null;

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

function projectedMultiplierFor(level, expectedSeconds, expectedAttempts) {
  const wrTimeSeconds = level.wrTime ? parseTimeToSeconds(level.wrTime.time) : null;
  const timePossible = wrTimeSeconds !== null && expectedSeconds !== null && expectedSeconds < wrTimeSeconds;

  const wrAttempts = level.wrAttempts ? Number(level.wrAttempts.attempts) : null;
  const attemptsPossible = wrAttempts !== null && Number.isFinite(wrAttempts) && expectedAttempts !== null && expectedAttempts < wrAttempts;

  const firstVictoryPossible = level.victors.length === 0 ? 1 : 0;
  const recordCount = firstVictoryPossible + (timePossible ? 1 : 0) + (attemptsPossible ? 1 : 0);
  return recordMultiplier(recordCount);
}

function buildRecommendations(levels, player, avgTimePerPoint, avgAttemptsPerPoint, maxPoints) {
  if (!player) return [];
  const beaten = new Set(player.levels);
  const components = calculateSkillComponents(levels, player.name);

  components._playerName = player.name;

  const recommendations = levels
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

      const expectedHours = expectedSeconds / 3600;
      const projectedMult = projectedMultiplierFor(lvl, expectedSeconds, expectedAttempts);
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

  console.log({
    totalLevels: levels.length,
    unbeaten: levels.filter(l => !beaten.has(l.name)).length,
    withPoints: levels.filter(l => l.points > 0).length,
    player: player.name,
    recommendations,
  });

  return recommendations.sort((a, b) => b.expectedValue - a.expectedValue);
}

function pruneDominatedRecommendations(recommendations) {
  if (!Array.isArray(recommendations) || recommendations.length <= 1) return recommendations;

  const kept = [];

  recommendations.forEach(candidate => {
    const isDominated = kept.some(existing => {
      const pointsBetterOrEqual = (existing.projectedPoints || 0) >= (candidate.projectedPoints || 0);
      const timeBetterOrEqual = (existing.expectedHours || 0) <= (candidate.expectedHours || 0);
      const strictImprovement = pointsBetterOrEqual && timeBetterOrEqual && (
        (existing.projectedPoints || 0) > (candidate.projectedPoints || 0)
        || (existing.expectedHours || 0) < (candidate.expectedHours || 0)
      );
      return strictImprovement;
    });

    if (isDominated) return;

    const dominatedByCandidate = kept.filter(existing => {
      const pointsBetterOrEqual = (candidate.projectedPoints || 0) >= (existing.projectedPoints || 0);
      const timeBetterOrEqual = (candidate.expectedHours || 0) <= (existing.expectedHours || 0);
      const strictImprovement = pointsBetterOrEqual && timeBetterOrEqual && (
        (candidate.projectedPoints || 0) > (existing.projectedPoints || 0)
        || (candidate.expectedHours || 0) < (existing.expectedHours || 0)
      );
      return strictImprovement;
    });

    if (dominatedByCandidate.length) {
      kept.splice(kept.indexOf(dominatedByCandidate[0]), 1);
    }

    kept.push(candidate);
  });

  return kept;
}

function optimizeRoute(recommendations, targetPoints, granularity = 20) {
  if (!Array.isArray(recommendations) || !recommendations.length || targetPoints <= 0) {
    return { time: 0, picks: [], fallback: false };
  }

  const effectiveGranularity = Number.isFinite(granularity) && granularity > 0
    ? granularity
    : 20;
  const adaptiveGranularity = Math.max(1, Math.min(100, Math.round(100 / Math.max(1, targetPoints))));
  const resolvedGranularity = Math.max(effectiveGranularity, adaptiveGranularity);

  const items = recommendations
    .map(item => ({
      ...item,
      units: Math.max(1, Math.round((item.projectedPoints || 0) * resolvedGranularity)),
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

  const targetUnits = Math.max(1, Math.round(targetPoints * resolvedGranularity));
  const maxUnits = Math.max(targetUnits, ...items.map(item => item.units));

  const dpCost = new Array(maxUnits + 1).fill(Infinity);
  const dpTime = new Array(maxUnits + 1).fill(Infinity);
  const dpPrev = new Array(maxUnits + 1).fill(null);
  dpCost[0] = 0;
  dpTime[0] = 0;

  const penaltyBase = Math.max(0.01, Math.min(0.2, targetPoints / 1000));

  for (const item of items) {
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
        dpPrev[nextUnits] = { units, item, prev: dpPrev[units] };
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

  if (bestUnits === 0 || dpCost[bestUnits] === Infinity) {
    const best = items[0];
    return best ? { time: best.expectedHours, picks: [best], fallback: true } : { time: 0, picks: [], fallback: false };
  }

  const picks = [];
  let cursor = bestUnits;
  let state = dpPrev[cursor];

  while (state && state.item) {
    picks.push(state.item);
    cursor = state.units;
    state = state.prev;
  }

  picks.reverse();

  return { time: bestTime, picks, fallback: bestUnits < targetUnits };
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
  const lockedPoints = lockedPicks.reduce((sum, rec) => sum + (rec.projectedPoints || 0), 0);
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
      message: "No available levels to reach target",
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
