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

const DIFFICULTY_CURVE_EXPONENT = 1.6;

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
    return [...victors].sort((a, b) => {
        const aValue = getVictorSortValue(a);
        const bValue = getVictorSortValue(b);

        if (aValue == null && bValue == null) return 0;
        if (aValue == null) return 1;
        if (bValue == null) return -1;
        return aValue - bValue;
    });
}

const FIRST_VICTOR_BONUS = 0.12;
const VICTOR_ORDER_DECAY = 0.65;
const FASTEST_COMPLETION_BONUS = 0.1;
const LOWEST_ATTEMPTS_BONUS = 0.1;
const TIER_COMPLETION_DECAY = 0.95;

function getVictorOrderBonus(orderIndex) {
    if (!Number.isFinite(orderIndex) || orderIndex < 0) return 0;
    return FIRST_VICTOR_BONUS * Math.pow(VICTOR_ORDER_DECAY, orderIndex);
}

function getTimeScore(playerSeconds, bestSeconds) {
    if (!Number.isFinite(playerSeconds)) return 0;
    if (!Number.isFinite(bestSeconds) || bestSeconds < 0) return 0;
    if (playerSeconds === 0) return bestSeconds >= 0 ? 1 : 0;
    if (bestSeconds <= 0) return 0;
    return Math.min(bestSeconds / playerSeconds, 1);
}

function getTierCompletionMultiplier(completions) {
    if (!Number.isFinite(completions) || completions <= 0) return 1;
    return Math.pow(TIER_COMPLETION_DECAY, completions);
}

function buildLeaderboard(lvls) {
    const map = {};
    const playerTierCompletions = new Map();
    const levelOrder = new Map(
        [...lvls].map((lvl, index) => [String(lvl.name || "").trim().toLowerCase(), index])
    );
    const orderedLevels = [...lvls].sort((a, b) => {
        const tierA = (a.tier || "unknown").toLowerCase();
        const tierB = (b.tier || "unknown").toLowerCase();
        if (tierA !== tierB) return tierA.localeCompare(tierB);
        return (b.points || 0) - (a.points || 0);
    });

    orderedLevels.forEach((lvl) => {
        const sortedVictors = sortVictorsByDate(lvl.victors);
        const players = sortedVictors.filter(isEligibleVictor);

        const timeRankings = players
            .filter((victor) => Number.isFinite(victor.seconds))
            .sort((a, b) => {
                if (a.seconds !== b.seconds) return a.seconds - b.seconds;
                const aDate = getVictorSortValue(a);
                const bDate = getVictorSortValue(b);
                if (aDate == null && bDate == null) return 0;
                if (aDate == null) return 1;
                if (bDate == null) return -1;
                return aDate - bDate;
            });

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

        const bestTimeSeconds = timeRankings.length ? Number(timeRankings[0].seconds) : null;

        players.forEach((victor, index) => {
            const playerName = String(victor.name || "").trim();
            if (!playerName) return;
            const hasOtherVictor = players.length > 1;
            const canHoldRecord = hasOtherVictor;

            const tierKey = `${(lvl.tier || "unknown").toLowerCase()}|${playerName}`;
            const completions = playerTierCompletions.get(tierKey) || 0;
            const completionMultiplier = getTierCompletionMultiplier(completions);

            const timeScore = getTimeScore(Number(victor.seconds), bestTimeSeconds);
            const timeRank = timeRanks.get(playerName) || Number.POSITIVE_INFINITY;
            const attemptRank = attemptRanks.get(playerName) || Number.POSITIVE_INFINITY;
            const bonusMultiplier = 1 +
                getVictorOrderBonus(index) +
                (canHoldRecord && timeRank === 1 ? FASTEST_COMPLETION_BONUS : 0) +
                (canHoldRecord && attemptRank === 1 ? LOWEST_ATTEMPTS_BONUS : 0);

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

            map[playerName].points += lvl.points * timeScore * bonusMultiplier * completionMultiplier;
            map[playerName].levels.push(levelName);
            map[playerName].completionDetails.push({
                name: levelName,
                points: Number(lvl.points) || 0,
                tier: String(lvl.tier || "unknown").trim() || "unknown",
                listIndex: levelOrder.get(levelName.toLowerCase()) ?? Number.MAX_SAFE_INTEGER,
            });

            playerTierCompletions.set(tierKey, completions + 1);
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