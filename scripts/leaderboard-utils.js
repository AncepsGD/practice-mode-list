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
    return Number.isFinite(total) ? total : null;
}

const DIFFICULTY_CURVE_EXPONENT = 2;

function isEligibleVictor(victor) {
    const playerName = String(victor && victor.name || "").trim();
    return (
        Boolean(playerName) &&
        playerName !== "-" &&
        !/^(?:redacted\s+)?player(?:\s*#\d+)?$/i.test(playerName) &&
        !/^[-+]?\d+(?:\.\d+)?$/.test(playerName)
    );
}

function calculatePoints(rank, maxRank) {
    if (!rank || !maxRank) return 0;
    if (maxRank === 1) return 360;
    const normalizedRank = Math.max(1, Math.min(rank, maxRank));
    const ratio = (maxRank - normalizedRank) / (maxRank - 1);
    return 10 + 350 * Math.pow(ratio, DIFFICULTY_CURVE_EXPONENT);
}

function getVictorSortValue(victor) {
    if (!victor || typeof victor !== "object") return null;
    const rawDate = victor.date;
    if (typeof rawDate !== "string" || rawDate.trim() === "") return null;
    const date = rawDate.trim();
    const partialDateMatch = date.match(/^(\d{4})(?:-(\d{2}|\?\?))?(?:-(\d{2}|\?\?))?(?:$|T)/);
    if (partialDateMatch) {
        const year = Number(partialDateMatch[1]);
        const month = partialDateMatch[2] && partialDateMatch[2] !== "??" ? Number(partialDateMatch[2]) : 1;
        const day = partialDateMatch[3] && partialDateMatch[3] !== "??" ? Number(partialDateMatch[3]) : 1;
        const parsedPartial = Date.UTC(year, month - 1, day);
        if (Number.isFinite(parsedPartial)) return parsedPartial;
    }

    const parsed = Date.parse(date);
    return Number.isNaN(parsed) ? null : parsed;
}

function sortVictorsByDate(victors) {
    return [...victors]
        .map((victor, index) => ({ victor, index, value: getVictorSortValue(victor) }))
        .sort((a, b) => {
            if (a.value == null && b.value == null) return a.index - b.index;
            if (a.value == null) return 1;
            if (b.value == null) return -1;
            return a.value - b.value || a.index - b.index;
        })
        .map(entry => entry.victor);
}

const FASTEST_COMPLETION_BONUS = 0.2;
const LOWEST_ATTEMPTS_BONUS = 0.2;
const FIRST_VICTOR_BONUS = 0.1;
const TIME_PERFORMANCE_WEIGHT = 0.7;
const ATTEMPTS_PERFORMANCE_WEIGHT = 0.3;
const PERFORMANCE_POINTS_MULTIPLIER = 1.1;

function createTimelineLevelLookup(timelineLevels = typeof window !== "undefined" ? window.timelineLevels : []) {
    const levels = Array.isArray(timelineLevels) ? timelineLevels : [];
    const datedLevels = levels.map((level, index) => ({
        level,
        index,
        start: parseTimelineTimestamp(level?.date),
    }));
    const byId = new Map();
    const byName = new Map();

    function addPeriod(map, key, period) {
        if (!key) return;
        const periods = map.get(key) || [];
        periods.push(period);
        map.set(key, periods);
    }

    datedLevels.forEach(({ level, index, start }) => {
        if (start === null) return;
        const end = index === 0 ? null : datedLevels[index - 1].start;
        if (index > 0 && end === null) return;

        const period = { start, end };
        const id = String(level?.id || level?.levelId || "").trim();
        const name = String(level?.name || level?.levelName || "").trim().toLowerCase().replace(/\s+/g, " ");
        addPeriod(byId, id, period);
        addPeriod(byName, name, period);
    });

    return {
        byId,
        byName,
    };
}

function parseTimelineTimestamp(value) {
    const date = String(value || "").trim();
    const match = date.match(/^(\d{4})-(\d{2})-(\d{2})(?:T.*)?$/);
    if (!match) return null;

    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const dateOnly = new Date(Date.UTC(year, month - 1, day));
    if (dateOnly.getUTCFullYear() !== year
        || dateOnly.getUTCMonth() !== month - 1
        || dateOnly.getUTCDate() !== day) {
        return null;
    }

    const timestamp = Date.parse(date);
    return Number.isFinite(timestamp) ? timestamp : null;
}

function getTimelineMultiplier(
    level,
    victorDate,
    timelineLookup = createTimelineLevelLookup(),
) {
    const timestamp = parseTimelineTimestamp(victorDate);
    if (timestamp === null) return 1;

    const id = String(level?.id || level?.levelId || "").trim();
    const name = String(level?.name || level?.levelName || "").trim().toLowerCase().replace(/\s+/g, " ");
    const periods = [
        ...(timelineLookup.byId.get(id) || []),
        ...(timelineLookup.byName.get(name) || []),
    ];
    return periods.some(period => (
        timestamp >= period.start
        && (period.end === null || timestamp < period.end)
    )) ? 2 : 1;
}

function getTimeScore(playerSeconds, bestSeconds) {
    if (!Number.isFinite(playerSeconds) || playerSeconds <= 0) return 0;
    if (!Number.isFinite(bestSeconds) || bestSeconds <= 0) return 0;
    return Math.min(bestSeconds / playerSeconds, 1);
}

function getScoringBaseline(level, players) {
    const savedBaseline = level.scoringBaseline || {};
    const recordedTimes = players
        .map((victor) => Number(victor.seconds))
        .filter((seconds) => Number.isFinite(seconds) && seconds > 0);
    const recordedAttempts = players
        .map((victor) => Number(victor.attempts))
        .filter((attempts) => Number.isFinite(attempts) && attempts > 0);
    const savedTime = Number(savedBaseline.timeSeconds);
    const savedAttempts = Number(savedBaseline.attempts);

    return {
        timeSeconds: Number.isFinite(savedTime) && savedTime > 0
            ? savedTime
            : (recordedTimes.length ? Math.min(...recordedTimes) : null),
        attempts: Number.isFinite(savedAttempts) && savedAttempts > 0
            ? savedAttempts
            : (recordedAttempts.length ? Math.min(...recordedAttempts) : null),
    };
}

function buildLevelVictorAwards(level, timelineLookup) {
    const players = (level.victors || []).filter(isEligibleVictor);
    const hasMultipleVictors = new Set(
        players.map((victor) => String(victor.name || "").trim().toLowerCase())
    ).size > 1;
    const firstVictor = sortVictorsByDate(players)[0] || null;
    const baseline = getScoringBaseline(level, players);
    const recordedTimes = players
        .map((victor) => Number(victor.seconds))
        .filter((seconds) => Number.isFinite(seconds) && seconds > 0);
    const recordedAttempts = players
        .map((victor) => Number(victor.attempts))
        .filter((attempts) => Number.isFinite(attempts) && attempts > 0);
    const bestTimeSeconds = recordedTimes.length ? Math.min(...recordedTimes) : null;
    const lowestAttempts = recordedAttempts.length ? Math.min(...recordedAttempts) : null;
    const levelPoints = Number(level.points) || 0;
    const levelAwards = new WeakMap();

    players.forEach((victor) => {
        const seconds = Number(victor.seconds);
        const attempts = Number(victor.attempts);
        const timelineMultiplier = getTimelineMultiplier(level, victor.date, timelineLookup);
        const performanceContributions = [];
        if (Number.isFinite(seconds) && seconds > 0 && baseline.timeSeconds !== null) {
            performanceContributions.push({
                key: "time",
                score: getTimeScore(seconds, baseline.timeSeconds),
                weight: TIME_PERFORMANCE_WEIGHT,
            });
        }
        if (Number.isFinite(attempts) && attempts > 0 && baseline.attempts !== null) {
            performanceContributions.push({
                key: "attempts",
                score: getTimeScore(attempts, baseline.attempts),
                weight: ATTEMPTS_PERFORMANCE_WEIGHT,
            });
        }
        const availableMetricWeight = performanceContributions.reduce((total, item) => total + item.weight, 0);
        const timePerformancePoints = performanceContributions.find(item => item.key === "time")?.score
            * (levelPoints * TIME_PERFORMANCE_WEIGHT / (availableMetricWeight || 1))
            * PERFORMANCE_POINTS_MULTIPLIER || 0;
        const attemptsPerformancePoints = performanceContributions.find(item => item.key === "attempts")?.score
            * (levelPoints * ATTEMPTS_PERFORMANCE_WEIGHT / (availableMetricWeight || 1))
            * PERFORMANCE_POINTS_MULTIPLIER || 0;
        const performancePoints = timePerformancePoints + attemptsPerformancePoints;
        const timeRecordBonus = hasMultipleVictors
            && bestTimeSeconds !== null
            && Number.isFinite(seconds)
            && seconds > 0
            ? levelPoints * FASTEST_COMPLETION_BONUS * Math.min(bestTimeSeconds / seconds, 1)
            : 0;
        const attemptsRecordBonus = hasMultipleVictors
            && lowestAttempts !== null
            && Number.isFinite(attempts)
            && attempts > 0
            ? levelPoints * LOWEST_ATTEMPTS_BONUS * Math.min(lowestAttempts / attempts, 1)
            : 0;
        const firstVictorBonus = victor === firstVictor
            ? levelPoints * FIRST_VICTOR_BONUS
            : 0;
        const recordBonusPoints = timeRecordBonus + attemptsRecordBonus;
        const points = (performancePoints + recordBonusPoints + firstVictorBonus) * timelineMultiplier;

        levelAwards.set(victor, {
            points,
            multiplier: levelPoints > 0 ? points / levelPoints : 0,
            basePoints: levelPoints,
            performancePoints,
            timePerformancePoints,
            attemptsPerformancePoints,
            recordBonusPoints,
            firstVictorBonus,
            timeRecordBonus,
            attemptsRecordBonus,
            timelineMultiplier,
        });
    });

    return levelAwards;
}

function getPlayerCompletionMultipliers(levels) {
    const completionDetailsByPlayer = new Map();
    const variantRelations = VariantUtils.getVariantRelations(levels);
    levels.forEach((level) => {
        (level.victors || []).filter(isEligibleVictor).forEach((victor) => {
            const playerKey = String(victor.name || "").trim().toLowerCase();
            if (!playerKey) return;
            if (!completionDetailsByPlayer.has(playerKey)) completionDetailsByPlayer.set(playerKey, []);
            completionDetailsByPlayer.get(playerKey).push({
                name: level.name,
                date: victor.date || "",
                level,
                victor,
            });
        });
    });

    return new Map(
        [...completionDetailsByPlayer].map(([playerKey, completionDetails]) => {
            const variantMultipliers = VariantUtils.getPlayerVariantProgress(
                { completionDetails },
                levels,
                variantRelations,
            ).multiplierByVariantName;
            const repeatMultipliers = VariantUtils.getPlayerRepeatMultipliers(completionDetails);
            return [
                playerKey,
                new Map(completionDetails.map((completion) => [
                    completion.victor,
                    {
                        variantMultiplier: variantMultipliers.get(
                            VariantUtils.normalizeName(completion.name),
                        ) ?? 1,
                        repeatMultiplier: repeatMultipliers.get(completion) ?? 1,
                    },
                ])),
            ];
        })
    );
}

function applyCompletionAwardMultipliers(award, multipliers) {
    const variantMultiplier = multipliers?.variantMultiplier ?? 1;
    const repeatMultiplier = multipliers?.repeatMultiplier ?? 1;
    const totalMultiplier = variantMultiplier * repeatMultiplier;
    const timelineMultiplier = award.timelineMultiplier ?? 1;
    return {
        ...award,
        points: award.points * totalMultiplier,
        multiplier: award.multiplier * totalMultiplier,
        variantMultiplier,
        repeatMultiplier,
        timelineMultiplier,
        performancePoints: award.performancePoints * timelineMultiplier * totalMultiplier,
        timePerformancePoints: award.timePerformancePoints * timelineMultiplier * totalMultiplier,
        attemptsPerformancePoints: award.attemptsPerformancePoints * timelineMultiplier * totalMultiplier,
        recordBonusPoints: award.recordBonusPoints * timelineMultiplier * totalMultiplier,
        firstVictorBonus: award.firstVictorBonus * timelineMultiplier * totalMultiplier,
        timeRecordBonus: award.timeRecordBonus * timelineMultiplier * totalMultiplier,
        attemptsRecordBonus: award.attemptsRecordBonus * timelineMultiplier * totalMultiplier,
    };
}

function buildVictorPointAwards(
    lvls,
    allLevels = lvls,
    timelineLevels = typeof window !== "undefined" ? window.timelineLevels : [],
) {
    const awards = new WeakMap();
    const multipliersByPlayer = getPlayerCompletionMultipliers(allLevels);
    const timelineLookup = createTimelineLevelLookup(timelineLevels);
    lvls.forEach((level) => {
        const levelAwards = buildLevelVictorAwards(level, timelineLookup);
        const playerName = name => String(name || "").trim().toLowerCase();
        (level.victors || []).forEach((victor) => {
            const multipliers = multipliersByPlayer
                .get(playerName(victor.name))
                ?.get(victor) ?? { variantMultiplier: 1, repeatMultiplier: 1 };
            const award = levelAwards.get(victor);
            if (award) levelAwards.set(victor, applyCompletionAwardMultipliers(award, multipliers));
        });
        awards.set(level, levelAwards);
    });
    return awards;
}

function getVictorPointAward(awards, level, victor) {
    return awards.get(level)?.get(victor) || {
        points: 0,
        multiplier: 0,
        basePoints: 0,
        performancePoints: 0,
        timePerformancePoints: 0,
        attemptsPerformancePoints: 0,
        recordBonusPoints: 0,
        firstVictorBonus: 0,
        timeRecordBonus: 0,
        attemptsRecordBonus: 0,
        timelineMultiplier: 1,
    };
}

function buildLeaderboard(
    lvls,
    timelineLevels = typeof window !== "undefined" ? window.timelineLevels : [],
) {
    const map = {};
    const levelOrder = new Map(
        [...lvls].map((lvl, index) => [String(lvl.name || "").trim().toLowerCase(), index])
    );
    const orderedLevels = [...lvls].sort((a, b) => {
        const tierA = (a.tier || "unknown").toLowerCase();
        const tierB = (b.tier || "unknown").toLowerCase();
        if (tierA !== tierB) return tierA.localeCompare(tierB);
        return (b.points || 0) - (a.points || 0);
    });
    const variantPointAwards = buildVictorPointAwards(orderedLevels, lvls, timelineLevels);

    orderedLevels.forEach((lvl) => {
        const players = (lvl.victors || []).filter(isEligibleVictor);
        const levelAwards = variantPointAwards.get(lvl);

        players.forEach((victor) => {
            const playerName = String(victor.name || "").trim();
            if (!playerName) return;
            const award = levelAwards.get(victor) || { points: 0, multiplier: 0 };

            if (!map[playerName]) {
                map[playerName] = {
                    name: playerName,
                    points: 0,
                    levels: [],
                    completionDetails: [],
                    totalTimeSeconds: 0,
                    totalAttempts: 0,
                };
            }

            const levelName = String(lvl.name || "").trim();
            const playerSeconds = Number(victor.seconds);
            if (Number.isFinite(playerSeconds) && playerSeconds > 0) {
                map[playerName].totalTimeSeconds += playerSeconds;
            }
            const playerAttempts = Number(victor.attempts);
            if (Number.isFinite(playerAttempts) && playerAttempts > 0) {
                map[playerName].totalAttempts += playerAttempts;
            }

            map[playerName].points += award.points;
            map[playerName].levels.push(levelName);
            map[playerName].completionDetails.push({
                name: levelName,
                points: (Number(lvl.points) || 0) * (award.variantMultiplier ?? 1),
                basePoints: award.basePoints,
                variantMultiplier: award.variantMultiplier ?? 1,
                repeatMultiplier: award.repeatMultiplier ?? 1,
                earnedPoints: award.points,
                performancePoints: award.performancePoints,
                timePerformancePoints: award.timePerformancePoints,
                attemptsPerformancePoints: award.attemptsPerformancePoints,
                recordBonusPoints: award.recordBonusPoints,
                firstVictorBonus: award.firstVictorBonus,
                timeRecordBonus: award.timeRecordBonus,
                attemptsRecordBonus: award.attemptsRecordBonus,
                timelineMultiplier: award.timelineMultiplier ?? 1,
                date: victor.date || "",
                seconds: Number.isFinite(victor.seconds) ? victor.seconds : null,
                attempts: Number.isFinite(victor.attempts) ? victor.attempts : null,
                tier: String(lvl.tier || "unknown").trim() || "unknown",
                listIndex: levelOrder.get(levelName.toLowerCase()) ?? Number.MAX_SAFE_INTEGER,
            });
        });
    });

    return Object.values(map)
        .map((player) => {
            const completionDetails = [...player.completionDetails]
                .sort((a, b) => (a.listIndex ?? Number.MAX_SAFE_INTEGER) - (b.listIndex ?? Number.MAX_SAFE_INTEGER));
            const completionCount = completionDetails.length;
            const hardestCompletion = completionDetails.reduce((best, current) => {
                if (!best) return current;
                return (Number(current.points) || 0) > (Number(best.points) || 0) ? current : best;
            }, null);
            const averageCompletionValue = completionCount ? player.points / completionCount : 0;

            return {
                ...player,
                levels: completionDetails.map((entry) => entry.name),
                completionDetails,
                completionCount,
                hardestCompletion,
                averageCompletionValue,
            };
        })
        .sort((a, b) => b.points - a.points);
}

function buildFullListLeaderboardEntry(lvls) {
    const levels = Array.isArray(lvls) ? lvls : [];
    if (!levels.length) return null;

    const fullListCompletions = levels.map((level) => ({ name: level.name }));
    const fullListMultipliers = VariantUtils.getPlayerVariantProgress(
        { completionDetails: fullListCompletions },
        levels,
    ).multiplierByVariantName;
    const completionDetails = levels.map((level, index) => {
        const name = String(level.name || "").trim();
        const variantMultiplier = fullListMultipliers.get(VariantUtils.normalizeName(name)) ?? 1;
        return {
            name,
            points: (Number(level.points) || 0) * variantMultiplier,
            variantMultiplier,
            tier: String(level.tier || "unknown").trim() || "unknown",
            listIndex: index,
        };
    });
    const points = completionDetails.reduce((total, level) => total + level.points, 0);

    return {
        name: "Full List",
        points,
        levels: completionDetails.map(level => level.name),
        completionDetails,
        completionCount: completionDetails.length,
        hardestCompletion: completionDetails.reduce((hardest, level) => (
            !hardest || level.points > hardest.points ? level : hardest
        ), null),
        averageCompletionValue: completionDetails.length ? points / completionDetails.length : 0,
        totalTimeSeconds: 0,
        totalAttempts: 0,
        isFullList: true,
    };
}