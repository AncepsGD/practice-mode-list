const { useMemo, useState, useEffect } = React;
const MIN_UNVERIFIED_ROUTE_HOURS = 8 / 60;
const UNVERIFIED_BASELINE_LEVEL = "Aeternus";

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

function App() {
  const [status, setStatus] = useState("loading");
  const [errorMsg, setErrorMsg] = useState("");
  const [levels, setLevels] = useState([]);
  const [verifiedLevels, setVerifiedLevels] = useState([]);
  const [unverifiedLevels, setUnverifiedLevels] = useState([]);
  const [ladderSources, setLadderSources] = useState(null);
  const [includeUnverified, setIncludeUnverified] = useState(false);
  const [unverifiedOnly, setUnverifiedOnly] = useState(false);
  const [useFullSecretList, setUseFullSecretList] = useState(false);
  const [selectedPlayer, setSelectedPlayer] = useState("");
  const [targetPlayerName, setTargetPlayerName] = useState("");
  const [lockedLevelIds, setLockedLevelIds] = useState([]);
  const [removedLevelIds, setRemovedLevelIds] = useState([]);
  const [excludeTwoPlayer, setExcludeTwoPlayer] = useState(false);
  const [autoExcludeTwoPlayer, setAutoExcludeTwoPlayer] = useState(true);

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
        calibrationLevels: processedVerified,
        estimatedNames: ladderSources.estimatedNames,
      },
    );
  }, [ladderSources, useFullSecretList, processedVerified]);

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

  const leaderboard = useMemo(() => buildLeaderboard(verifiedLevels), [verifiedLevels]);

  const filteredLevelsWithout2P = useMemo(
    () => levels.filter(level => !level.is2Player),
    [levels]
  );

  const avgTimePerPoint = useMemo(() => calculateAvgTimePerPoint(verifiedLevels), [verifiedLevels]);
  const avgAttemptsPerPoint = useMemo(() => calculateAvgAttemptsPerPoint(verifiedLevels), [verifiedLevels]);
  const maxPoints = useMemo(() => Math.max(...verifiedLevels.map(l => l.points), 1), [verifiedLevels]);

  const routeLevels = useMemo(() => {
    if (unverifiedOnly) return unverifiedLevels;
    if (!includeUnverified) return verifiedLevels;

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
  }, [unverifiedOnly, includeUnverified, verifiedLevels, unverifiedLevels]);

  useEffect(() => {
    if (leaderboard.length === 0) {
      setSelectedPlayer("");
      setTargetPlayerName("");
      return;
    }

    const selectedIsValid = leaderboard.some(p => p.name === selectedPlayer);
    const targetIsValid = leaderboard.some(p => p.name === targetPlayerName) && targetPlayerName !== selectedPlayer;

    if (leaderboard.length === 1) {
      if (!selectedIsValid) {
        setSelectedPlayer(leaderboard[0].name);
      }
      if (targetPlayerName) {
        setTargetPlayerName("");
      }
      return;
    }

    if (!selectedIsValid) {
      setSelectedPlayer(leaderboard[1].name);
      return;
    }

    if (!targetIsValid) {
      setTargetPlayerName(leaderboard[0].name);
    }
  }, [leaderboard, selectedPlayer, targetPlayerName]);

  function handleSelectPlayer(name) {
    setSelectedPlayer(name);
    if (targetPlayerName === name) {
      setTargetPlayerName(defaultTarget(leaderboard, name)?.name || "");
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
    setAutoExcludeTwoPlayer(false);
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
    () => (currentPlayer ? calculateSkillComponents(verifiedLevels, currentPlayer.name) : { speed: 1, attempts: 1 }),
    [verifiedLevels, currentPlayer]
  );

  const skillMultiplier = useMemo(
    () => (currentPlayer ? calculatePlayerSkill(verifiedLevels, currentPlayer.name) : 1),
    [verifiedLevels, currentPlayer]
  );

  const skillClassification = useMemo(() => classifySkill(skillMultiplier), [skillMultiplier]);
  const skillComparison = useMemo(() => describeSkillRelative(skillMultiplier), [skillMultiplier]);

  const targetPlayer = useMemo(
    () => leaderboard.find(p => p.name === targetPlayerName) || null,
    [leaderboard, targetPlayerName]
  );

  const recommendationsWith2P = useMemo(
    () => applyUnverifiedMinimumTime(
      buildRecommendations(
        routeLevels,
        currentPlayer,
        avgTimePerPoint,
        avgAttemptsPerPoint,
        maxPoints,
        routeLevels,
        verifiedLevels,
      ),
      unverifiedOnly,
    ),
    [routeLevels, currentPlayer, avgTimePerPoint, avgAttemptsPerPoint, maxPoints, verifiedLevels, unverifiedOnly]
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

  const rankTargetPoints = targetRankSurpassPoints(leaderboard, targetPlayer);
  const initialPointsNeeded = Math.max(0, rankTargetPoints - (currentPlayer?.points || 0));

  const hasModifications = lockedLevelIds.length > 0 || removedLevelIds.length > 0;

  const optimizedWith2P = useMemo(
    () => hasModifications
      ? optimizeRouteWithProjectedTarget(
          recommendationsWith2P,
          targetPlayer,
          routeLevels,
          currentPlayer?.points || 0,
          lockedLevelIds,
          removedLevelIds,
          currentPlayer,
          avgTimePerPoint,
          avgAttemptsPerPoint,
          maxPoints,
          verifiedLevels
        )
      : optimizeRouteWithProjectedTarget(
          recommendationsWith2P,
          targetPlayer,
          routeLevels,
          currentPlayer?.points || 0,
          [],
          [],
          currentPlayer,
          avgTimePerPoint,
          avgAttemptsPerPoint,
          maxPoints,
          verifiedLevels
        ),
    [recommendationsWith2P, targetPlayer, routeLevels, currentPlayer, avgTimePerPoint, avgAttemptsPerPoint, maxPoints, hasModifications, lockedLevelIds, removedLevelIds]
  );

  const optimizedWithout2P = useMemo(
    () => hasModifications
      ? optimizeRouteWithProjectedTarget(
          recommendationsWithout2P,
          targetPlayer,
          routeLevels,
          currentPlayer?.points || 0,
          lockedLevelIds,
          removedLevelIds,
          currentPlayer,
          avgTimePerPoint,
          avgAttemptsPerPoint,
          maxPoints,
          verifiedLevels
        )
      : optimizeRouteWithProjectedTarget(
          recommendationsWithout2P,
          targetPlayer,
          routeLevels,
          currentPlayer?.points || 0,
          [],
          [],
          currentPlayer,
          avgTimePerPoint,
          avgAttemptsPerPoint,
          maxPoints,
          verifiedLevels
        ),
    [recommendationsWithout2P, targetPlayer, routeLevels, currentPlayer, avgTimePerPoint, avgAttemptsPerPoint, maxPoints, hasModifications, lockedLevelIds, removedLevelIds]
  );

  const optimized = excludeTwoPlayer ? optimizedWithout2P : optimizedWith2P;
  const pointsNeeded = optimized?.pointsNeeded ?? initialPointsNeeded;

  const projectedPath = [...(optimized?.picks || [])]
    .sort((a, b) => (b.expectedValue || 0) - (a.expectedValue || 0));
  const fallbackRoute = optimized?.fallback || false;
  const totalPoints = projectedPath.reduce((a, b) => a + b.projectedPoints, 0);
  const totalHours = projectedPath.reduce((a, b) => a + b.expectedHours, 0);
  const targetRank = leaderboard.findIndex(p => p.name === targetPlayerName) + 1;

  useEffect(() => {
    if (!autoExcludeTwoPlayer) return;
    if (!currentPlayer || !targetPlayer || pointsNeeded <= 0) return;

    const with2PValid = optimizedWith2P?.picks?.length > 0 || pointsNeeded === 0;
    const without2PValid = optimizedWithout2P?.picks?.length > 0 || pointsNeeded === 0;

    if (with2PValid && !without2PValid) {
      if (excludeTwoPlayer) setExcludeTwoPlayer(false);
      return;
    }

    if (without2PValid && !with2PValid) {
      if (!excludeTwoPlayer) setExcludeTwoPlayer(true);
      return;
    }

    if (!with2PValid && !without2PValid) return;

    const without2PTime = optimizedWithout2P?.time ?? Infinity;
    const with2PTime = optimizedWith2P?.time ?? Infinity;

    const shouldExclude = without2PTime < with2PTime;
    if (shouldExclude !== excludeTwoPlayer) {
      setExcludeTwoPlayer(shouldExclude);
    }
  }, [autoExcludeTwoPlayer, currentPlayer, targetPlayer, pointsNeeded, optimizedWith2P, optimizedWithout2P, excludeTwoPlayer]);

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
            Make sure <code>ladder.html</code> and <code>levels.json</code> are in the same folder and served over HTTP.
          </p>
        </div>
      </div>
    );
  }

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
            {leaderboard.map((player, i) => {
              const isMe = player.name === selectedPlayer;
              const isTarget = player.name === targetPlayerName;
              return (
                <div
                  key={player.name}
                  className={`optimizer-player-card ${isMe && isTarget ? "optimizer-player-card-active" : isMe ? "optimizer-player-card-me" : isTarget ? "optimizer-player-card-target" : ""}`}
                >
                  <div className="optimizer-player-main">
                    <div className="optimizer-player-name">
                      <span className="optimizer-rank">#{i + 1}</span>
                      {player.name}
                    </div>
                    <div className="optimizer-player-meta">
                      {player.levels.length} • {player.points.toFixed(1)} pts
                    </div>
                  </div>
                  <div className="optimizer-player-actions">
                    <button
                      onClick={() => handleSelectPlayer(player.name)}
                      className={`optimizer-action-btn ${isMe ? "optimizer-action-btn-me" : "optimizer-action-btn-default"}`}
                    >
                      Me
                    </button>
                    <button
                      onClick={() => handleSetTarget(player.name)}
                      disabled={isMe}
                      className={`optimizer-action-btn ${isTarget ? "optimizer-action-btn-target" : isMe ? "optimizer-action-btn-disabled" : "optimizer-action-btn-default"}`}
                    >
                      Target
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
            <h2>Optimal Route</h2>
            {targetPlayer ? (
              <span className="optimizer-target-caption">
                <span>Targeting </span>
                <span className="optimizer-target-name">#{targetRank} {targetPlayer.name}</span>
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
          </div>
          {includeUnverified && (
            <div className="optimizer-note">
              {useFullSecretList
                ? "Special mode: the complete secret.txt list is used for unverified levels."
                : "Estimated difficulty order is used for levels without verified completions."}
            </div>
          )}
          {excludeTwoPlayer && (
            <div className="optimizer-note">2-player levels are excluded from route generation.</div>
          )}
          <div className="optimizer-skill-summary">
            <div className="optimizer-skill-main">
              <span className="optimizer-skill-label">Your Skill Rating</span>
              <span className="optimizer-skill-value">{formatSkillMultiplier(skillMultiplier)}</span>
            </div>
            <div className="optimizer-skill-details">
              <div className="optimizer-skill-classification">{skillClassification}</div>
              <div className="optimizer-skill-comparison">{skillComparison}</div>
              <div className="optimizer-skill-breakdown">
                <span>Speed: {formatSkillMultiplier(skillComponents.speed)}</span>
                <span>Attempts: {formatSkillMultiplier(skillComponents.attempts)}</span>
              </div>
            </div>
          </div>
          <div className="optimizer-stats-grid">
            <div className="optimizer-stat-box">
              <span className="optimizer-stat-label">Your Points</span>
              <span className="optimizer-stat-value">{currentPlayer.points.toFixed(1)}</span>
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
          {projectedPath.length === 0 ? (
            <div className="optimizer-empty">
              {!targetPlayer
                ? "Select a target player to generate a route."
                : pointsNeeded === 0
                  ? `${currentPlayer.name} already meets or exceeds ${targetPlayer.name}'s score.`
                  : "No route was generated for the selected target."}
            </div>
          ) : (
            <>
              {hasModifications && (
                <div className="optimizer-note" style={{backgroundColor: "#fff3cd00", borderColor: "#ffc107"}}>
                  <div style={{display: "flex", justifyContent: "space-between", alignItems: "center"}}>
                    <span>
                      {lockedLevelIds.length > 0 && <span>📌 {lockedLevelIds.length} locked</span>}
                      {lockedLevelIds.length > 0 && removedLevelIds.length > 0 && <span> • </span>}
                      {removedLevelIds.length > 0 && <span>✕ {removedLevelIds.length} removed</span>}
                    </span>
                    <button
                      onClick={clearModifications}
                      style={{
                        background: "none",
                        border: "1px solid #ffc107",
                        padding: "4px 8px",
                        cursor: "pointer",
                        borderRadius: "3px",
                        fontSize: "0.9em",
                      }}
                    >
                      Clear all
                    </button>
                  </div>
                </div>
              )}
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
                    {projectedPath.map((rec, idx) => {
                      const recId = String(rec.id || rec.level);
                      const isLocked = lockedLevelIds.includes(recId);
                      const isRemoved = removedLevelIds.includes(recId);
                      const keyVal = `${recId}-${idx}`;
                      return (
                        <tr key={keyVal} style={{opacity: isRemoved ? 0.5 : 1}}>
                          <td style={{display: "flex", gap: "4px", justifyContent: "center"}}>
                            <button
                              onClick={() => toggleLevelLocked(recId)}
                              title={isLocked ? "Unlock this level" : "Lock this level to route"}
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
                              📌
                            </button>
                            <button
                              onClick={() => toggleLevelRemoved(recId)}
                              title={isRemoved ? "Re-include this level" : "Remove from route"}
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
                              ✕
                            </button>
                          </td>
                          <td style={{textAlign: "center"}}>
                            {rec.isUnverified
                              ? rec.estimatedMainListRank ? `#${rec.estimatedMainListRank}~` : "—"
                              : rec.rank ? `#${rec.rank}` : "—"}
                          </td>
                          <td>
                            <strong>{rec.level}</strong>
                            {rec.isUnverified && <span style={{marginLeft: "6px", color: "#b7791f", fontSize: "0.8em"}}>(unverified)</span>}
                          </td>
                          <td>{rec.victorCount}</td>
                          <td>{rec.basePoints.toFixed(1)}</td>
                          <td><strong>{rec.projectedPoints.toFixed(1)}</strong> <span style={{fontSize: "0.9em", color: "#999"}}>({rec.projectedMult.toFixed(2)}×)</span></td>
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
            </>
          )}
        </section>
      )}
    </div>
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(<App />);