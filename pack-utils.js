const PackUtils = (() => {
  const MIN_LEVEL_BONUS = 1;
  const MAX_LEVEL_BONUS = 10;
  const COMPLETION_BONUS = 50;

  function normalizeLevelName(name) {
    return String(name || "")
      .trim()
      .replace(/\s+/g, " ")
      .replace(/\s*\(layout\)$/i, "")
      .toLowerCase();
  }

  function getLevelPoints(level, levelByName) {
    const normalizedName = normalizeLevelName(level);
    return Number(levelByName.get(normalizedName)?.points) || 0;
  }

  function getLevelBonus(levelPoints, minLevelPoints, maxLevelPoints) {
    if (maxLevelPoints <= minLevelPoints) return MAX_LEVEL_BONUS;
    const difficultyRatio = Math.max(
      0,
      Math.min(1, (levelPoints - minLevelPoints) / (maxLevelPoints - minLevelPoints))
    );
    return MIN_LEVEL_BONUS + difficultyRatio * (MAX_LEVEL_BONUS - MIN_LEVEL_BONUS);
  }

  function createProgressContext(levels) {
    const levelByName = new Map(
      levels.map((level) => [normalizeLevelName(level.name), level])
    );
    const allLevelPoints = levels
      .map((level) => Number(level.points))
      .filter((points) => Number.isFinite(points) && points > 0);
    return {
      levelByName,
      minLevelPoints: allLevelPoints.length ? Math.min(...allLevelPoints) : 0,
      maxLevelPoints: allLevelPoints.length ? Math.max(...allLevelPoints) : 0,
    };
  }

  function populatePacks(packs, levelRecords) {
    const packByName = new Map(packs.map((pack) => [normalizeLevelName(pack.name), pack]));

    packs.forEach((pack) => {
      pack.levels = [];
    });

    levelRecords.forEach((level) => {
      if (!Array.isArray(level.packs)) return;
      level.packs.forEach((packName) => {
        const pack = packByName.get(normalizeLevelName(packName));
        const levelName = String(level.name || "").trim();
        if (!pack || !levelName) return;
        if (!pack.levels.some((name) => normalizeLevelName(name) === normalizeLevelName(levelName))) {
          pack.levels.push(levelName);
        }
      });
    });

    return packs;
  }

  function getProgress(player, pack, levels, progressContext = createProgressContext(levels)) {
    const completedNames = new Set((player.completionDetails || [])
      .map((completion) => normalizeLevelName(completion.name)));
    const levelBonuses = pack.levels.map((name) => {
      const points = getLevelPoints(name, progressContext.levelByName);
      return {
        name,
        completed: completedNames.has(normalizeLevelName(name)),
        points: getLevelBonus(points, progressContext.minLevelPoints, progressContext.maxLevelPoints),
      };
    });
    const completedLevels = levelBonuses
      .filter((level) => level.completed)
      .map((level) => level.name);
    const completedCount = completedLevels.length;
    const isComplete = completedCount === pack.levels.length;
    const levelBonusPoints = levelBonuses
      .filter((level) => level.completed)
      .reduce((total, level) => total + level.points, 0);
    const maxLevelBonusPoints = levelBonuses.reduce((total, level) => total + level.points, 0);
    const completionBonus = isComplete ? COMPLETION_BONUS : 0;
    return {
      completedLevels,
      completedCount,
      isComplete,
      levelBonuses,
      levelBonusPoints,
      completionBonus,
      bonusPoints: levelBonusPoints + completionBonus,
      maxBonusPoints: maxLevelBonusPoints + COMPLETION_BONUS,
    };
  }

  function getAdditionalBonusPoints(player, packs, levels, additionalLevelNames) {
    const completionDetails = Array.isArray(player.completionDetails)
      ? player.completionDetails
      : [];
    const existingNames = new Set(completionDetails.map((completion) => normalizeLevelName(completion.name)));
    const addedNames = [...new Set(additionalLevelNames
      .map((name) => String(name || "").trim())
      .filter((name) => name && !existingNames.has(normalizeLevelName(name))))];
    if (!addedNames.length) return 0;

    const baselinePoints = packs.reduce(
      (total, pack) => total + getProgress(player, pack, levels).bonusPoints,
      0
    );
    const projectedPlayer = {
      ...player,
      completionDetails: [
        ...completionDetails,
        ...addedNames.map((name) => ({ name })),
      ],
    };
    const projectedPoints = packs.reduce(
      (total, pack) => total + getProgress(projectedPlayer, pack, levels).bonusPoints,
      0
    );
    return projectedPoints - baselinePoints;
  }

  function createRouteBonusScorer(player, packs, levels) {
    const completedNames = new Set((player.completionDetails || [])
      .map((completion) => normalizeLevelName(completion.name)));
    const levelByName = new Map(levels.map((level) => [
      normalizeLevelName(level.name),
      level,
    ]));
    const allLevelPoints = levels
      .map((level) => Number(level.points))
      .filter((points) => Number.isFinite(points) && points > 0);
    const minLevelPoints = allLevelPoints.length ? Math.min(...allLevelPoints) : 0;
    const maxLevelPoints = allLevelPoints.length ? Math.max(...allLevelPoints) : 0;
    const packStates = packs.map((pack) => {
      const levelNames = new Set(pack.levels.map(normalizeLevelName));
      return {
        levelNames,
        completedCount: [...levelNames].filter((name) => completedNames.has(name)).length,
      };
    });
    const packIndexesByLevel = new Map();

    packStates.forEach((packState, packIndex) => {
      packState.levelNames.forEach((name) => {
        const indexes = packIndexesByLevel.get(name) || [];
        indexes.push(packIndex);
        packIndexesByLevel.set(name, indexes);
      });
    });

    function getLevelAward(name) {
      const normalizedName = normalizeLevelName(name);
      if (!normalizedName || completedNames.has(normalizedName)) return 0;
      let points = 0;
      for (const packIndex of packIndexesByLevel.get(normalizedName) || []) {
        const packState = packStates[packIndex];
        const levelPoints = Number(levelByName.get(normalizedName)?.points) || 0;
        points += getLevelBonus(levelPoints, minLevelPoints, maxLevelPoints);
        if (packState.completedCount + 1 === packState.levelNames.size) {
          points += COMPLETION_BONUS;
        }
      }
      return points;
    }

    function addLevel(name) {
      const normalizedName = normalizeLevelName(name);
      const bonusPoints = getLevelAward(normalizedName);
      if (!normalizedName || completedNames.has(normalizedName)) return 0;
      completedNames.add(normalizedName);
      for (const packIndex of packIndexesByLevel.get(normalizedName) || []) {
        packStates[packIndex].completedCount += 1;
      }
      return bonusPoints;
    }

    return { getLevelAward, addLevel };
  }

  function applyBonuses(players, packs, levels) {
    const progressContext = createProgressContext(levels);
    return players
      .map((player) => {
        const packProgress = packs.map((pack) => getProgress(player, pack, levels, progressContext));
        const packBonusPoints = packProgress.reduce((total, progress) => total + progress.bonusPoints, 0);

        return {
          ...player,
          basePoints: player.points,
          packBonusPoints,
          packProgress,
          points: player.points + packBonusPoints,
        };
      })
      .sort((a, b) => b.points - a.points);
  }

  function getMaxBonusPoints(pack, levels) {
    return getProgress({ completionDetails: [] }, pack, levels).maxBonusPoints;
  }

  return {
    populatePacks,
    getProgress,
    getMaxBonusPoints,
    getAdditionalBonusPoints,
    createRouteBonusScorer,
    applyBonuses,
  };
})();
