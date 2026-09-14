(function (root) {
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
    const metricFields = ["tps", "length", "precision"];
    const scoredCandidates = candidates.map(entry => {
      let score = entry.tier === tier || !tier ? 0 : 0.5;
      let comparedMetrics = 0;
      let comparedDifficultyMetrics = 0;

      metricFields.forEach(field => {
        const targetValue = Number(level[field]);
        const candidateValue = Number(entry.candidate?.[field]);
        if (!Number.isFinite(targetValue) || targetValue <= 0
          || !Number.isFinite(candidateValue) || candidateValue <= 0) return;
        score += Math.abs(Math.log(targetValue / candidateValue));
        comparedMetrics++;
        comparedDifficultyMetrics++;
      });

      if (comparedMetrics) score /= comparedMetrics;
      if (level.is2Player !== undefined && Boolean(level.is2Player) !== Boolean(entry.candidate?.is2Player)) {
        score += 0.35;
      }

      const targetVictorCount = Array.isArray(level.victors) ? level.victors.length : Number(level.victorCount);
      const candidateVictorCount = Array.isArray(entry.candidate?.victors)
        ? entry.candidate.victors.length
        : Number(entry.candidate?.victorCount);
      if (Number.isFinite(targetVictorCount) && Number.isFinite(candidateVictorCount)) {
        score += Math.abs(Math.log((1 + targetVictorCount) / (1 + candidateVictorCount))) * 0.2;
        comparedMetrics++;
      }

      return { rank: entry.rank, score, comparedMetrics, comparedDifficultyMetrics };
    });

    const matchingCandidates = scoredCandidates
      .filter(entry => entry.comparedMetrics > 0)
      .sort((a, b) => a.score - b.score)
      .slice(0, 5);
    if (matchingCandidates.length) {
      if (matchingCandidates[0].score <= 1e-9 && matchingCandidates[0].comparedDifficultyMetrics > 0) {
        const min = hasExplicitRange ? requestedMin : Math.min(...matchingCandidates.map(entry => entry.rank));
        const max = hasExplicitRange ? requestedMax : Math.max(...matchingCandidates.map(entry => entry.rank));
        return {
          min,
          max,
          estimatedRank: Math.max(min, Math.min(max, matchingCandidates[0].rank)),
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
      const centeredRank = (weightedRank + rangeMidpoint) / 2;
      return {
        min,
        max,
        estimatedRank: Math.max(min, Math.min(max, Math.round(centeredRank))),
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
  root.LadderUtils.getEstimatedRankRange = getEstimatedRankRange;
}(typeof window !== "undefined" ? window : globalThis));
