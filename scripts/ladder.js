const { useMemo, useState, useEffect } = React;
const MIN_UNVERIFIED_ROUTE_HOURS = 8 / 60;
const UNVERIFIED_BASELINE_LEVEL = "Aeternus";
const LADDER_STATE_STORAGE_KEY = "pml_ladder_state";
const ROUTE_SORT_ORDERS = new Set([
  "efficiency",
  "time",
  "points",
  "skill",
  "attempts",
  "safest",
  "hardest",
  "established",
]);

function readSavedLadderState() {
  try {
    const saved = JSON.parse(localStorage.getItem(LADDER_STATE_STORAGE_KEY) || "{}");
    return saved && typeof saved === "object" ? saved : {};
  } catch {
    return {};
  }
}

function truncateLadderLevelName(value, maxLength = 32) {
  const text = String(value ?? "");
  if (text.length <= maxLength) return text;
  return `${Array.from(text).slice(0, Math.max(0, maxLength - 3)).join("")}...`;
}

function getUnverifiedBaselineRank(estimatedNames) {
  const baselineIndex = estimatedNames.findIndex(
    name => String(name).trim().toLowerCase() === UNVERIFIED_BASELINE_LEVEL.toLowerCase()
  );
  return baselineIndex >= 0 ? baselineIndex + 1 : Infinity;
}

function isAtLeastPracticeBaseline(level, baselineLevel) {
  if (!baselineLevel) return false;
  const metrics = [
    ["length", 1.25],
    ["precision", 1.15],
    ["tps", 1.15],
  ];
  return metrics.some(([field, threshold]) => {
    const value = Number(level[field]);
    const baseline = Number(baselineLevel[field]);
    return Number.isFinite(value) && value > 0
      && Number.isFinite(baseline) && baseline > 0
      && value >= baseline * threshold;
  });
}

function applyUnverifiedMinimumTime(recommendations, unverifiedOnly) {
  if (!unverifiedOnly) return recommendations;
  return recommendations.filter(level => level.expectedHours >= MIN_UNVERIFIED_ROUTE_HOURS);
}

function applyFullListPointValues(recommendations, targetPlayer) {
  if (!targetPlayer?.isFullList) return recommendations;
  return recommendations.map(recommendation => {
    const basePoints = Number(recommendation.basePoints) || 0;
    if (recommendation.isRebeat) return recommendation;
    const variantMultiplier = recommendation.isVariant
      ? Number(recommendation.variantMultiplier) || 1
      : 1;
    const projectedPoints = basePoints * variantMultiplier;
    return {
      ...recommendation,
      projectedMult: 1,
      rawProjectedPoints: basePoints,
      effectiveBasePoints: projectedPoints,
      projectedPoints,
      projectedPointsLower: projectedPoints,
      projectedPointsUpper: projectedPoints,
      expectedValue: projectedPoints / Math.max(recommendation.expectedHours || 1, 0.001),
    };
  });
}

function compareRouteValues(a, b, ascending) {
  const aHasValue = a !== null && a !== undefined && Number.isFinite(Number(a));
  const bHasValue = b !== null && b !== undefined && Number.isFinite(Number(b));
  if (!aHasValue && !bHasValue) return 0;
  if (!aHasValue) return 1;
  if (!bHasValue) return -1;
  return (Number(a) - Number(b)) * (ascending ? 1 : -1);
}

function getSafestRouteValue(recommendation) {
  const points = Number.isFinite(recommendation.projectedPointsLower)
    ? recommendation.projectedPointsLower
    : Number(recommendation.projectedPoints) || 0;
  const hours = Number.isFinite(recommendation.expectedHoursUpper)
    ? recommendation.expectedHoursUpper
    : Number(recommendation.expectedHours) || 1;
  return points / Math.max(hours, 0.001);
}

function compareRouteRecommendations(a, b, sortOrder, ascending) {
  const comparePrimary = (aValue, bValue) => compareRouteValues(aValue, bValue, ascending);
  const comparePoints = () => compareRouteValues(a.projectedPoints, b.projectedPoints, false);
  const compareValue = () => compareRouteValues(a.expectedValue, b.expectedValue, false);
  const compareName = () => String(a.level || "").localeCompare(String(b.level || ""));

  if (sortOrder === "time") {
    return comparePrimary(a.expectedHours, b.expectedHours) || compareValue() || compareName();
  }
  if (sortOrder === "attempts") {
    return comparePrimary(a.expectedAttempts, b.expectedAttempts) || compareValue() || compareName();
  }
  if (sortOrder === "points") {
    return comparePrimary(a.projectedPoints, b.projectedPoints) || compareValue() || compareName();
  }
  if (sortOrder === "skill") {
    return comparePrimary(a.skillFit ?? 1, b.skillFit ?? 1) || comparePoints() || compareName();
  }
  if (sortOrder === "safest") {
    return comparePrimary(getSafestRouteValue(a), getSafestRouteValue(b)) || compareValue() || compareName();
  }
  if (sortOrder === "hardest") {
    return comparePrimary(a.effectiveBasePoints ?? a.basePoints ?? a.points, b.effectiveBasePoints ?? b.basePoints ?? b.points)
      || compareRouteValues(a.rank, b.rank, true)
      || compareName();
  }
  if (sortOrder === "established") {
    return comparePrimary(a.victorCount, b.victorCount)
      || comparePrimary(a.wrConfidence, b.wrConfidence)
      || compareValue()
      || compareName();
  }
  return comparePrimary(a.expectedValue, b.expectedValue) || comparePoints() || compareName();
}

