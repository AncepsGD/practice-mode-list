(function (root) {
  const ESTIMATED_RANK_METRIC_WEIGHTS = Object.freeze({
    tps: 1,
    length: 0.75,
    precision: 1.25,
    ratio: 1,
    victorCount: 0.2,
    victorEvidence: 0.8,
  });

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

  const ESTIMATED_RANK_PENALTIES = Object.freeze({
    tierMismatch: 0.5,
    twoPlayerMismatch: 0.35,
  });

  const ESTIMATED_RANK_NORMALIZATION = "percentile";

  function getPercentile(value, sortedValues) {
    if (!Number.isFinite(value) || !sortedValues.length) return null;
    let lowerCount = 0;
    let equalCount = 0;
    sortedValues.forEach(candidateValue => {
      if (candidateValue < value) lowerCount++;
      else if (candidateValue === value) equalCount++;
    });
    return (lowerCount + equalCount / 2) / sortedValues.length;
  }

  function getMetricValue(level, field) {
    if (field === "length") return parseVictorTime(level?.[field]);
    if (field === "ratio") return getRatioDifficultyScore(level?.ratio);
    const value = Number(level?.[field]);
    return Number.isFinite(value) ? value : null;
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

  function getNormalizedDifficulty(level, metricFields, metricDistributions) {
    let weightedTotal = 0;
    let comparedWeight = 0;
    metricFields.forEach(field => {
      const value = getMetricValue(level, field);
      const weight = ESTIMATED_RANK_METRIC_WEIGHTS[field];
      const percentile = getPercentile(value, metricDistributions[field]);
      if (!Number.isFinite(value) || value <= 0 || percentile === null) return;
      weightedTotal += percentile * weight;
      comparedWeight += weight;
    });
    return comparedWeight ? weightedTotal / comparedWeight : null;
  }

  function interpolateRankFromAnchors(targetDifficulty, anchors) {
    if (!Number.isFinite(targetDifficulty) || !anchors.length) return null;
    const sortedAnchors = anchors
      .filter(anchor => Number.isFinite(anchor.difficulty) && Number.isFinite(anchor.rank))
      .sort((a, b) => b.difficulty - a.difficulty);
    if (!sortedAnchors.length) return null;
    if (sortedAnchors.length === 1 || targetDifficulty >= sortedAnchors[0].difficulty) {
      return sortedAnchors[0].rank;
    }
    const lastAnchor = sortedAnchors[sortedAnchors.length - 1];
    if (targetDifficulty <= lastAnchor.difficulty) return lastAnchor.rank;

    for (let index = 1; index < sortedAnchors.length; index += 1) {
      const left = sortedAnchors[index - 1];
      const right = sortedAnchors[index];
      if (targetDifficulty < right.difficulty) continue;
      const difficultySpan = left.difficulty - right.difficulty;
      if (difficultySpan <= 0) return Math.round((left.rank + right.rank) / 2);
      const ratio = (left.difficulty - targetDifficulty) / difficultySpan;
      return left.rank + (right.rank - left.rank) * ratio;
    }
    return lastAnchor.rank;
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

  function getUsableVictors(level) {
    return (Array.isArray(level?.victors) ? level.victors : [])
      .map(victor => ({
        name: String(victor?.name || "").trim().toLowerCase(),
        seconds: parseVictorTime(victor?.seconds ?? victor?.time),
        attempts: Number(victor?.attempts),
      }))
      .filter(victor => victor.name && (victor.seconds || (Number.isFinite(victor.attempts) && victor.attempts > 0)));
  }

  function getGeometricMean(values) {
    const usable = values.filter(value => Number.isFinite(value) && value > 0);
    return usable.length ? Math.exp(usable.reduce((sum, value) => sum + Math.log(value), 0) / usable.length) : null;
  }

  function buildVictorSkillMap(levels) {
    const playerScores = new Map();
    levels.forEach(level => {
      const victors = getUsableVictors(level);
      const times = victors.map(victor => victor.seconds).filter(Number.isFinite);
      const attempts = victors.map(victor => victor.attempts).filter(value => Number.isFinite(value) && value > 0);
      const averageTime = getGeometricMean(times);
      const averageAttempts = getGeometricMean(attempts);
      victors.forEach(victor => {
        const scores = [];
        if (averageTime && victor.seconds) scores.push(averageTime / victor.seconds);
        if (averageAttempts && victor.attempts > 0) scores.push(averageAttempts / victor.attempts);
        if (!scores.length) return;
        if (!playerScores.has(victor.name)) playerScores.set(victor.name, []);
        playerScores.get(victor.name).push(getGeometricMean(scores));
      });
    });
    return new Map([...playerScores].map(([name, scores]) => [
      name,
      Math.max(0.5, Math.min(2, getGeometricMean(scores) || 1)),
    ]));
  }

  function getVictorEvidence(level, victorSkillMap) {
    const victors = getUsableVictors(level);
    if (!victors.length) return null;
    const adjustedTimes = [];
    const adjustedAttempts = [];
    victors.forEach(victor => {
      const skill = victorSkillMap.get(victor.name) || 1;
      if (victor.seconds) adjustedTimes.push(victor.seconds * skill);
      if (victor.attempts > 0) adjustedAttempts.push(victor.attempts * skill);
    });
    return {
      time: getGeometricMean(adjustedTimes),
      attempts: getGeometricMean(adjustedAttempts),
    };
  }

  function isSameLevel(target, candidate) {
    const targetId = String(target?.id || target?.levelId || "").trim();
    const candidateId = String(candidate?.id || candidate?.levelId || "").trim();
    if (targetId && candidateId) return targetId === candidateId;

    const targetName = String(target?.name || target?.levelName || "").trim().toLowerCase();
    const candidateName = String(candidate?.name || candidate?.levelName || "").trim().toLowerCase();
    return Boolean(targetName && candidateName && targetName === candidateName);
  }

  function getEstimatedRankRange(level, calibrationLevels, estimatedNames = []) {
    if (!level || !Array.isArray(calibrationLevels) || !calibrationLevels.length) return null;

    const explicitRange = level.rankRange || level.estimatedRankRange;
    const explicitMin = Number(explicitRange?.min ?? level.estimatedRankMin);
    const explicitMax = Number(explicitRange?.max ?? level.estimatedRankMax);
    const hasExplicitRange = Number.isFinite(explicitMin) && Number.isFinite(explicitMax)
      && explicitMin > 0 && explicitMax > 0;
    const requestedMin = hasExplicitRange ? Math.min(explicitMin, explicitMax) : null;
    const requestedMax = hasExplicitRange ? Math.max(explicitMin, explicitMax) : null;

    const estimatedRanks = new Map(
      (Array.isArray(estimatedNames) ? estimatedNames : []).map((name, index) => [
        String(name || "").trim().toLowerCase(),
        index + 1,
      ]).filter(([name]) => name)
    );
    const tier = String(level.tier || level.tierName || "").trim().toLowerCase();
    const rankedCandidates = calibrationLevels
      .map(candidate => ({
        candidate,
        rank: estimatedRanks.get(String(candidate?.name || candidate?.levelName || "").trim().toLowerCase())
          || Number(candidate?.modelRank || candidate?._difficultyRank || candidate?.rank),
        tier: String(candidate?.tier || candidate?.tierName || "").trim().toLowerCase(),
      }))
      .filter(entry => !isSameLevel(level, entry.candidate))
      .filter(entry => Number.isFinite(entry.rank) && entry.rank > 0);
    if (!rankedCandidates.length) return null;

    const sameTierCandidates = tier
      ? rankedCandidates.filter(entry => entry.tier === tier)
      : rankedCandidates;
    const tierCandidates = sameTierCandidates.length ? sameTierCandidates : rankedCandidates;
    const rangedCandidates = hasExplicitRange
      ? tierCandidates.filter(entry => entry.rank >= requestedMin && entry.rank <= requestedMax)
      : tierCandidates;
    const candidates = rangedCandidates.length ? rangedCandidates : tierCandidates;
    const hasBaselineCandidates = rangedCandidates.length > 0;
    const metricFields = ["tps", "length", "precision", "ratio"];
    const metricDistributions = Object.fromEntries(metricFields.map(field => [
      field,
      tierCandidates
        .map(entry => getMetricValue(entry.candidate, field))
        .filter(value => Number.isFinite(value) && value > 0)
        .sort((a, b) => a - b),
    ]));
    const victorSkillMap = buildVictorSkillMap(rankedCandidates.map(entry => entry.candidate));
    const targetVictorEvidence = getVictorEvidence(level, victorSkillMap);
    const candidateVictorEvidence = candidates.map(entry => ({
      entry,
      evidence: getVictorEvidence(entry.candidate, victorSkillMap),
    }));
    const victorEvidenceDistributions = {
      time: candidateVictorEvidence.map(item => item.evidence?.time).filter(Number.isFinite).sort((a, b) => a - b),
      attempts: candidateVictorEvidence.map(item => item.evidence?.attempts).filter(Number.isFinite).sort((a, b) => a - b),
    };
    const targetDifficulty = getNormalizedDifficulty(level, metricFields, metricDistributions);
    const outputAnchors = (hasExplicitRange ? candidates : tierCandidates)
      .map(entry => ({
        rank: entry.rank,
        difficulty: getNormalizedDifficulty(entry.candidate, metricFields, metricDistributions),
      }))
      .filter(anchor => anchor.difficulty !== null);
    if (!hasExplicitRange) {
      const calibrationRanks = tierCandidates.map(entry => entry.rank).filter(rank => Number.isFinite(rank) && rank > 0);
      if (Number.isFinite(targetDifficulty) && calibrationRanks.length) {
        const minRank = Math.min(...calibrationRanks);
        const maxRank = Math.max(...calibrationRanks);
        const calibratedRank = minRank + (1 - Math.max(0, Math.min(1, targetDifficulty))) * (maxRank - minRank);
        return {
          min: minRank,
          max: maxRank,
          estimatedRank: Math.max(minRank, Math.min(maxRank, Math.round(calibratedRank))),
        };
      }
    }
    const scoredCandidates = candidates.map(entry => {
      let score = entry.tier === tier || !tier ? 0 : ESTIMATED_RANK_PENALTIES.tierMismatch;
      let comparedMetricWeight = 0;
      let comparedDifficultyMetrics = 0;

      metricFields.forEach(field => {
        const targetValue = getMetricValue(level, field);
        const candidateValue = getMetricValue(entry.candidate, field);
        if (!Number.isFinite(targetValue) || targetValue <= 0
          || !Number.isFinite(candidateValue) || candidateValue <= 0) return;
        const metricWeight = ESTIMATED_RANK_METRIC_WEIGHTS[field];
        const targetPercentile = getPercentile(targetValue, metricDistributions[field]);
        const candidatePercentile = getPercentile(candidateValue, metricDistributions[field]);
        if (targetPercentile === null || candidatePercentile === null) return;
        score += Math.abs(targetPercentile - candidatePercentile) * metricWeight;
        comparedMetricWeight += metricWeight;
        comparedDifficultyMetrics++;
      });

      if (comparedMetricWeight) score /= comparedMetricWeight;
      if (level.is2Player !== undefined && Boolean(level.is2Player) !== Boolean(entry.candidate?.is2Player)) {
        score += ESTIMATED_RANK_PENALTIES.twoPlayerMismatch;
      }

      const targetVictorCount = Array.isArray(level.victors) ? level.victors.length : Number(level.victorCount);
      const candidateVictorCount = Array.isArray(entry.candidate?.victors)
        ? entry.candidate.victors.length
        : Number(entry.candidate?.victorCount);
      if (Number.isFinite(targetVictorCount) && Number.isFinite(candidateVictorCount)) {
        score += Math.abs(Math.log((1 + targetVictorCount) / (1 + candidateVictorCount)))
          * ESTIMATED_RANK_METRIC_WEIGHTS.victorCount;
        comparedMetricWeight += ESTIMATED_RANK_METRIC_WEIGHTS.victorCount;
      }

      const candidateEvidence = candidateVictorEvidence.find(item => item.entry === entry)?.evidence;
      if (targetVictorEvidence && candidateEvidence) {
        ["time", "attempts"].forEach(field => {
          const targetPercentile = getPercentile(targetVictorEvidence[field], victorEvidenceDistributions[field]);
          const candidatePercentile = getPercentile(candidateEvidence[field], victorEvidenceDistributions[field]);
          if (targetPercentile === null || candidatePercentile === null) return;
          score += Math.abs(targetPercentile - candidatePercentile)
            * ESTIMATED_RANK_METRIC_WEIGHTS.victorEvidence / 2;
          comparedMetricWeight += ESTIMATED_RANK_METRIC_WEIGHTS.victorEvidence / 2;
        });
      }

      return { rank: entry.rank, score, comparedMetricWeight, comparedDifficultyMetrics };
    });

    const matchingCandidates = scoredCandidates
      .filter(entry => entry.comparedMetricWeight > 0)
      .sort((a, b) => a.score - b.score)
      .slice(0, 5);
    if (matchingCandidates.length) {
      if (hasExplicitRange
        && matchingCandidates[0].score <= 1e-9
        && matchingCandidates[0].comparedDifficultyMetrics > 0) {
        const min = hasExplicitRange ? requestedMin : Math.min(...matchingCandidates.map(entry => entry.rank));
        const max = hasExplicitRange ? requestedMax : Math.max(...matchingCandidates.map(entry => entry.rank));
        return {
          min,
          max,
          estimatedRank: hasExplicitRange && !hasBaselineCandidates
            ? Math.round((min + max) / 2)
            : Math.max(min, Math.min(max, matchingCandidates[0].rank)),
        };
      }
      const totalWeight = matchingCandidates.reduce(
        (sum, entry) => sum + 1 / Math.max(entry.score, 1e-6),
        0,
      );
      const weightedRank = matchingCandidates.reduce(
        (sum, entry) => sum + entry.rank / Math.max(entry.score, 1e-6),
        0,
      ) / totalWeight;
      const min = hasExplicitRange ? requestedMin : Math.min(...matchingCandidates.map(entry => entry.rank));
      const max = hasExplicitRange ? requestedMax : Math.max(...matchingCandidates.map(entry => entry.rank));
      const rangeMidpoint = (min + max) / 2;
      const interpolatedRank = interpolateRankFromAnchors(targetDifficulty, outputAnchors);
      const estimatedRank = hasExplicitRange && !hasBaselineCandidates
        ? rangeMidpoint
        : interpolatedRank === null
        ? (weightedRank + rangeMidpoint) / 2
        : interpolatedRank;
      const outputMin = hasExplicitRange ? min : Math.min(min, Math.round(estimatedRank));
      const outputMax = hasExplicitRange ? max : Math.max(max, Math.round(estimatedRank));
      return {
        min: outputMin,
        max: outputMax,
        estimatedRank: Math.max(outputMin, Math.min(outputMax, Math.round(estimatedRank))),
      };
    }

    const min = hasExplicitRange ? requestedMin : Math.min(...candidates.map(entry => entry.rank));
    const max = hasExplicitRange ? requestedMax : Math.max(...candidates.map(entry => entry.rank));
    return {
      min,
      max,
      estimatedRank: Math.round((min + max) / 2),
    };
  }

  root.LadderUtils = root.LadderUtils || {};
  root.LadderUtils.ESTIMATED_RANK_METRIC_WEIGHTS = ESTIMATED_RANK_METRIC_WEIGHTS;
  root.LadderUtils.ESTIMATED_RANK_PENALTIES = ESTIMATED_RANK_PENALTIES;
  root.LadderUtils.ESTIMATED_RANK_NORMALIZATION = ESTIMATED_RANK_NORMALIZATION;
  root.LadderUtils.getEstimatedRankRange = getEstimatedRankRange;
}(typeof window !== "undefined" ? window : globalThis));
