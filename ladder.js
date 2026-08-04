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
  const filteredLevels = useMemo(() => {
    if (!excludeTwoPlayer) return levels;
    return levels.filter(level => !level.is2Player);
  }, [levels, excludeTwoPlayer]);

  const avgTimePerPoint = useMemo(() => calculateAvgTimePerPoint(filteredLevels), [filteredLevels]);
  const avgAttemptsPerPoint = useMemo(() => calculateAvgAttemptsPerPoint(filteredLevels), [filteredLevels]);
  const maxPoints = useMemo(() => Math.max(...filteredLevels.map(l => l.points), 1), [filteredLevels]);

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
  }

  const currentPlayer = useMemo(
    () => leaderboard.find(p => p.name === selectedPlayer) || null,
    [leaderboard, selectedPlayer]
  );

  const skillComponents = useMemo(
    () => (currentPlayer ? calculateSkillComponents(filteredLevels, currentPlayer.name) : { speed: 1, attempts: 1 }),
    [filteredLevels, currentPlayer]
  );

  const skillMultiplier = useMemo(
    () => (currentPlayer ? calculatePlayerSkill(filteredLevels, currentPlayer.name) : 1),
    [filteredLevels, currentPlayer]
  );

  const skillClassification = useMemo(() => classifySkill(skillMultiplier), [skillMultiplier]);
  const skillComparison = useMemo(() => describeSkillRelative(skillMultiplier), [skillMultiplier]);

  const targetPlayer = useMemo(
    () => leaderboard.find(p => p.name === targetPlayerName) || null,
    [leaderboard, targetPlayerName]
  );

  const recommendations = useMemo(
    () => buildRecommendations(filteredLevels, currentPlayer, avgTimePerPoint, avgAttemptsPerPoint, maxPoints),
    [filteredLevels, currentPlayer, avgTimePerPoint, avgAttemptsPerPoint, maxPoints]
  );

  const rankTargetPoints = targetRankSurpassPoints(leaderboard, targetPlayer);
  const pointsNeeded = Math.max(0, rankTargetPoints - (currentPlayer?.points || 0));

  const hasModifications = lockedLevelIds.length > 0 || removedLevelIds.length > 0;

  const optimized = useMemo(
    () => hasModifications
      ? reoptimizeRouteWithModifications(
          recommendations,
          pointsNeeded,
          [],
          lockedLevelIds,
          removedLevelIds
        )
      : optimizeRoute(recommendations, pointsNeeded),
    [recommendations, pointsNeeded, hasModifications, lockedLevelIds, removedLevelIds]
  );

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
              {fallbackRoute && (
                <div className="optimizer-note">Showing the closest route for the current target; the route expands as the target grows.</div>
              )}
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
                    {projectedPath.map(rec => {
                      const recId = String(rec.id || rec.level);
                      const isLocked = lockedLevelIds.includes(recId);
                      const isRemoved = removedLevelIds.includes(recId);
                      return (
                        <tr key={rec.id || rec.level} style={{opacity: isRemoved ? 0.5 : 1}}>
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