function buildSortedRoute(recommendations, sortOrder, ascending, pointsNeeded, lockedLevelIds, removedLevelIds, currentPlayer, allLevels) {
  const sortRecommendations = (a, b) => compareRouteRecommendations(a, b, sortOrder, ascending);
  const lockedIds = new Set(lockedLevelIds.map(id => String(id).trim().toLowerCase()));
  const removedIds = new Set(removedLevelIds.map(id => String(id).trim().toLowerCase()));
  const orderedRecommendations = [...recommendations]
    .filter(rec => {
      const id = String(rec.id || rec.level).trim().toLowerCase();
      return lockedIds.has(id) || !removedIds.has(id);
    })
    .sort((a, b) => {
      const aLocked = lockedIds.has(String(a.id || a.level).trim().toLowerCase());
      const bLocked = lockedIds.has(String(b.id || b.level).trim().toLowerCase());
      return Number(bLocked) - Number(aLocked) || sortRecommendations(a, b);
    });
  const route = [];
  const plannedVariantNames = [];
  const variantContext = VariantUtils.createPlayerContext(currentPlayer, allLevels);
  let routePoints = 0;
  for (const recommendation of orderedRecommendations) {
    if (pointsNeeded <= 0) break;
    let variantMultiplier = 1;
    if (recommendation.isVariant) {
      variantMultiplier = recommendation.isRebeat
        ? Number(recommendation.variantMultiplier) || 1
        : VariantUtils.getNextVariantMultiplier(
        currentPlayer,
        { name: recommendation.level },
        allLevels,
        plannedVariantNames,
        variantContext,
        );
    }
    const projectedPoints = recommendation.isVariant && !recommendation.isRebeat
      ? (Number(recommendation.rawProjectedPoints ?? recommendation.projectedPoints) || 0) * variantMultiplier
      : Number(recommendation.projectedPoints) || 0;
    const pointUncertainty = Number(recommendation.pointUncertainty) || 0;
    route.push({
      ...recommendation,
      projectedPoints,
      projectedPointsLower: projectedPoints * (1 - pointUncertainty),
      projectedPointsUpper: projectedPoints * (1 + pointUncertainty),
      expectedValue: projectedPoints / Math.max(recommendation.expectedHours || 1, 0.001),
      variantMultiplier,
    });
    routePoints += projectedPoints;
    if (recommendation.isVariant && !recommendation.isRebeat) {
      plannedVariantNames.push(recommendation.level);
    }
    if (routePoints >= pointsNeeded) break;
  }
  return route;
}

function getFullListRouteTarget(targetPlayer, currentPlayer, levels, scoringLevels, packCatalog) {
  if (!targetPlayer?.isFullList || !currentPlayer) return targetPlayer;
  const completedLevels = new Set(currentPlayer.levels);
  const remainingLevels = (Array.isArray(levels) ? levels : [])
    .filter(level => !completedLevels.has(level.name));
  const plannedVariantNames = [];
  const variantContext = VariantUtils.createPlayerContext(currentPlayer, levels);
  const remainingPoints = remainingLevels.reduce((total, level) => {
    const variantMultiplier = level.isVariant
      ? VariantUtils.getNextVariantMultiplier(
        currentPlayer,
        level,
        levels,
        plannedVariantNames,
        variantContext,
      )
      : 1;
    if (level.isVariant) plannedVariantNames.push(level.name);
    return total + (Number(level.points) || 0) * variantMultiplier;
  }, 0);
  const packBonusScorer = PackUtils.createRouteBonusScorer(
    currentPlayer,
    packCatalog,
    scoringLevels,
  );
  const remainingPackBonus = remainingLevels.reduce(
    (total, level) => total + packBonusScorer.addLevel(level.name),
    0,
  );
  return {
    ...targetPlayer,
    points: currentPlayer.points + remainingPoints + remainingPackBonus - 0.01,
  };
}

