const { useMemo, useState, useEffect } = React;

function App() {
  const [status, setStatus] = useState("loading");
  const [errorMsg, setErrorMsg] = useState("");
  const [levels, setLevels] = useState([]);
  const [selectedPlayer, setSelectedPlayer] = useState("");
  const [targetPlayerName, setTargetPlayerName] = useState("");
  const [lockedLevelIds, setLockedLevelIds] = useState([]);
  const [removedLevelIds, setRemovedLevelIds] = useState([]);
  const [excludeTwoPlayer, setExcludeTwoPlayer] = useState(false);
  const [autoExcludeTwoPlayer, setAutoExcludeTwoPlayer] = useState(true);

  useEffect(() => {
    loadLevelsJson()
      .then(raw => {
        const processed = processRawData(raw);
        setLevels(processed);
        setStatus("ready");
      })
      .catch(err => {
        setErrorMsg(err.name === "AbortError"
          ? "Request timed out. Make sure levels.json is in the same folder."
          : `Failed to load levels.json: ${err.message}`);
        setStatus("error");
      });
  }, []);

  const leaderboard = useMemo(() => buildLeaderboard(levels), [levels]);

  const filteredLevelsWithout2P = useMemo(
    () => levels.filter(level => !level.is2Player),
    [levels]
  );

  const avgTimePerPoint = useMemo(() => calculateAvgTimePerPoint(levels), [levels]);
  const avgAttemptsPerPoint = useMemo(() => calculateAvgAttemptsPerPoint(levels), [levels]);
  const maxPoints = useMemo(() => Math.max(...levels.map(l => l.points), 1), [levels]);

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

  const currentPlayer = useMemo(
    () => leaderboard.find(p => p.name === selectedPlayer) || null,
    [leaderboard, selectedPlayer]
  );

  const skillComponents = useMemo(
    () => (currentPlayer ? calculateSkillComponents(levels, currentPlayer.name) : { speed: 1, attempts: 1 }),
    [levels, currentPlayer]
  );

  const skillMultiplier = useMemo(
    () => (currentPlayer ? calculatePlayerSkill(levels, currentPlayer.name) : 1),
    [levels, currentPlayer]
  );

  const skillClassification = useMemo(() => classifySkill(skillMultiplier), [skillMultiplier]);
  const skillComparison = useMemo(() => describeSkillRelative(skillMultiplier), [skillMultiplier]);

  const targetPlayer = useMemo(
    () => leaderboard.find(p => p.name === targetPlayerName) || null,
    [leaderboard, targetPlayerName]
  );

  const recommendationsWith2P = useMemo(
    () => buildRecommendations(levels, currentPlayer, avgTimePerPoint, avgAttemptsPerPoint, maxPoints, levels),
    [levels, currentPlayer, avgTimePerPoint, avgAttemptsPerPoint, maxPoints]
  );

  const recommendationsWithout2P = useMemo(
    () => buildRecommendations(filteredLevelsWithout2P, currentPlayer, avgTimePerPoint, avgAttemptsPerPoint, maxPoints, levels),
    [filteredLevelsWithout2P, currentPlayer, avgTimePerPoint, avgAttemptsPerPoint, maxPoints, levels]
  );

  const recommendations = excludeTwoPlayer ? recommendationsWithout2P : recommendationsWith2P;

  const rankTargetPoints = targetRankSurpassPoints(leaderboard, targetPlayer);
  const pointsNeeded = Math.max(0, rankTargetPoints - (currentPlayer?.points || 0));

  const hasModifications = lockedLevelIds.length > 0 || removedLevelIds.length > 0;

  const optimizedWith2P = useMemo(
    () => hasModifications
      ? reoptimizeRouteWithModifications(
          recommendationsWith2P,
          pointsNeeded,
          [],
          lockedLevelIds,
          removedLevelIds
        )
      : optimizeRoute(recommendationsWith2P, pointsNeeded),
    [recommendationsWith2P, pointsNeeded, hasModifications, lockedLevelIds, removedLevelIds]
  );

  const optimizedWithout2P = useMemo(
    () => hasModifications
      ? reoptimizeRouteWithModifications(
          recommendationsWithout2P,
          pointsNeeded,
          [],
          lockedLevelIds,
          removedLevelIds
        )
      : optimizeRoute(recommendationsWithout2P, pointsNeeded),
    [recommendationsWithout2P, pointsNeeded, hasModifications, lockedLevelIds, removedLevelIds]
  );

  const optimized = excludeTwoPlayer ? optimizedWithout2P : optimizedWith2P;

  const safeRecommendations = Array.isArray(recommendations) ? recommendations : [];
  console.log({
    currentPlayer,
    targetPlayer,
    pointsNeeded,
    recommendationCount: safeRecommendations.length,
    recommendations: safeRecommendations.slice(0, 5),
    targetPoints: pointsNeeded,
    maxRecommendationPoints: safeRecommendations.length
      ? Math.max(...safeRecommendations.map(r => r.projectedPoints || 0))
      : 0,
    firstLevel: levels[0],
    optimized,
  });

  const projectedPath = optimized?.picks || [];
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
                          <td style={{textAlign: "center"}}>{rec.rank ? `#${rec.rank}` : "—"}</td>
                          <td><strong>{rec.level}</strong></td>
                          <td>{rec.victorCount}</td>
                          <td>{rec.basePoints.toFixed(1)}</td>
                          <td><strong>{rec.projectedPoints.toFixed(1)}</strong> <span style={{fontSize: "0.9em", color: "#999"}}>({rec.projectedMult.toFixed(2)}×)</span></td>
                          <td>{formatHours(rec.expectedHours)}</td>
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