function App() {
  const [savedLadderState] = useState(readSavedLadderState);
  const [status, setStatus] = useState("loading");
  const [errorMsg, setErrorMsg] = useState("");
  const [levels, setLevels] = useState([]);
  const [verifiedLevels, setVerifiedLevels] = useState([]);
  const [unverifiedLevels, setUnverifiedLevels] = useState([]);
  const [ladderSources, setLadderSources] = useState(null);
  const [includeUnverified, setIncludeUnverified] = useState(
    typeof savedLadderState.includeUnverified === "boolean" ? savedLadderState.includeUnverified : false
  );
  const [unverifiedOnly, setUnverifiedOnly] = useState(
    typeof savedLadderState.unverifiedOnly === "boolean" ? savedLadderState.unverifiedOnly : false
  );
  const [useFullSecretList, setUseFullSecretList] = useState(
    typeof savedLadderState.useFullSecretList === "boolean" ? savedLadderState.useFullSecretList : false
  );
  const [includeRebeats, setIncludeRebeats] = useState(
    typeof savedLadderState.includeRebeats === "boolean" ? savedLadderState.includeRebeats : false
  );
  const [rebeatsOnly, setRebeatsOnly] = useState(
    typeof savedLadderState.rebeatsOnly === "boolean" ? savedLadderState.rebeatsOnly : false
  );
  const [selectedPlayer, setSelectedPlayer] = useState("");
  const [targetPlayerName, setTargetPlayerName] = useState("");
  const [lockedLevelIds, setLockedLevelIds] = useState([]);
  const [removedLevelIds, setRemovedLevelIds] = useState([]);
  const [excludeTwoPlayer, setExcludeTwoPlayer] = useState(
    typeof savedLadderState.excludeTwoPlayer === "boolean" ? savedLadderState.excludeTwoPlayer : true
  );
  const initialRouteSortOrder = ROUTE_SORT_ORDERS.has(savedLadderState.routeSortOrder)
    ? savedLadderState.routeSortOrder
    : "efficiency";
  const [routeSortOrder, setRouteSortOrder] = useState(
    initialRouteSortOrder
  );
  const [routeSortAscending, setRouteSortAscending] = useState(
    typeof savedLadderState.routeSortAscending === "boolean"
      ? savedLadderState.routeSortAscending
      : ["time", "attempts"].includes(initialRouteSortOrder)
  );
  const [showAllSortedLevels, setShowAllSortedLevels] = useState(false);
  const [showAllRatioExposure, setShowAllRatioExposure] = useState(false);

  useEffect(() => {
    try {
      localStorage.setItem(LADDER_STATE_STORAGE_KEY, JSON.stringify({
        includeUnverified,
        unverifiedOnly,
        useFullSecretList,
        includeRebeats,
        rebeatsOnly,
        excludeTwoPlayer,
        routeSortOrder,
        routeSortAscending,
      }));
    } catch {
    }
  }, [includeUnverified, unverifiedOnly, useFullSecretList, includeRebeats, rebeatsOnly, excludeTwoPlayer, routeSortOrder, routeSortAscending]);

  useEffect(() => {
    loadLadderData()
      .then(sources => {
        setLadderSources(sources);
        setStatus("ready");
      })
      .catch(err => {
        setErrorMsg(err.name === "AbortError"
          ? "Request timed out. Make sure the ladder data files are in the same folder."
          : `Failed to load ladder data: ${err.message}`);
        setStatus("error");
      });
  }, []);

  const processedVerified = useMemo(
    () => ladderSources ? processRawData(ladderSources.verified) : [],
    [ladderSources]
  );
  const rankableVerifiedLevels = useMemo(
    () => processedVerified.filter(level => !level.isVariant),
    [processedVerified]
  );

  const processedUnverified = useMemo(() => {
    if (!ladderSources) return [];
    const unverifiedData = getPreparedUnverifiedData(
      ladderSources.verifications,
      ladderSources.estimatedNames,
      ladderSources.verified,
      useFullSecretList,
    );
    return processRawData(
      unverifiedData,
      {
        preserveDistinctIds: true,
        calibrationLevels: rankableVerifiedLevels,
        estimatedNames: ladderSources.estimatedNames,
      },
    );
  }, [ladderSources, useFullSecretList, processedVerified, rankableVerifiedLevels]);

  const packCatalog = useMemo(() => {
    const packs = Object.keys(PACK_COLORS)
      .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }))
      .map(name => ({ name, levels: [] }));
    PackUtils.populatePacks(packs, [
      ...processedVerified,
      ...processedUnverified,
    ]);
    return packs;
  }, [processedVerified, processedUnverified]);

  useEffect(() => {
    if (!ladderSources) return;
    const baselineRank = getUnverifiedBaselineRank(ladderSources.estimatedNames);
    const baselineLevel = processedVerified.find(
      level => String(level.name).trim().toLowerCase() === UNVERIFIED_BASELINE_LEVEL.toLowerCase()
    );
    const listWorthyUnverified = processedUnverified.filter(
      level => (level._difficultyRank || Infinity) <= baselineRank
        || isAtLeastPracticeBaseline(level, baselineLevel)
    );
    setVerifiedLevels(processedVerified);
    setUnverifiedLevels(listWorthyUnverified);
    setLevels(includeUnverified ? [...processedVerified, ...processedUnverified] : processedVerified);
    clearModifications();
  }, [ladderSources, includeUnverified, processedVerified, processedUnverified]);

  const leaderboard = useMemo(() => {
    const fullList = buildFullListLeaderboardEntry(levels);
    const players = PackUtils.applyBonuses(buildLeaderboard(verifiedLevels), packCatalog, verifiedLevels);
    const scoredFullList = fullList
      ? PackUtils.applyBonuses([fullList], packCatalog, levels)[0]
      : null;
    return scoredFullList ? [scoredFullList, ...players] : players;
  }, [levels, verifiedLevels, packCatalog]);

  const rankedPlayers = useMemo(
    () => leaderboard.filter(player => player.isFullList !== true),
    [leaderboard]
  );

  const filteredLevelsWithout2P = useMemo(
    () => levels.filter(level => !level.is2Player),
    [levels]
  );

  const rankableLevels = useMemo(
    () => verifiedLevels.filter(level => !level.isVariant),
    [verifiedLevels]
  );
  const avgTimePerPoint = useMemo(() => calculateAvgTimePerPoint(rankableLevels), [rankableLevels]);
  const avgAttemptsPerPoint = useMemo(() => calculateAvgAttemptsPerPoint(rankableLevels), [rankableLevels]);
  const maxPoints = useMemo(() => Math.max(...rankableLevels.map(l => l.points), 1), [rankableLevels]);

  const routeLevels = useMemo(() => {
    if (unverifiedOnly) return unverifiedLevels;
    if (!includeUnverified) return verifiedLevels;

    const availableUnverifiedLevels = targetPlayerName === "Full List"
      ? processedUnverified
      : unverifiedLevels;
    const verifiedKeys = new Set(
      verifiedLevels.map(level => String(level.id || level.name).trim().toLowerCase())
    );
    return [
      ...verifiedLevels,
      ...availableUnverifiedLevels.filter(level => {
        const key = String(level.id || level.name).trim().toLowerCase();
        return !verifiedKeys.has(key);
      }),
    ];
  }, [unverifiedOnly, includeUnverified, targetPlayerName, verifiedLevels, unverifiedLevels, processedUnverified]);

  useEffect(() => {
    if (!ladderSources) return;
    if (leaderboard.length === 0) {
      setSelectedPlayer("");
      setTargetPlayerName("");
      return;
    }
    if (rankedPlayers.length === 0) {
      setSelectedPlayer("");
      setTargetPlayerName("");
      return;
    }

    const selectedIsValid = rankedPlayers.some(p => p.name === selectedPlayer);
    const targetIsValid = leaderboard.some(p => p.name === targetPlayerName) && targetPlayerName !== selectedPlayer;

    if (rankedPlayers.length === 1) {
      if (!selectedIsValid) {
        setSelectedPlayer(rankedPlayers[0].name);
      }
      if (targetPlayerName) {
        setTargetPlayerName("");
      }
      return;
    }

    if (!selectedIsValid) {
      setSelectedPlayer(rankedPlayers[1].name || rankedPlayers[0].name);
      return;
    }

    if (!targetIsValid) {
      setTargetPlayerName(rankedPlayers.find(player => player.name !== selectedPlayer)?.name || "");
    }
  }, [leaderboard, rankedPlayers, selectedPlayer, targetPlayerName]);

  function handleSelectPlayer(name) {
    setSelectedPlayer(name);
    if (targetPlayerName === name) {
      setTargetPlayerName(rankedPlayers.find(player => player.name !== name)?.name || "");
    }
  }

  function handleSetTarget(name) {
    if (name === selectedPlayer) return;
    setTargetPlayerName(name);
  }

  function toggleLevelLocked(levelId) {
    setLockedLevelIds(prev =>
      prev.includes(levelId)
        ? prev.filter(id => id !== levelId)
        : [...prev, levelId]
    );
  }

  function toggleLevelRemoved(levelId) {
    setRemovedLevelIds(prev =>
      prev.includes(levelId)
        ? prev.filter(id => id !== levelId)
        : [...prev, levelId]
    );
  }

  function clearModifications() {
    setLockedLevelIds([]);
    setRemovedLevelIds([]);
  }

  function toggleTwoPlayerLevels() {
    setExcludeTwoPlayer(prev => !prev);
  }

  function toggleRebeats() {
    setIncludeRebeats(prev => !prev);
  }

  function toggleRebeatsOnly() {
    setRebeatsOnly(prev => {
      const next = !prev;
      if (next) setIncludeRebeats(true);
      return next;
    });
  }

  function toggleIncludeUnverified(event) {
    if (event.shiftKey) setUseFullSecretList(prev => !prev);
    setIncludeUnverified(prev => !prev);
    if (includeUnverified) setUnverifiedOnly(false);
  }

  function toggleUnverifiedOnly(event) {
    if (event.shiftKey) setUseFullSecretList(prev => !prev);
    setUnverifiedOnly(prev => !prev);
    if (!unverifiedOnly) setIncludeUnverified(true);
  }

  const currentPlayer = useMemo(
    () => leaderboard.find(p => p.name === selectedPlayer) || null,
    [leaderboard, selectedPlayer]
  );

  const skillComponents = useMemo(
    () => (currentPlayer ? calculateSkillComponents(verifiedLevels, currentPlayer.name) : {
      speed: 1,
      attempts: 1,
      precision: 1,
      highTps: 1,
      endurance: 1,
      coordination: 1,
      consistency: 1,
      gamemodes: {},
      speedModes: {},
      ratioScore: 1,
      ratioGamemodeSkill: null,
      ratioSpeedSkill: null,
      dualSkill: null,
      inverseMirrorSkill: null,
      mirrorSwitching: null,
      ratioExposure: { levels: 0, modes: {}, speeds: {}, dualPercent: 0, inversePercent: 0, mirrorSwitches: 0 },
    }),
    [verifiedLevels, currentPlayer]
  );

  const skillMetrics = useMemo(() => [
    ["Dual", skillComponents.dualSkill],
    ["2 Player Coordination", skillComponents.coordination],
    ["High TPS Control", skillComponents.highTps],
    ["Precision", skillComponents.precision],
    ["Time", skillComponents.speed, true],
    ["Attempts", skillComponents.attempts, true],
    ["Endurance", skillComponents.endurance],
    ...Object.entries(skillComponents.gamemodes || {})
      .map(([mode, skill]) => [GAMEMODE_RATIO_NAMES[mode] || mode, skill]),
    ...Object.entries(skillComponents.speedModes || {})
      .map(([speed, skill]) => [speed, skill]),
    ["Mirror Switching", skillComponents.mirrorSwitching],
  ].filter(([, skill]) => Number.isFinite(skill) && skill > 0)
    .map(([name, skill, lowerIsBetter = false]) => ({
      name,
      skill,
      lowerIsBetter,
      displaySkill: name === "Time"
        ? 1 + skill
        : name === "Attempts"
          ? 2 - skill
          : skill,
    }))
    .sort((left, right) => right.displaySkill - left.displaySkill), [skillComponents]);

  const ratioExposureSummary = useMemo(() => {
    const exposure = skillComponents.ratioExposure;
    const datasetRatioLevels = verifiedLevels.filter(level => String(level?.ratio || "").trim()).length;
    if (!exposure?.levels) {
      return {
        levels: 0,
        items: [],
        emptyMessage: datasetRatioLevels
          ? `No matching completions (${datasetRatioLevels} levels in dataset)`
          : "No Ratio data loaded",
      };
    }

    const items = [
      ...Object.values(exposure.modes || {}).map(mode => ({
        key: `mode-${mode.name}`,
        name: mode.name,
        percent: (mode.percent / exposure.levels) * 100,
      })),
      ...Object.entries(exposure.speeds || {}).map(([speed, percent]) => ({
        key: `speed-${speed}`,
        name: speed,
        percent: (percent / exposure.levels) * 100,
      })),
      {
        key: "dual",
        name: "Dual",
        percent: exposure.dualPercent / exposure.levels * 100,
      },
      {
        key: "inverse",
        name: "Inverse Mirror",
        percent: exposure.inversePercent / exposure.levels * 100,
      },
      {
        key: "mirrors",
        name: "Mirrors",
        percent: exposure.mirrorSwitches / exposure.levels * 100,
        value: `${(exposure.mirrorSwitches / exposure.levels).toFixed(1)}/level`,
      },
    ].sort((left, right) => right.percent - left.percent);

    return {
      levels: exposure.levels,
      items,
    };
  }, [skillComponents]);

  const skillMultiplier = useMemo(
    () => (currentPlayer ? calculatePlayerSkill(verifiedLevels, currentPlayer.name) : 1),
    [verifiedLevels, currentPlayer]
  );

  const renderSkillExposure = (items, showAll, setShowAll, collapsible = true) => {
    if (!items.length) return null;
    const strongestSkill = Math.max(...items.map(item => item.displaySkill ?? item.skill), 1);
    const visibleItems = !collapsible || showAll ? items : items.slice(0, 4);

    return (
      <div className="optimizer-skill-summary-section">
        <div className="optimizer-skill-exposure">
        <div className="optimizer-skill-exposure-list">
          {visibleItems.map(item => (
            <div
              className={`optimizer-skill-exposure-row optimizer-skill-metric-${classifySkill(item.displaySkill ?? item.skill).toLowerCase().replaceAll(" ", "-")}`}
              key={item.key || item.name}
            >
              <span>{item.name}</span>
              <div className="optimizer-skill-exposure-bar" aria-hidden="true">
                <span
                  style={{
                    width: `${Math.min(((item.displaySkill ?? item.skill) / strongestSkill) * 100, 100)}%`,
                    backgroundColor: `hsl(${Math.round(Math.min(Math.max(((item.displaySkill ?? item.skill) - 0.55) / 0.95, 0), 1) * 270)}, 75%, 60%)`,
                  }}
                ></span>
              </div>
              <strong>{formatSkillPercent(item.displaySkill ?? item.skill)}</strong>
            </div>
          ))}
        </div>
        {collapsible && items.length > 4 && (
          <button
            className="optimizer-skill-exposure-toggle"
            type="button"
            aria-expanded={showAll}
            onClick={() => setShowAll(previous => !previous)}
          >
            {showAll ? "Show less" : `Show ${items.length - 4} more`}
          </button>
        )}
        </div>
      </div>
    );
  };

  const targetPlayer = useMemo(
    () => leaderboard.find(p => p.name === targetPlayerName) || null,
    [leaderboard, targetPlayerName]
  );

  const routeTargetPlayer = useMemo(
    () => getFullListRouteTarget(targetPlayer, currentPlayer, levels, verifiedLevels, packCatalog),
    [targetPlayer, currentPlayer, levels, verifiedLevels, packCatalog]
  );

  const baseRecommendationsWith2P = useMemo(
    () => applyUnverifiedMinimumTime(
      buildRecommendations(
        routeLevels,
        currentPlayer,
        avgTimePerPoint,
        avgAttemptsPerPoint,
        maxPoints,
        routeLevels,
        verifiedLevels,
        includeRebeats || rebeatsOnly,
      ).filter(level => !rebeatsOnly || level.isRebeat),
      unverifiedOnly,
    ),
    [routeLevels, currentPlayer, avgTimePerPoint, avgAttemptsPerPoint, maxPoints, verifiedLevels, unverifiedOnly, includeRebeats, rebeatsOnly]
  );
  const recommendationsWith2P = useMemo(
    () => applyFullListPointValues(baseRecommendationsWith2P, targetPlayer),
    [baseRecommendationsWith2P, targetPlayer]
  );

  const recommendationsWithout2P = useMemo(
    () => applyUnverifiedMinimumTime(
      recommendationsWith2P.filter(level => !level.is2Player),
      unverifiedOnly,
    ),
    [recommendationsWith2P, unverifiedOnly]
  );

  const recommendations = excludeTwoPlayer ? recommendationsWithout2P : recommendationsWith2P;

  const combinedRouteLevels = useMemo(() => {
    const verifiedKeys = new Set(
      verifiedLevels.map(level => String(level.id || level.name).trim().toLowerCase())
    );
    return [
      ...verifiedLevels,
      ...unverifiedLevels.filter(level => {
        const key = String(level.id || level.name).trim().toLowerCase();
        return !verifiedKeys.has(key);
      }),
    ];
  }, [verifiedLevels, unverifiedLevels]);

  const rankTargetPoints = targetRankSurpassPoints(leaderboard, routeTargetPlayer);
  const initialPointsNeeded = Math.max(0, rankTargetPoints - (currentPlayer?.points || 0));


  const optimized = useMemo(
    () => optimizeRouteWithProjectedTarget(
      recommendations,
      routeTargetPlayer,
      routeLevels,
      currentPlayer?.points || 0,
      lockedLevelIds,
      removedLevelIds,
      currentPlayer,
      avgTimePerPoint,
      avgAttemptsPerPoint,
      maxPoints,
      verifiedLevels,
      packCatalog,
    ),
    [recommendations, routeTargetPlayer, routeLevels, currentPlayer, avgTimePerPoint, avgAttemptsPerPoint, maxPoints, verifiedLevels, packCatalog, lockedLevelIds, removedLevelIds],
  );
  const pointsNeeded = optimized?.pointsNeeded ?? initialPointsNeeded;
  const optimizedPicks = optimized?.picks || [];

  const projectedPath = useMemo(
    () => {
      if (routeSortOrder === "efficiency") {
        return [...optimizedPicks].sort((a, b) =>
          compareRouteRecommendations(a, b, routeSortOrder, routeSortAscending)
        );
      }
      return buildSortedRoute(
        recommendations,
        routeSortOrder,
        routeSortAscending,
        pointsNeeded,
        lockedLevelIds,
        removedLevelIds,
        currentPlayer,
        routeLevels,
      );
    },
    [optimizedPicks, recommendations, routeSortOrder, routeSortAscending, pointsNeeded, lockedLevelIds, removedLevelIds]
  );
  const allSortedLevels = useMemo(
    () => buildSortedRoute(
      recommendations,
      routeSortOrder,
      routeSortAscending,
      Number.POSITIVE_INFINITY,
      lockedLevelIds,
      removedLevelIds,
      currentPlayer,
      routeLevels,
    ),
    [recommendations, routeSortOrder, routeSortAscending, lockedLevelIds, removedLevelIds, currentPlayer, routeLevels]
  );
  const displayedPath = showAllSortedLevels ? allSortedLevels : projectedPath;
  const fallbackRoute = optimized?.fallback || false;
  const totalPoints = projectedPath.reduce((total, pick) => total + pick.projectedPoints, 0);
  const totalHours = projectedPath.reduce((total, pick) => total + pick.expectedHours, 0);
  const targetRank = rankedPlayers.findIndex(player => player.name === targetPlayerName) + 1;

  if (status === "loading") {
    return (
      <div className="optimizer-shell-center">
        <div className="optimizer-loading-card">
          <div className="optimizer-spinner"></div>
          <p>Loading levels.jsonâ€¦</p>
        </div>
      </div>
    );
  }

  if (status === "error") {
    return (
      <div className="optimizer-shell-center">
        <div className="optimizer-error-card">
          <div className="optimizer-error-icon">âš </div>
          <p className="optimizer-error-title">Could not load data</p>
          <p>{errorMsg}</p>
          <p className="optimizer-error-help">
            Make sure <code>ladder.html</code> is at the site root, <code>levels.json</code> is in <code>data/</code>, and the site is served over HTTP.
          </p>
        </div>
      </div>
    );
  }

  let leaderboardRank = 0;
  return (
    <div className="optimizer-two-column-layout">
      <section className="optimizer-card">
        <div className="optimizer-card-head">
          <h2>Leaderboard</h2>
          <div className="optimizer-legend">
            <span className="optimizer-legend-item"><span className="optimizer-dot optimizer-dot-you"></span>You</span>
            <span className="optimizer-legend-item"><span className="optimizer-dot optimizer-dot-target"></span>Target</span>
          </div>
        </div>
        {leaderboard.length === 0 ? (
          <div className="optimizer-empty">No player data found in levels.json.</div>
        ) : (
          <div className="optimizer-player-grid">
            {leaderboard.map((player) => {
              const isFullList = player.isFullList === true;
            const playerRank = isFullList ? 0 : ++leaderboardRank;
              const isMe = player.name === selectedPlayer;
              const isTarget = player.name === targetPlayerName;
              return (
                <div
                  key={player.name}
                  className={`optimizer-player-card ${isFullList ? "optimizer-full-list-card" : ""} ${isMe && isTarget ? "optimizer-player-card-active" : isMe ? "optimizer-player-card-me" : isTarget ? "optimizer-player-card-target" : ""}`}
                >
                  <div className="optimizer-player-main">
                    <div className="optimizer-player-name">
                      {!isFullList && <span className="optimizer-rank">#{playerRank}</span>}
                      {isFullList && <span className="optimizer-full-list-icon" aria-hidden="true">▦</span>}
                      {isFullList ? "The Practice Mode List" : player.name}
                    </div>
                    <div className="optimizer-player-meta">
                      {player.levels.length} • {player.points.toFixed(1)} pts
                    </div>
                  </div>
                  <div className="optimizer-player-actions">
                    {!isFullList && (
                      <button
                        onClick={() => handleSelectPlayer(player.name)}
                        className={`optimizer-action-btn ${isMe ? "optimizer-action-btn-me" : "optimizer-action-btn-default"}`}
                      >
                        Me
                      </button>
                    )}
                    <button
                      onClick={() => handleSetTarget(player.name)}
                      disabled={isMe}
                      className={`optimizer-action-btn ${isTarget ? "optimizer-action-btn-target" : isMe ? "optimizer-action-btn-disabled" : "optimizer-action-btn-default"}`}
                    >
                      {isFullList ? "Target list" : "Target"}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {currentPlayer && (
        <section className="optimizer-card">
          <div className="optimizer-card-head optimizer-card-head-stack">
            <h2>{showAllSortedLevels ? "All Eligible Levels" : routeSortOrder === "efficiency" ? "Optimal Route" : "Available Levels"}</h2>
            {targetPlayer ? (
              <span className="optimizer-target-caption">
                <span>Targeting </span>
                <span className="optimizer-target-name">
                  {targetPlayer.isFullList ? "Full List" : `#${targetRank} ${targetPlayer.name}`}
                </span>
                <span> - {targetPlayer.points.toFixed(1)} pts</span>
              </span>
            ) : (
              <span className="optimizer-target-caption">No target selected</span>
            )}
          </div>
          <div className="optimizer-toggle-group">
            <div className="optimizer-toggle-row">
              <span className="optimizer-toggle-label">Include unverified levels</span>
              <button
                type="button"
                className={`optimizer-toggle ${includeUnverified ? "active" : ""}`}
                onClick={toggleIncludeUnverified}
                aria-pressed={includeUnverified}
              >
                <span className="optimizer-toggle-track">
                  <span className="optimizer-toggle-thumb" />
                </span>
                <span className="optimizer-toggle-text">{includeUnverified ? "On" : "Off"}</span>
              </button>
            </div>
            <div className="optimizer-toggle-row">
              <span className="optimizer-toggle-label">Unverified levels only</span>
              <button
                type="button"
                className={`optimizer-toggle ${unverifiedOnly ? "active" : ""}`}
                onClick={toggleUnverifiedOnly}
                aria-pressed={unverifiedOnly}
              >
                <span className="optimizer-toggle-track">
                  <span className="optimizer-toggle-thumb" />
                </span>
                <span className="optimizer-toggle-text">{unverifiedOnly ? "On" : "Off"}</span>
              </button>
            </div>
            <div className="optimizer-toggle-row">
              <span className="optimizer-toggle-label">Exclude 2-player levels</span>
              <button
                type="button"
                className={`optimizer-toggle ${excludeTwoPlayer ? "active" : ""}`}
                onClick={toggleTwoPlayerLevels}
              >
                <span className="optimizer-toggle-track">
                  <span className="optimizer-toggle-thumb" />
                </span>
                <span className="optimizer-toggle-text">{excludeTwoPlayer ? "On" : "Off"}</span>
              </button>
            </div>
            <div className="optimizer-toggle-row">
              <span className="optimizer-toggle-label">Include rebeats</span>
              <button
                type="button"
                className={`optimizer-toggle ${includeRebeats ? "active" : ""}`}
                onClick={toggleRebeats}
                aria-pressed={includeRebeats}
              >
                <span className="optimizer-toggle-track">
                  <span className="optimizer-toggle-thumb" />
                </span>
                <span className="optimizer-toggle-text">{includeRebeats ? "On" : "Off"}</span>
              </button>
            </div>
            <div className="optimizer-toggle-row">
              <span className="optimizer-toggle-label">Rebeats only</span>
              <button
                type="button"
                className={`optimizer-toggle ${rebeatsOnly ? "active" : ""}`}
                onClick={toggleRebeatsOnly}
                aria-pressed={rebeatsOnly}
              >
                <span className="optimizer-toggle-track">
                  <span className="optimizer-toggle-thumb" />
                </span>
                <span className="optimizer-toggle-text">{rebeatsOnly ? "On" : "Off"}</span>
              </button>
            </div>
          </div>
          <div className="optimizer-stats-grid">
            <div className="optimizer-stat-box">
              <span className="optimizer-stat-label">Your Points</span>
              <span className="optimizer-stat-value">
                {currentPlayer.points.toFixed(1)}
              </span>
            </div>
            <div className="optimizer-stat-box">
              <span className="optimizer-stat-label">Points Needed</span>
              <span className="optimizer-stat-value">{pointsNeeded.toFixed(1)}</span>
            </div>
            <div className="optimizer-stat-box">
              <span className="optimizer-stat-label">Route Gain</span>
              <span className="optimizer-stat-value">{totalPoints.toFixed(1)}</span>
            </div>
            <div className="optimizer-stat-box">
              <span className="optimizer-stat-label">Levels in Route</span>
              <span className="optimizer-stat-value">{projectedPath.length}</span>
            </div>
            <div className="optimizer-stat-box">
              <span className="optimizer-stat-label">Est. Time</span>
              <span className="optimizer-stat-value">{formatHours(totalHours)}</span>
            </div>
          </div>
          <div className="optimizer-route-sort">
            <label htmlFor="optimizer-route-sort-order">Sort by</label>
            <select
              id="optimizer-route-sort-order"
              className="form-select"
              value={routeSortOrder}
              onChange={event => {
                const nextSortOrder = event.target.value;
                setRouteSortOrder(nextSortOrder);
                setRouteSortAscending(["time", "attempts"].includes(nextSortOrder));
                setShowAllSortedLevels(false);
              }}
            >
              <option value="efficiency">Efficiency</option>
              <option value="time">Predicted time</option>
              <option value="attempts">Predicted attempts</option>
              <option value="safest">Safest value</option>
              <option value="points">Adjusted points</option>
              <option value="skill">Best skill fit</option>
              <option value="hardest">Hardest first</option>
              <option value="established">Established</option>
            </select>
            <button
              type="button"
              className="ebtn ebtn-ghost ebtn-sm"
              aria-label={`Sort ${routeSortAscending ? "ascending" : "descending"}; click to reverse`}
              aria-pressed={routeSortAscending}
              title="Reverse the current sort order"
              onClick={() => setRouteSortAscending(ascending => !ascending)}
            >
              {routeSortAscending ? "Ascending" : "Descending"}
            </button>
            {allSortedLevels.length > projectedPath.length && (
              <button
                type="button"
                className="ebtn ebtn-ghost ebtn-sm"
                aria-expanded={showAllSortedLevels}
                aria-label={showAllSortedLevels ? "Collapse full level list" : "Expand full level list"}
                onClick={() => setShowAllSortedLevels(expanded => !expanded)}
              >
                {showAllSortedLevels
                  ? "Collapse list"
                  : `Expand list (+${allSortedLevels.length - projectedPath.length})`}
              </button>
            )}
          </div>
          {displayedPath.length === 0 ? (
            <div className="optimizer-empty">
              {!targetPlayer
                ? "Select a target player to generate a route."
                : pointsNeeded === 0
                  ? `${currentPlayer.name} already meets or exceeds ${targetPlayer.name}'s score.`
                  : routeSortOrder !== "efficiency"
                    ? "No eligible levels are available."
                    : "No route was generated for the selected target."}
            </div>
          ) : (
            <>
              <div className="optimizer-table-wrap">
                <table className="optimizer-table">
                  <thead>
                    <tr>
                      <th style={{width: "60px"}}>Actions</th>
                      <th style={{width: "60px"}}>Rank</th>
                      <th>Level</th>
                      <th>Victors</th>
                      <th colSpan="2" style={{textAlign: "center"}}>Points</th>
                      <th>Est. Time</th>
                      <th>Est. Attempts</th>
                      <th colSpan="2" style={{textAlign: "center"}}>World Record Estimate</th>
                      <th>Efficiency</th>
                    </tr>
                    <tr className="optimizer-table-subheader">
                      <th></th>
                      <th></th>
                      <th></th>
                      <th></th>
                      <th>Base</th>
                      <th>Adjusted</th>
                      <th></th>
                      <th></th>
                      <th>Time</th>
                      <th>Attempts</th>
                      <th>(pts/hr)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {displayedPath.map((rec, idx) => {
                      const recId = String(rec.id || rec.level);
                      const isLocked = lockedLevelIds.includes(recId);
                      const isRemoved = removedLevelIds.includes(recId);
                      const keyVal = `${recId}-${idx}`;
                      const rankLabel = rec.isVariant
                        ? `Variant of ${rec.variantParentName}`
                        : rec.isUnverified
                          ? Number.isFinite(rec.estimatedMainListRankRange?.estimatedRank)
                            ? `#${Math.round(rec.estimatedMainListRankRange.estimatedRank)}~`
                            : rec.estimatedMainListRankRange
                              ? rec.estimatedMainListRankRange.min === rec.estimatedMainListRankRange.max
                                ? `#${rec.estimatedMainListRankRange.min}~`
                                : `#${rec.estimatedMainListRankRange.min}-${rec.estimatedMainListRankRange.max}~`
                              : rec.estimatedMainListRank ? `#${rec.estimatedMainListRank}~` : "—"
                          : rec.rank ? `#${rec.rank}` : "—";
                      return (
                        <tr key={keyVal} style={{opacity: isRemoved ? 0.5 : 1}}>
                          <td style={{display: "flex", gap: "4px", justifyContent: "center"}}>
                            <button
                              onClick={() => toggleLevelLocked(recId)}
                              title={isLocked ? "Unlock this level" : "Lock this level to route"}
                              aria-label={isLocked ? "Unlock this level" : "Lock this level to route"}
                              style={{
                                background: isLocked ? "#28a745" : "transparent",
                                color: isLocked ? "white" : "#666",
                                border: "none",
                                padding: "4px 6px",
                                cursor: "pointer",
                                borderRadius: "3px",
                                fontSize: "0.85em",
                                fontWeight: "bold",
                              }}
                            >
                              <i className="fa-solid fa-thumbtack" aria-hidden="true" />
                            </button>
                            <button
                              onClick={() => toggleLevelRemoved(recId)}
                              title={isRemoved ? "Re-include this level" : "Remove from route"}
                              aria-label={isRemoved ? "Re-include this level" : "Remove from route"}
                              style={{
                                background: isRemoved ? "#dc3545" : "transparent",
                                color: isRemoved ? "white" : "#666",
                                border: "none",
                                padding: "4px 6px",
                                cursor: "pointer",
                                borderRadius: "3px",
                                fontSize: "0.85em",
                                fontWeight: "bold",
                              }}
                            >
                              <i className="fa-solid fa-xmark" aria-hidden="true" />
                            </button>
                          </td>
                          <td className="optimizer-rank-cell" title={rankLabel}>
                            <span className="optimizer-rank-label">{rankLabel}</span>
                          </td>
                          <td>
                            <strong className="optimizer-level-name" title={rec.level}>
                              {truncateLadderLevelName(rec.level)}
                            </strong>
                            {rec.isPending
                              ? <span className="optimizer-level-status optimizer-level-status-pending">(Pending)</span>
                              : rec.isUnverified && <span style={{marginLeft: "6px", color: "#b7791f", fontSize: "0.8em"}}>(Unverified)</span>}
                            {rec.isRebeat && (
                              <span
                                style={{marginLeft: "6px", color: "var(--mint)", fontSize: "0.8em"}}
                                title={rec.completionAgeYears > 0 ? `Completion age: ${rec.completionAgeYears.toFixed(1)} years` : "Completion age unavailable"}
                              >
                                (Rebeat)
                              </span>
                            )}
                          </td>
                          <td>{rec.victorCount}</td>
                          <td>{rec.basePoints.toFixed(1)}</td>
                          <td title={[
                            rec.isRebeat ? `Current award: ${(rec.currentPoints || 0).toFixed(1)} pts` : "",
                            rec.isRebeat && rec.repeatMultiplier < 1
                              ? `Next repeat award: ${(rec.repeatMultiplier * 100).toFixed(1)}%`
                              : "",
                            rec.packBonusPoints > 0 ? `Includes +${rec.packBonusPoints.toFixed(1)} pack bonus points` : "",
                          ].filter(Boolean).join("; ") || undefined}>
                            <strong>{rec.isRebeat ? "+" : ""}{rec.projectedPoints.toFixed(1)}</strong>
                            <span style={{fontSize: "0.9em", color: "#999"}}>({rec.projectedMult.toFixed(2)}×)</span>
                          </td>
                          <td>{formatHours(rec.expectedHours)}</td>
                          <td>{Number.isFinite(rec.expectedAttempts) && rec.expectedAttempts > 0
                            ? Math.round(rec.expectedAttempts).toLocaleString()
                            : "—"}</td>
                          <td>{rec.hasWrTime ? (rec.timeWrPossible ? "✓" : "✗") : "—"}</td>
                          <td>{rec.hasWrAttempts ? (rec.attemptsWrPossible ? "✓" : "✗") : "—"}</td>
                          <td className="optimizer-ev"><strong>{rec.expectedValue.toFixed(2)}</strong></td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <div className="optimizer-skill-summary">
                <div className="optimizer-skill-main">
                  <span className="optimizer-skill-value">{formatSkillMultiplier(skillMultiplier)}</span>
                  <div className="optimizer-skill-meter" style={{ "--optimizer-skill-progress": `${Math.min(Math.max(skillMultiplier * 50, 0), 100)}%` }} aria-hidden="true">
                    <span
                      className="optimizer-skill-meter-fill"
                      style={{
                        background: `hsl(${Math.round(Math.min(Math.max((skillMultiplier - 0.55) / 0.95, 0), 1) * 270)}, 75%, 60%)`,
                      }}
                    ></span>
                  </div>
                </div>
                <div className="optimizer-skill-details">
                  <div className="optimizer-skill-exposure optimizer-skill-ratio-exposure-block">
                    <div className="optimizer-skill-exposure-header">
                      <div>
                        <span className="optimizer-skill-exposure-label">Ratio exposure</span>
                        {ratioExposureSummary.levels > 0 && (
                          <strong>{ratioExposureSummary.levels} level{ratioExposureSummary.levels === 1 ? "" : "s"}</strong>
                        )}
                      </div>
                      <span className="optimizer-skill-exposure-unit">Share of ratio levels</span>
                    </div>
                    {ratioExposureSummary.items.length > 0 ? (
                      <>
                        <div className="optimizer-skill-exposure-list">
                          {(showAllRatioExposure
                            ? ratioExposureSummary.items
                            : ratioExposureSummary.items.slice(0, 4)
                          ).map(item => (
                            <div className="optimizer-skill-exposure-row" key={item.key}>
                              <span>{item.name}</span>
                              <div className="optimizer-skill-exposure-bar" aria-hidden="true">
                                <span
                                  style={{
                                    width: `${Math.min(item.percent, 100)}%`,
                                    backgroundColor: `hsl(${Math.round(Math.min(item.percent, 100) * 1.35)}, 75%, 60%)`,
                                  }}
                                ></span>
                              </div>
                              <strong>{item.value || `${item.percent.toFixed(1)}%`}</strong>
                            </div>
                          ))}
                        </div>
                        {ratioExposureSummary.items.length > 4 && (
                          <button
                            className="optimizer-skill-exposure-toggle"
                            type="button"
                            aria-expanded={showAllRatioExposure}
                            onClick={() => setShowAllRatioExposure(prev => !prev)}
                          >
                            {showAllRatioExposure ? "Show less" : `Show ${ratioExposureSummary.items.length - 4} more`}
                          </button>
                        )}
                      </>
                    ) : (
                      <span className="optimizer-skill-exposure-empty">{ratioExposureSummary.emptyMessage}</span>
                    )}
                  </div>
                  {renderSkillExposure(skillMetrics, false, null, false)}
                </div>
              </div>
            </>
          )}
        </section>
      )}
    </div>
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(<App />);