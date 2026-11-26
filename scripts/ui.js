function flashSaved() {
  const flashElement = document.getElementById('save-flash');
  flashElement.classList.add('show');
  setTimeout(() => flashElement.classList.remove('show'), 2000);
}

function flashCopied() {
  const flashElement = document.getElementById('save-flash');
  flashElement.textContent = '✓ COPIED TO CLIPBOARD';
  flashElement.classList.add('show');
  setTimeout(() => {
    flashElement.classList.remove('show');
    flashElement.textContent = '✓ SAVED';
  }, 2000);
}

document.addEventListener('click', async (event) => {
  const metaItem = event.target.closest('.level-meta-item[data-copy-value]');
  if (!metaItem) return;

  try {
    await navigator.clipboard.writeText(metaItem.dataset.copyValue);
    flashCopied();
  } catch (error) {
    console.error('Failed to copy level metadata', error);
    alert('Unable to copy this value. Check clipboard permissions and try again.');
  }
});

document.addEventListener('click', (event) => {
  const scrollButton = event.target.closest('[data-scroll-edge]');
  if (!scrollButton) return;

  const top = scrollButton.dataset.scrollEdge === 'top';
  window.scrollTo({
    top: top ? 0 : document.documentElement.scrollHeight - window.innerHeight,
    behavior: 'smooth',
  });
});

document.addEventListener('click', (event) => {
  const jumpButton = event.target.closest('.btn-jump-level');
  if (!jumpButton) return;

  const levelMap = jumpButton.dataset.jumpScope === 'verification'
    ? renderedVerificationLevelsByCardKey
    : renderedLevelsByCardKey;
  const level = levelMap.get(jumpButton.dataset.jumpLevel);
  if (!level) return;

  if (jumpButton.dataset.jumpScope === 'verification') {
    jumpToVerificationLevel(level);
  } else {
    jumpToMainListLevel(level);
  }
});

const pageScrollButtonThreshold = 300;

function updatePageScrollButtonVisibility() {
  const topButton = document.querySelector('[data-scroll-edge="top"]');
  const bottomButton = document.querySelector('[data-scroll-edge="bottom"]');
  if (!topButton || !bottomButton) return;

  const maxScroll = document.documentElement.scrollHeight - window.innerHeight;
  const scrollTop = window.scrollY || document.documentElement.scrollTop;
  topButton.hidden = scrollTop <= pageScrollButtonThreshold;
  bottomButton.hidden = maxScroll - scrollTop <= pageScrollButtonThreshold;
}

window.addEventListener('scroll', updatePageScrollButtonVisibility, { passive: true });
window.addEventListener('resize', updatePageScrollButtonVisibility);
if ('ResizeObserver' in window) {
  const pageScrollResizeObserver = new ResizeObserver(updatePageScrollButtonVisibility);
  pageScrollResizeObserver.observe(document.body);
}
updatePageScrollButtonVisibility();

function renderStats() {
  const totalVictors = new Set(levels.flatMap(lvl => lvl.victors.map(victor => victor.name))).size;
  const totalCompletions = levels.reduce((sum, lvl) => sum + lvl.victors.length, 0);
  const rankedLevelCount = levels.filter(level => !level.isVariant).length;
  const totalTimeSeconds = leaderboard.reduce((sum, player) => sum + (Number.isFinite(player.totalTimeSeconds) ? player.totalTimeSeconds : 0), 0);
  const totalAttempts = leaderboard.reduce((sum, player) => sum + (Number.isFinite(player.totalAttempts) ? player.totalAttempts : 0), 0);

  document.getElementById('stats-strip').innerHTML = `
    <div class="stat-box"><span class="val">${rankedLevelCount}</span><span class="lbl">Levels Ranked</span></div>
    <div class="stat-box"><span class="val">${totalVictors}</span><span class="lbl">Unique Players</span></div>
    <div class="stat-box"><span class="val">${totalCompletions}</span><span class="lbl">Total Completions</span></div>
    <div class="stat-box"><span class="val">${formatDuration(totalTimeSeconds)}</span><span class="lbl">Total Time</span></div>
    <div class="stat-box"><span class="val">${totalAttempts.toLocaleString()}</span><span class="lbl">Total Attempts</span></div>
  `;
}

function formatDuration(seconds) {
  if (!Number.isFinite(seconds) || seconds <= 0) return '0s';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const parts = [];
  if (h) parts.push(`${h}h`);
  if (m) parts.push(`${m}m`);
  if (s || parts.length === 0) parts.push(`${s}s`);
  return parts.join(' ');
}

function getRatioStatisticsMarkup(ratio) {
  const tokens = [];
  const tokenPattern = /(?:^|\s)(0\.5X|1X|2X|3X|4X|IM|NM|[A-Z]+)(\d+(?:\.\d+)?)\((\d+)\)/gi;
  for (const match of String(ratio || '').matchAll(tokenPattern)) {
    tokens.push({
      key: match[1].toUpperCase(),
      percent: match[2],
      count: match[3],
    });
  }

  if (!tokens.length) return '';

  const modeLabels = {
    C: 'Cube',
    SH: 'Ship',
    B: 'Ball',
    U: 'UFO',
    W: 'Wave',
    R: 'Robot',
    SP: 'Spider',
    SW: 'Swing',
  };
  const groups = [
    { label: 'Gamemodes', keys: Object.keys(modeLabels), format: key => modeLabels[key] || key },
    { label: 'Play', keys: ['D', 'S', 'IM', 'NM'], format: key => ({ D: 'Dual', S: 'Solo', IM: 'Inverse Mirror', NM: 'Normal Mirror' })[key] },
    { label: 'Speed', keys: ['0.5X', '1X', '2X', '3X', '4X'], format: key => key.toLowerCase() },
  ];

  return `
    <section class="ratio-statistics" aria-label="Ratio statistics">
      <table class="victors-table ratio-statistics-table">
        <tbody>
        ${groups.map(group => {
          const groupTokens = tokens.filter(token => group.keys.includes(token.key));
          if (!groupTokens.length) return '';
          const groupRows = [];
          for (let index = 0; index < groupTokens.length; index += 6) {
            groupRows.push(groupTokens.slice(index, index + 6));
          }
          return `
            <tr class="ratio-statistics-group-row">
              <th colspan="6">${group.label}</th>
            </tr>
            ${groupRows.map(row => `
              <tr>
                ${row.map(token => `
                  <td class="ratio-statistics-entry">
                    <strong>${group.format(token.key)}</strong>
                    <span>${token.percent}%</span>
                    <small>${token.count} changes</small>
                  </td>
                `).join('')}
                ${Array.from({ length: 6 - row.length }, () => '<td></td>').join('')}
              </tr>
            `).join('')}
          `;
        }).join('')}
        </tbody>
      </table>
    </section>
  `;
}

const TARGETED_LEVELS_STORAGE_KEY = 'pml_targeted_levels';
let targetedLevelKeysCache = null;

function getTargetedLevelKey(level) {
  const sourceId = String(level?.id ?? '').trim();
  const sourceName = String(level?.name ?? '').trim();
  const key = sourceId || sourceName;
  return key ? key.toLowerCase() : '';
}

function getStoredTargetedLevels() {
  if (targetedLevelKeysCache) return [...targetedLevelKeysCache];

  try {
    const saved = JSON.parse(localStorage.getItem(TARGETED_LEVELS_STORAGE_KEY) || '[]');
    targetedLevelKeysCache = new Set(
      Array.isArray(saved)
        ? saved.filter((entry) => typeof entry === 'string').map((entry) => String(entry).trim().toLowerCase())
        : []
    );
  } catch (error) {
    targetedLevelKeysCache = new Set();
  }

  return [...targetedLevelKeysCache];
}

function getTargetedLevelSet() {
  getStoredTargetedLevels();
  return targetedLevelKeysCache;
}

function saveStoredTargetedLevels(keys) {
  const uniqueKeys = [...new Set(keys.filter(Boolean))];
  targetedLevelKeysCache = new Set(uniqueKeys);
  try {
    localStorage.setItem(TARGETED_LEVELS_STORAGE_KEY, JSON.stringify(uniqueKeys));
  } catch (error) {
    // localStorage may be unavailable
  }
}

window.addEventListener('storage', (event) => {
  if (event.key === null || event.key === TARGETED_LEVELS_STORAGE_KEY) targetedLevelKeysCache = null;
});

function isLevelTargeted(level) {
  const key = getTargetedLevelKey(level);
  if (!key) return false;
  return getTargetedLevelSet().has(key);
}

function toggleTargetLevel(level) {
  const key = getTargetedLevelKey(level);
  if (!key) return;

  const stored = getStoredTargetedLevels();
  const next = stored.includes(key)
    ? stored.filter((entry) => entry !== key)
    : [...stored, key];

  saveStoredTargetedLevels(next);
  renderTargetedLevels();
  renderLevels(getSortedLevelData(levels));
  filterVerifications();
}

function getTargetedLevelsFromData(sourceLevels) {
  const keyed = getTargetedLevelSet();
  if (!keyed.size) return [];

  return (sourceLevels || []).filter((level) => keyed.has(getTargetedLevelKey(level)));
}

function getTodoTierRankRange(level) {
  const tier = String(level?.tier || '').trim().toLowerCase();
  if (!tier) return null;

  const tierRanks = levels
    .filter((mainLevel) => !mainLevel.isVariant && String(mainLevel?.tier || '').trim().toLowerCase() === tier)
    .map((mainLevel) => Number(mainLevel.displayRank ?? mainLevel.rank))
    .filter((rank) => Number.isFinite(rank));

  if (!tierRanks.length) return null;
  return {
    min: Math.min(...tierRanks),
    max: Math.max(...tierRanks),
  };
}

function renderTargetedLevels() {
  const container = document.getElementById('todo-container');

  if (!container) return;
  unobserveLazyThumbnails(container);

  const targetedMain = getTargetedLevelsFromData(levels);
  const targetedUnverified = getTargetedLevelsFromData(verifications);
  const combined = [...targetedMain, ...targetedUnverified]
    .filter((level, index, list) => list.findIndex((entry) => getTargetedLevelKey(entry) === getTargetedLevelKey(level)) === index);

  if (!combined.length) {
    container.innerHTML = '<div class="empty-state">// NO TARGETED LEVELS // </div>';
    return;
  }

  const cards = combined
    .sort((a, b) => {
      const aRank = Number(a.sortRank ?? a.rank ?? Number.MAX_SAFE_INTEGER);
      const bRank = Number(b.sortRank ?? b.rank ?? Number.MAX_SAFE_INTEGER);
      if (Number.isFinite(aRank) && Number.isFinite(bRank) && aRank !== bRank) return aRank - bRank;
      return String(a.name || '').localeCompare(String(b.name || ''));
    })
    .map((lvl, index) => {
      const cardClass = index % 2 === 0 ? 'level-card variant-a' : 'level-card variant-b';
      const isMainList = levels.some((item) => getTargetedLevelKey(item) === getTargetedLevelKey(lvl));
      const sourceLabel = isMainList ? 'Main List' : 'Unverified';
      const buttonText = 'Remove Target';
      const tierRankRange = !isMainList ? getTodoTierRankRange(lvl) : null;
      const rankLabel = isMainList && lvl.isVariant
        ? ''
        : isMainList && Number.isFinite(Number(lvl.displayRank ?? lvl.rank))
          ? `#${lvl.displayRank ?? lvl.rank}`
        : tierRankRange
          ? `#${tierRankRange.min}-${tierRankRange.max}~`
          : '•';

      return `
        <div class="${cardClass}">
          <div class="rank-col">
            ${rankLabel ? `<span class="rank-num" aria-hidden="true">${rankLabel}</span>` : ''}
          </div>

          <div class="info-col">
            <div class="level-name">${escapeHTML(lvl.name || '')}</div>
            <div class="level-meta">
              ${getLevelMetaMarkup(lvl, sourceLabel)}
              ${isMainList && lvl.isVariant ? `<span class="level-meta-item variant-tag"><i class="fa-solid fa-code-branch" aria-hidden="true"></i><span>Variant of ${escapeHTML(lvl.variantParentName)}</span></span>` : ''}
            </div>
            ${getLevelSummaryRows(lvl).map((row) => `<div class="victor-row"><span class="victor-label">${escapeHTML(row.label || '')}:</span><span class="victor-name">${escapeHTML(row.name || '')}</span><span class="victor-stats">${escapeHTML(row.stat || '')}</span></div>`).join('')}
          </div>
          ${getThumbnailMarkup(lvl)}
          <div class="actions-col">
            <button class="btn-target-toggle targeted" type="button" data-target-level="${escapeHTML(getTargetedLevelKey(lvl))}" title="Remove target" aria-label="Remove target">
              <i class="fa-solid fa-xmark"></i>
            </button>
            ${lvl.showcaseVideoUrl ? `<button class="btn-video" type="button" data-open-video-modal="${escapeHTML(lvl.showcaseVideoUrl)}" title="Open showcase video" aria-label="Open showcase video"><i class="fa-solid fa-video"></i></button>` : '<span class="btn-video no-link" title="No video available"><i class="fa-solid fa-video-slash"></i></span>'}
          </div>
        </div>
      `;
    }).join('');

  container.innerHTML = cards;
  initLazyThumbnails(container);
}

const LB_SORT_STORAGE_KEY = 'pml_lb_sort_state';
const LB_SORT_DEFAULT_STATE = { key: 'rank', direction: 'asc' };
let leaderboardSortState = { ...LB_SORT_DEFAULT_STATE };

function loadLeaderboardSortState() {
  try {
    const stored = localStorage.getItem(LB_SORT_STORAGE_KEY);
    if (!stored) return LB_SORT_DEFAULT_STATE;
    const parsed = JSON.parse(stored);
    if (parsed && typeof parsed === 'object' && ['rank', 'name', 'completed', 'totalTime', 'totalAttempts', 'hardest'].includes(parsed.key) && ['asc', 'desc'].includes(parsed.direction)) {
      return parsed;
    }
  } catch (e) {
    // ignore invalid stored state
  }
  return LB_SORT_DEFAULT_STATE;
}

function saveLeaderboardSortState() {
  try {
    localStorage.setItem(LB_SORT_STORAGE_KEY, JSON.stringify(leaderboardSortState));
  } catch (e) {
    // localStorage may be unavailable
  }
}

function updateLeaderboardSortControls() {
  const sortSelect = document.getElementById('lb-sort-key');
  const directionBtn = document.getElementById('lb-sort-direction-btn');
  if (sortSelect) {
    sortSelect.value = leaderboardSortState.key;
  }
  if (directionBtn) {
    directionBtn.textContent = leaderboardSortState.direction === 'asc' ? '▲' : '▼';
    directionBtn.title = leaderboardSortState.direction === 'asc' ? 'Ascending order' : 'Descending order';
  }
}

function initializeLeaderboardSortState() {
  leaderboardSortState = loadLeaderboardSortState();
  updateLeaderboardSortControls();
}

const LIST_SORT_STORAGE_KEY = 'pml_list_sort_state';
const LIST_SORT_DEFAULT_STATE = { key: 'rank', direction: 'asc' };
const LIST_SORT_RATIO_KEYS = [
  'coverageShip', 'coverageUfo', 'coverageRobot', 'coverageSwing', 'coverageCube',
  'coverageBall', 'coverageSpider', 'coverageWave', 'coverageDual', 'mirrorChanges',
];
const LIST_SORT_SPEED_MULTIPLIERS = new Map([['0.5X', 0.5], ['1X', 1], ['2X', 2], ['3X', 3], ['4X', 4]]);
const LIST_SORT_SPEED_PATTERN = /(?:^|\s)(0\.5X|1X|2X|3X|4X)(\d+(?:\.\d+)?)\(\d+\)/gi;
const LIST_SORT_KEYS = [
  'rank', 'name', 'creators', 'victors', 'averageTime', 'averageAttempts',
  'precision', 'iaPerSecond', 'earliestDate', 'length', ...LIST_SORT_RATIO_KEYS, 'speed', 'id',
];
let listSortState = { ...LIST_SORT_DEFAULT_STATE };
const VERIFICATION_SORT_STORAGE_KEY = 'pml_verification_sort_state';
const VERIFICATION_SORT_DEFAULT_STATE = { key: 'estimatedRank', direction: 'asc' };
let verificationSortState = { ...VERIFICATION_SORT_DEFAULT_STATE };

function migrateListSortState(parsed) {
  if (!parsed || typeof parsed !== 'object' || !['asc', 'desc'].includes(parsed.direction)) return null;
  const state = { ...parsed };
  if (state.key === 'longestLength' || state.key === 'shortestLength') {
    state.key = 'length';
  } else if (state.key === 'fastestSpeed' || state.key === 'slowestSpeed') {
    state.key = 'speed';
  }
  return LIST_SORT_KEYS.includes(state.key) ? state : null;
}

function loadListSortState() {
  try {
    const stored = localStorage.getItem(LIST_SORT_STORAGE_KEY);
    if (!stored) return { ...LIST_SORT_DEFAULT_STATE };
    const parsed = migrateListSortState(JSON.parse(stored));
    if (parsed) return parsed;
  } catch (e) {
    // ignore invalid stored state
  }
  return { ...LIST_SORT_DEFAULT_STATE };
}

function saveListSortState() {
  try {
    localStorage.setItem(LIST_SORT_STORAGE_KEY, JSON.stringify(listSortState));
  } catch (e) {
    // localStorage may be unavailable
  }
}

function updateListSortControls() {
  const sortSelect = document.getElementById('list-sort-key');
  const directionBtn = document.getElementById('list-sort-direction-btn');
  if (sortSelect) {
    sortSelect.value = listSortState.key;
  }
  if (directionBtn) {
    directionBtn.textContent = listSortState.direction === 'asc' ? '▲' : '▼';
    directionBtn.title = listSortState.direction === 'asc' ? 'Ascending order' : 'Descending order';
  }
}

function initializeListSortState() {
  listSortState = loadListSortState();
  updateListSortControls();
}

function handleListSortChange() {
  const sortSelect = document.getElementById('list-sort-key');
  if (!sortSelect) return;
  listSortState.key = sortSelect.value;
  if (listSortState.key === 'length' || listSortState.key === 'speed'
    || listSortState.key === 'precision' || listSortState.key === 'iaPerSecond'
    || LIST_SORT_RATIO_KEYS.includes(listSortState.key)) listSortState.direction = 'desc';
  saveListSortState();
  updateListSortControls();
  filterList(document.getElementById('list-search').value || '');
}

function toggleListSortDirection() {
  listSortState.direction = listSortState.direction === 'asc' ? 'desc' : 'asc';
  saveListSortState();
  updateListSortControls();
  filterList(document.getElementById('list-search').value || '');
}

function getRatioSortValue(ratio, key, metric) {
  const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = String(ratio || '').match(new RegExp(`(?:^|\\s)${escapedKey}(\\d+(?:\\.\\d+)?)\\((\\d+)\\)`, 'i'));
  if (!match) return 0;
  return Number(match[metric === 'count' ? 2 : 1]);
}

function getAverageSpeedMultiplier(ratio, direction = 1) {
  let weightedSpeed = 0;
  let totalPercent = 0;

  for (const match of String(ratio || '').matchAll(LIST_SORT_SPEED_PATTERN)) {
    const percent = Number(match[2]);
    const multiplier = LIST_SORT_SPEED_MULTIPLIERS.get(match[1].toUpperCase());
    if (!Number.isFinite(percent) || !Number.isFinite(multiplier)) continue;
    weightedSpeed += multiplier * percent;
    totalPercent += percent;
  }

  return totalPercent > 0
    ? weightedSpeed / totalPercent
    : (direction === 1 ? Number.POSITIVE_INFINITY : Number.NEGATIVE_INFINITY);
}

function getListSortValue(item, key, direction = 1) {
  switch (key) {
    case 'rank': {
      const value = Number.isFinite(Number(item.sortRank ?? item.rank)) ? Number(item.sortRank ?? item.rank) : null;
      return value !== null ? value : (direction === 1 ? Number.MAX_SAFE_INTEGER : Number.MIN_SAFE_INTEGER);
    }
    case 'name':
      return String(item.name || '').toLowerCase();
    case 'creators':
      return normalizeLevelSearchText(getLevelCreatorValue(item));
    case 'victors':
      return Array.isArray(item.victors) ? item.victors.length : 0;
    case 'averageTime': {
      const times = (item.victors || [])
        .map((victor) => victor.seconds)
        .filter((seconds) => Number.isFinite(seconds) && seconds > 0);
      return times.length
        ? times.reduce((sum, seconds) => sum + seconds, 0) / times.length
        : (direction === 1 ? Number.POSITIVE_INFINITY : Number.NEGATIVE_INFINITY);
    }
    case 'averageAttempts': {
      const attempts = (item.victors || [])
        .map((victor) => victor.attempts)
        .filter((value) => Number.isFinite(value) && value > 0);
      return attempts.length
        ? attempts.reduce((sum, value) => sum + value, 0) / attempts.length
        : (direction === 1 ? Number.POSITIVE_INFINITY : Number.NEGATIVE_INFINITY);
    }
    case 'precision': {
      const value = Number(item.precision ?? item.Precision);
      return Number.isFinite(value) && value > 0
        ? value
        : (direction === 1 ? Number.POSITIVE_INFINITY : Number.NEGATIVE_INFINITY);
    }
    case 'iaPerSecond': {
      const value = Number(item.iaPerSecond ?? item.inputActivityPerSecond);
      return Number.isFinite(value) && value > 0
        ? value
        : (direction === 1 ? Number.POSITIVE_INFINITY : Number.NEGATIVE_INFINITY);
    }
    case 'earliestDate': {
      if (!Array.isArray(item.victors) || !item.victors.length) {
        return direction === 1 ? Number.POSITIVE_INFINITY : Number.NEGATIVE_INFINITY;
      }
      let earliest = Number.POSITIVE_INFINITY;
      for (const victor of item.victors) {
        const value = Date.parse(String(victor.date || '').trim());
        if (!Number.isNaN(value) && value < earliest) earliest = value;
      }
      if (earliest === Number.POSITIVE_INFINITY) {
        return direction === 1 ? Number.POSITIVE_INFINITY : Number.NEGATIVE_INFINITY;
      }
      return earliest;
    }
    case 'length': {
      const seconds = parseDurationToSeconds(item.length) ?? parseDurationToSeconds(item.levelLength);
      return seconds !== null && seconds > 0
        ? seconds
        : (direction === 1 ? Number.POSITIVE_INFINITY : Number.NEGATIVE_INFINITY);
    }
    case 'coverageShip':
      return getRatioSortValue(item.ratio, 'SH', 'percent');
    case 'coverageUfo':
      return getRatioSortValue(item.ratio, 'U', 'percent');
    case 'coverageRobot':
      return getRatioSortValue(item.ratio, 'R', 'percent');
    case 'coverageSwing':
      return getRatioSortValue(item.ratio, 'SW', 'percent');
    case 'coverageCube':
      return getRatioSortValue(item.ratio, 'C', 'percent');
    case 'coverageBall':
      return getRatioSortValue(item.ratio, 'B', 'percent');
    case 'coverageSpider':
      return getRatioSortValue(item.ratio, 'SP', 'percent');
    case 'coverageWave':
      return getRatioSortValue(item.ratio, 'W', 'percent');
    case 'coverageDual':
      return getRatioSortValue(item.ratio, 'D', 'percent');
    case 'mirrorChanges':
      return getRatioSortValue(item.ratio, 'IM', 'count') + getRatioSortValue(item.ratio, 'NM', 'count');
    case 'speed':
      return getAverageSpeedMultiplier(item.ratio, direction);
    case 'id': {
      const idValue = String(item.id || '').trim();
      const numeric = Number(idValue);
      return Number.isFinite(numeric) ? numeric : idValue.toLowerCase();
    }
    default:
      return String(item.name || '').toLowerCase();
  }
}

function getSortedLevelData(data) {
  if (!Array.isArray(data)) return [];
  const sorted = [...data];
  const direction = listSortState.direction === 'asc' ? 1 : -1;
  sorted.sort((a, b) => {
    const aValue = getListSortValue(a, listSortState.key, direction);
    const bValue = getListSortValue(b, listSortState.key, direction);

    if (typeof aValue === 'string' && typeof bValue === 'string') {
      return aValue.localeCompare(bValue) * direction;
    }
    if (aValue < bValue) return -1 * direction;
    if (aValue > bValue) return 1 * direction;
    return 0;
  });
  return sorted;
}

function handleLeaderboardSortChange() {
  const sortSelect = document.getElementById('lb-sort-key');
  if (!sortSelect) return;
  leaderboardSortState.key = sortSelect.value;
  saveLeaderboardSortState();
  updateLeaderboardSortControls();
  filterLeaderboard();
}

function toggleLeaderboardSortDirection() {
  leaderboardSortState.direction = leaderboardSortState.direction === 'asc' ? 'desc' : 'asc';
  saveLeaderboardSortState();
  updateLeaderboardSortControls();
  filterLeaderboard();
}

function getLeaderboardSortValue(item, key, direction = 1) {
  switch (key) {
    case 'rank': {
      const value = Number.isFinite(item.rank) ? item.rank : null;
      return value !== null ? value : (direction === 1 ? Number.MAX_SAFE_INTEGER : Number.MIN_SAFE_INTEGER);
    }
    case 'name':
      return String(item.name || '').toLowerCase();
    case 'completed':
      return Number.isFinite(item.completionCount) ? item.completionCount : 0;
    case 'totalTime': {
      const value = Number.isFinite(item.totalTimeSeconds) && item.totalTimeSeconds > 0 ? item.totalTimeSeconds : null;
      return value !== null ? value : (direction === 1 ? Number.POSITIVE_INFINITY : Number.NEGATIVE_INFINITY);
    }
    case 'totalAttempts': {
      const value = Number.isFinite(item.totalAttempts) && item.totalAttempts > 0 ? item.totalAttempts : null;
      return value !== null ? value : (direction === 1 ? Number.POSITIVE_INFINITY : Number.NEGATIVE_INFINITY);
    }
    case 'hardest':
      return item.hardestCompletion && Number.isFinite(item.hardestCompletion.points)
        ? item.hardestCompletion.points
        : 0;
    default:
      return item.rank ?? Number.MAX_SAFE_INTEGER;
  }
}

function getSortedLeaderboardData(data) {
  if (!Array.isArray(data)) return [];
  const sorted = [...data];
  const direction = leaderboardSortState.direction === 'asc' ? 1 : -1;
  sorted.sort((a, b) => {
    if (leaderboardSortState.key === 'rank') {
      const aValue = Number.isFinite(a.rank) ? a.rank : (direction === 1 ? Number.MAX_SAFE_INTEGER : Number.MIN_SAFE_INTEGER);
      const bValue = Number.isFinite(b.rank) ? b.rank : (direction === 1 ? Number.MAX_SAFE_INTEGER : Number.MIN_SAFE_INTEGER);
      if (aValue < bValue) return -1 * direction;
      if (aValue > bValue) return 1 * direction;
      return 0;
    }

    const aValue = getLeaderboardSortValue(a, leaderboardSortState.key, direction);
    const bValue = getLeaderboardSortValue(b, leaderboardSortState.key, direction);

    if (typeof aValue === 'string' && typeof bValue === 'string') {
      return aValue.localeCompare(bValue) * direction;
    }
    if (aValue < bValue) return -1 * direction;
    if (aValue > bValue) return 1 * direction;
    return 0;
  });
  return sorted;
}

function normalizeLevelSearchText(value) {
  return String(value || '').trim().toLowerCase();
}

function getLevelCreatorValue(level) {
  const candidates = [level?.creators, level?.creator, level?.author];

  for (const value of candidates) {
    if (Array.isArray(value)) {
      const joined = value
        .map((entry) => String(entry ?? '').trim())
        .filter(Boolean)
        .join(', ');

      if (joined) return joined;
      continue;
    }

    const text = String(value ?? '').trim();
    if (text) return text;
  }

  return '';
}

function getLevelNameMatchScore(levelName, query) {
  const normalizedLevelName = normalizeLevelSearchText(levelName);
  const normalizedQuery = normalizeLevelSearchText(query);

  if (!normalizedQuery) return 0;
  if (normalizedLevelName === normalizedQuery) return 1000;
  if (normalizedLevelName.startsWith(normalizedQuery)) return 900;
  if (normalizedLevelName.includes(normalizedQuery)) return 700;

  const normalizedLevelNameNoParens = normalizedLevelName.replace(/\s*\([^)]*\)/g, '').trim();
  const normalizedQueryNoParens = normalizedQuery.replace(/\s*\([^)]*\)/g, '').trim();

  if (normalizedLevelNameNoParens === normalizedQueryNoParens) return 650;
  if (normalizedLevelNameNoParens.startsWith(normalizedQueryNoParens)) return 600;
  if (normalizedLevelNameNoParens.includes(normalizedQueryNoParens)) return 500;

  return 0;
}

function getRankedLevelMatches(query, sourceLevels) {
  const normalizedQuery = normalizeLevelSearchText(query);
  const matches = sourceLevels
    .map((lvl) => {
      const nameScore = getLevelNameMatchScore(lvl.name, normalizedQuery);
      const creatorScore = normalizeLevelSearchText(getLevelCreatorValue(lvl)).includes(normalizedQuery) ? 300 : 0;
      const idScore = String(lvl.id).includes(normalizedQuery) ? 200 : 0;
      const score = Math.max(nameScore, creatorScore, idScore);
      return { lvl, score };
    })
    .filter((entry) => entry.score > 0)
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return a.lvl.name.localeCompare(b.lvl.name);
    })
    .map((entry) => entry.lvl);

  return matches;
}

function getLevelCardKey(level, index) {
  const baseId = String(level.id || '').replace(/[^a-z0-9-_]+/gi, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
  const namePart = normalizeLevelSearchText(level.name).replace(/[^a-z0-9]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
  return `${baseId || namePart || 'level'}-${namePart || index}-${index}`;
}

function getLevelTpsDisplayValue(level) {
  const raw = level?.tps;
  if (raw === null || raw === undefined || raw === "" || (typeof raw === "string" && raw.trim() === "") || Number(raw) === 0) {
    return null;
  }

  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

const GAMEMODE_LEVEL_TAGS = Object.freeze([
  { key: "gamemode:cube", label: "Cube", ratioKey: "C" },
  { key: "gamemode:ship", label: "Ship", ratioKey: "SH" },
  { key: "gamemode:ball", label: "Ball", ratioKey: "B" },
  { key: "gamemode:ufo", label: "UFO", ratioKey: "U" },
  { key: "gamemode:wave", label: "Wave", ratioKey: "W" },
  { key: "gamemode:robot", label: "Robot", ratioKey: "R" },
  { key: "gamemode:spider", label: "Spider", ratioKey: "SP" },
  { key: "gamemode:swing", label: "Swing", ratioKey: "SW" },
]);

const AUTOMATIC_LEVEL_TAG_OPTIONS = Object.freeze([
  ...GAMEMODE_LEVEL_TAGS,
  { key: "dual", label: "Dual" },
  { key: "mirror-portals", label: "Mirror Portals" },
  { key: "challenge", label: "Challenge" },
  { key: "xl", label: "XL" },
  { key: "xxl", label: "XXL" },
  { key: "fast-paced", label: "Fast-Paced" },
]);

const AUTOMATIC_LEVEL_TAG_THRESHOLDS = Object.freeze({
  gamemodeCoveragePercent: 15,
  dualCoveragePercent: 15,
  mirrorPortalChanges: 5,
  mirrorCoveragePercent: 5,
  fastPacedSpeedPercent: 40,
});

function getLevelTagDefinitions(level) {
  const tags = [];
  const ratio = String(level?.ratio || "");
  const overrides = normalizeLevelTagOverrides(level?.tagOverrides);
  const calculatedTags = new Map();
  const addAutomaticTag = (key, label, title) => {
    calculatedTags.set(key, { label, title, type: "auto" });
  };

  const gamemodeTags = GAMEMODE_LEVEL_TAGS
    .map((gamemode, index) => {
      const coverage = getRatioSortValue(ratio, gamemode.ratioKey, "percent");
      if (coverage >= AUTOMATIC_LEVEL_TAG_THRESHOLDS.gamemodeCoveragePercent) {
        addAutomaticTag(
          gamemode.key,
          gamemode.label,
          `${gamemode.label} coverage: ${coverage}% (threshold: ${AUTOMATIC_LEVEL_TAG_THRESHOLDS.gamemodeCoveragePercent}%)`,
        );
      }

      return {
        index,
        coverage,
        tag: getEffectiveAutomaticTag(gamemode, calculatedTags, overrides),
      };
    })
    .filter(({ tag }) => tag)
    .sort((a, b) => b.coverage - a.coverage || a.index - b.index)
    .map(({ tag }) => tag);

  const dualCoverage = getRatioSortValue(ratio, "D", "percent");
  if (dualCoverage >= AUTOMATIC_LEVEL_TAG_THRESHOLDS.dualCoveragePercent) {
    addAutomaticTag(
      "dual",
      "Dual",
      `Dual coverage: ${dualCoverage}% (threshold: ${AUTOMATIC_LEVEL_TAG_THRESHOLDS.dualCoveragePercent}%)`,
    );
  }

  const inverseMirrorCoverage = getRatioSortValue(ratio, "IM", "percent");
  const normalMirrorCoverage = getRatioSortValue(ratio, "NM", "percent");
  const mirrorChanges = getRatioSortValue(ratio, "IM", "count")
    + getRatioSortValue(ratio, "NM", "count");
  if (mirrorChanges >= AUTOMATIC_LEVEL_TAG_THRESHOLDS.mirrorPortalChanges
    && inverseMirrorCoverage >= AUTOMATIC_LEVEL_TAG_THRESHOLDS.mirrorCoveragePercent
    && normalMirrorCoverage >= AUTOMATIC_LEVEL_TAG_THRESHOLDS.mirrorCoveragePercent) {
    addAutomaticTag(
      "mirror-portals",
      "Mirror Portals",
      `${mirrorChanges} changes (minimum ${AUTOMATIC_LEVEL_TAG_THRESHOLDS.mirrorPortalChanges}); normal ${normalMirrorCoverage}% and inverse ${inverseMirrorCoverage}% (each minimum ${AUTOMATIC_LEVEL_TAG_THRESHOLDS.mirrorCoveragePercent}%)`,
    );
  }

  const lengthSeconds = parseDurationToSeconds(level?.length ?? level?.levelLength);
  if (lengthSeconds !== null && lengthSeconds > 0 && lengthSeconds < 30) {
    addAutomaticTag("challenge", "Challenge", `Level length: ${lengthSeconds} seconds`);
  } else if (lengthSeconds !== null && lengthSeconds >= 120 && lengthSeconds < 240) {
    addAutomaticTag("xl", "XL", `Level length: ${lengthSeconds} seconds`);
  } else if (lengthSeconds !== null && lengthSeconds >= 240) {
    addAutomaticTag("xxl", "XXL", `Level length: ${lengthSeconds} seconds`);
  }

  const fastPacedSpeedPercent = ["2X", "3X", "4X"]
    .reduce((total, key) => total + getRatioSortValue(ratio, key, "percent"), 0);
  if (fastPacedSpeedPercent >= AUTOMATIC_LEVEL_TAG_THRESHOLDS.fastPacedSpeedPercent) {
    addAutomaticTag(
      "fast-paced",
      "Fast-Paced",
      `${fastPacedSpeedPercent}% of gameplay at 2x speed or higher (threshold: ${AUTOMATIC_LEVEL_TAG_THRESHOLDS.fastPacedSpeedPercent}%)`,
    );
  }

  tags.push(...gamemodeTags);
  AUTOMATIC_LEVEL_TAG_OPTIONS.slice(GAMEMODE_LEVEL_TAGS.length).forEach((option) => {
    const tag = getEffectiveAutomaticTag(option, calculatedTags, overrides);
    if (tag) tags.push(tag);
  });

  normalizeManualLevelTags(level?.tags).forEach((label) => {
    tags.push({ label, title: "Manual tag", type: "manual" });
  });
  return tags;
}

function getEffectiveAutomaticTag(option, calculatedTags, overrides) {
  if (overrides[option.key] === false) return null;
  const calculatedTag = calculatedTags.get(option.key);
  if (calculatedTag) return calculatedTag;
  if (overrides[option.key] === true) {
    return { label: option.label, title: "Always shown for this level", type: "auto" };
  }
  return null;
}

const LEVEL_TAG_ICONS = Object.freeze({
  Dual: "fa-clone",
  "Mirror Portals": "fa-right-left",
  Challenge: "fa-hourglass-start",
  XL: "fa-hourglass-half",
  XXL: "fa-hourglass-end",
  "Fast-Paced": "fa-gauge-high",
  Memory: "fa-brain",
  "2P": "fa-user-group",
  Unbalanced: "fa-scale-unbalanced",
  Flow: "fa-water",
  Timings: "fa-stopwatch",
  Spam: "fa-burst",
  "TPS Switches": "fa-toggle-on",
  Swifts: "fa-feather-pointed",
  Chokepoints: "fa-filter",
  Bossfight: "fa-dragon",
  "Pre-2.1": "fa-clock-rotate-left",
  Tentative: "fa-circle-question",
  Alignments: "fa-align-center",
  Snaps: "fa-crosshairs",
  Counters: "fa-calculator",
});

const LEVEL_TAG_SVGS = Object.freeze({
  Cube: `<svg class="level-tag-icon-svg" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="currentColor" aria-hidden="true"><rect x="12" y="12" width="40" height="40"/></svg>`,
  Ship: `<svg class="level-tag-icon-svg" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="currentColor" aria-hidden="true"><path d="M5 29h20l8-10h8l-3 10 20 3-20 3 3 10h-8l-8-10H5z"/></svg>`,
  Ball: `<svg class="level-tag-icon-svg" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="currentColor" aria-hidden="true"><circle cx="32" cy="32" r="22"/></svg>`,
  UFO: `<svg class="level-tag-icon-svg" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="currentColor" aria-hidden="true"><path fill-rule="evenodd" d="M5 38c4-9 15-14 27-14s23 5 27 14c-4 8-15 12-27 12S9 46 5 38z M28 38a4 4 0 1 0 8 0a4 4 0 1 0 -8 0z"/><path d="M22 27a10 10 0 0 1 20 0" fill="none" stroke="currentColor" stroke-width="4"/></svg>`,
  Wave: `<svg class="level-tag-icon-svg" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="currentColor" aria-hidden="true"><path d="M54 10L10 28l18 8 8 18z"/></svg>`,
  Robot: `<svg class="level-tag-icon-svg" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="currentColor" aria-hidden="true"><path fill-rule="evenodd" d="M16 20h32v30H16z M23 30h6v6h-6z M35 30h6v6h-6z"/><path d="M32 10v10" fill="none" stroke="currentColor" stroke-width="4"/><circle cx="32" cy="8" r="3"/></svg>`,
  Spider: `<svg class="level-tag-icon-svg" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="32" cy="32" r="9" fill="currentColor" stroke="none"/><path d="M25 26 17 16 10 18M23 30 10 27 6 31M23 35 10 38 6 35M25 39 17 49 10 47M39 26 47 16 54 18M41 30 54 27 58 31M41 35 54 38 58 35M39 39 47 49 54 47"/></svg>`,
  Swing: `<svg class="level-tag-icon-svg" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="currentColor" aria-hidden="true"><path fill-rule="evenodd" d="M32 8a24 24 0 1 0 0 48a24 24 0 1 0 0-48z M41 23a6 6 0 1 0 0 12a6 6 0 1 0 0-12z"/><path d="M3 20h9v7H3zM52 37h9v7h-9z"/></svg>`,
  Circles: `<svg class="level-tag-icon-svg" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="currentColor" aria-hidden="true"><rect x="16" y="16" width="32" height="32" transform="rotate(45 32 32)"/></svg>`,
  Timings: `<svg class="level-tag-icon-svg" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="currentColor" aria-hidden="true"><path fill-rule="evenodd" d="M32 6L58 56H6z M32 22L46 48H18z"/></svg>`,
  "Fast-Paced": `<svg class="level-tag-icon-svg" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 12L32 32L12 52M34 12L54 32L34 52"/></svg>`,
  Flow: `<svg class="level-tag-icon-svg" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="5" stroke-linecap="round" aria-hidden="true"><path d="M6 44C18 4 28 4 32 32S46 60 58 20"/></svg>`,
  Snaps: `<svg class="level-tag-icon-svg" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="8" stroke-linejoin="miter" aria-hidden="true"><path d="M14 8V50H56"/></svg>`,
});

const LEVEL_TAG_COLORS = Object.freeze({
  Cube: "#4aff59",
  Ship: "#ff98ff",
  Ball: "#ff5f36",
  UFO: "#ff9c00",
  Wave: "#25daff",
  Robot: "#e0e0df",
  Spider: "#7843ff",
  Swing: "#ffff7c",
  Dual: "#ffc600",
  "Mirror Portals": "#67d4ff",
  Challenge: "#bb9172",
  XL: "#ffbc6f",
  XXL: "#ff7968",
  "Fast-Paced": "#fb1f73",
  Memory: "#f5a9ff",
  Circles: "#ca0000",
  "2P": "#ff5e00",
  Unbalanced: "#f87171",
  Flow: "#29ffe3",
  Timings: "#a78bfa",
  Spam: "#ff6b6b",
  "TPS Switches": "#e9d5ff",
  Swifts: "#bef264",
  Chokepoints: "#888888",
  Bossfight: "#e11d48",
  "Pre-2.1": "#93c5fd",
  Tentative: "#cbd5e1",
  Alignments: "#f0abfc",
  Snaps: "#fbbf24",
  Counters: "#607cfa",
});

function getLevelTagsMarkup(level) {
  const tags = getLevelTagDefinitions(level)
    .filter(({ label }) => !(level.is2Player && (label === "2P" || label === "Dual")));
  if (!tags.length) return "";
  return tags.map(({ label, title, type }) => {
    const color = LEVEL_TAG_COLORS[label] || (type === "auto" ? "#65d8ff" : "#a682ff");
    const iconMarkup = LEVEL_TAG_SVGS[label]
      || `<i class="fa-solid ${LEVEL_TAG_ICONS[label] || "fa-tag"}" aria-hidden="true"></i>`;
    return `<span class="level-meta-item level-tag level-tag-${type}" style="--level-tag-color:${color}" title="${escapeHTML(title)}">${iconMarkup}<span>${escapeHTML(label)}</span></span>`;
  }).join("");
}

function getLevelMetaMarkup(level, creatorLabel = getLevelCreatorValue(level)) {
  const metaItems = [];
  const addMetaItem = (type, icon, value, copyValue = value) => {
    if (!value) return;
    metaItems.push(`<button type="button" class="level-meta-item ${type}" data-copy-value="${escapeHTML(copyValue)}" title="Click to copy" aria-label="Copy ${escapeHTML(value)}"><i class="fa-solid ${icon}" aria-hidden="true"></i><span>${escapeHTML(value)}</span></button>`);
  };

  addMetaItem('creator', 'fa-hammer', creatorLabel);
  addMetaItem('tier', 'fa-layer-group', level.tier);

  const verificationStatus = String(level.verificationStatus || '').trim();
  addMetaItem('verification-status', 'fa-circle-check', verificationStatus);

  const tpsValue = getLevelTpsDisplayValue(level);
  if (tpsValue !== null) addMetaItem('tps', 'fa-gauge-high', `TPS: ${tpsValue}`, String(tpsValue));

  const precision = Number(level.precision ?? level.Precision);
  if (Number.isFinite(precision) && precision > 0) {
    addMetaItem('precision', 'fa-crosshairs', `Precision: ${precision.toFixed(2)}`, precision.toFixed(2));
  }

  const iaPerSecond = Number(level.iaPerSecond ?? level.inputActivityPerSecond);
  if (Number.isFinite(iaPerSecond) && iaPerSecond > 0) {
    addMetaItem('ia-per-second', 'fa-keyboard', `Input Activity: ${iaPerSecond.toFixed(2)}`, iaPerSecond.toFixed(2));
  }

  const idValue = String(level.id ?? '').trim();
  if (idValue) addMetaItem('id', 'fa-hashtag', idValue);
  if (level.is2Player) addMetaItem('two-player', 'fa-user-group', '2-Player');

  const tagsMarkup = getLevelTagsMarkup(level);
  if (tagsMarkup) metaItems.push(tagsMarkup);

  return metaItems.join('');
}

function getLevelSummaryRows(level) {
  const entries = [];

  if (level.firstVictor && level.firstVictor.name) {
    entries.push({
      name: level.firstVictor.name,
      label: 'First Victor',
      value: level.firstVictor.date || '—',
    });
  }

  if (level.wrTime && level.wrTime.name) {
    entries.push({
      name: level.wrTime.name,
      label: 'WR Time',
      value: level.wrTime.time,
    });
  }

  if (level.wrAttempts && level.wrAttempts.name) {
    const attemptsValue = level.wrAttempts.attempts != null
      ? `${level.wrAttempts.attempts} atts`
      : '—';
    entries.push({
      name: level.wrAttempts.name,
      label: 'WR Attempts',
      value: attemptsValue,
    });
  }

  const grouped = new Map();
  entries.forEach((entry) => {
    const key = String(entry.name || '').trim().toLowerCase();
    if (!key) return;
    if (!grouped.has(key)) {
      grouped.set(key, { name: entry.name.trim(), labels: [], stats: [] });
    }
    const row = grouped.get(key);
    row.labels.push(entry.label);
    row.stats.push(entry.value);
  });

  return Array.from(grouped.values()).map((row) => ({
    name: row.name,
    label: row.labels.join(' • '),
    stat: row.stats.join(' • '),
  }));
}

const thumbnailCache = new Map();
const renderedLevelsByCardKey = new Map();
const renderedVerificationLevelsByCardKey = new Map();
const expandedVariantGroups = new Set();
const expandedLevelKeys = new Set();
const virtualLevelHeightCache = new Map();
const VIRTUAL_LEVEL_OVERSCAN = 8;
const VIRTUAL_LEVEL_ESTIMATE_DESKTOP = 190;
const VIRTUAL_LEVEL_ESTIMATE_MOBILE = 260;
let virtualLevelGroups = [];
let virtualLevelGroupRenderer = null;
let virtualLevelPrefixHeights = [0];
let virtualLevelRenderedRange = null;
let virtualLevelResizeObserver = null;
let virtualLevelRenderScheduled = false;
let virtualLevelViewportWidth = window.innerWidth;
let thumbnailObserver = null;
let timelineLoadPromise = null;

function escapeHTML(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function truncateDisplayText(value, maxLength) {
  const text = String(value ?? '');
  if (text.length <= maxLength) return text;
  return `${Array.from(text).slice(0, Math.max(0, maxLength - 3)).join('')}...`;
}

const COUNTRY_NAMES = {
  AR: 'Argentina',
  BR: 'Brazil',
  BY: 'Belarus',
  CA: 'Canada',
  CO: 'Colombia',
  DE: 'Germany',
  ES: 'Spain',
  GB: 'United Kingdom',
  HU: 'Hungary',
  IE: 'Ireland',
  IL: 'Israel',
  KR: 'South Korea',
  NZ: 'New Zealand',
  PH: 'Philippines',
  RO: 'Romania',
  RU: 'Russia',
  UA: 'Ukraine',
  US: 'United States',
  VN: 'Vietnam',
};

function getPlayerCountryFlagMarkup(name) {
  if (!name || typeof name !== 'string') return '';
  const code = window.playerCountries && window.playerCountries[name.trim()];
  if (!code || typeof code !== 'string' || !/^[a-z]{2}$/i.test(code)) return '';
  const normalizedCode = code.toUpperCase();
  const countryName = COUNTRY_NAMES[normalizedCode];
  if (!countryName) return '';
  const escapedCountryName = escapeHTML(countryName);
  return `<img class="country-flag" src="public/flags/${normalizedCode.toLowerCase()}.svg" alt="${escapedCountryName} flag" title="${escapedCountryName}" loading="lazy" decoding="async">`;
}

function getThumbnailMarkup(level) {
  const explicitThumbnail = String(level.thumbnail || '').trim();
  const levelId = String(level.id || '').trim();
  const levelName = String(level.name || level.levelName || '').trim();
  const victorVideoUrls = (level.victors || [])
    .map(v => v.victorVideoUrl)
    .filter(Boolean);
  const cacheKey = JSON.stringify([
    levelId,
    levelName,
    explicitThumbnail,
    level.showcaseVideoUrl || '',
    victorVideoUrls,
  ]);
  if (thumbnailCache.has(cacheKey)) {
    return thumbnailCache.get(cacheKey);
  }

  let markup = '';

  if (explicitThumbnail) {
    markup = `
      <div class="thumb-col">
        <img class="lazy-thumb"
             data-src="${escapeHTML(explicitThumbnail)}"
             data-id="${escapeHTML(levelId)}"
             alt="${escapeHTML(levelName)}"
             loading="lazy"
             decoding="async"
             fetchpriority="low">
      </div>`;
  } else {
    const candidates = window.getThumbnailUrlSequence
      ? window.getThumbnailUrlSequence(
          '',
          level.showcaseVideoUrl || '',
          '',
          level.id,
          victorVideoUrls
        )
      : [];

    const unique = [...new Set(candidates.filter(Boolean))];

    if (unique.length) {
      markup = `
        <div class="thumb-col">
          <img class="lazy-thumb"
               data-src="${escapeHTML(unique[0])}"
               data-fallbacks="${encodeURIComponent(JSON.stringify(unique.slice(1)))}"
               data-id="${escapeHTML(levelId)}"
               alt="${escapeHTML(levelName)}"
               loading="lazy"
               decoding="async"
               fetchpriority="low"
               onerror="tryThumbnailFallback(this)">
        </div>`;
    }
  }

  thumbnailCache.set(cacheKey, markup);
  return markup;
}
function openVideoModal(url) {
  const modal = document.getElementById('video-modal');
  const iframe = document.getElementById('video-modal-iframe');
  if (!modal || !iframe) return;

  const embedUrl = window.getEmbedVideoUrl ? window.getEmbedVideoUrl(url) : '';
  if (!embedUrl) {
    window.open(url, '_blank', 'noopener,noreferrer');
    return;
  }

  iframe.src = embedUrl;
  modal.hidden = false;
  document.body.style.overflow = 'hidden';
}

function closeVideoModal() {
  const modal = document.getElementById('video-modal');
  const iframe = document.getElementById('video-modal-iframe');
  if (!modal || !iframe) return;

  modal.hidden = true;
  iframe.removeAttribute('src');
  document.body.style.overflow = '';
}

function bindVideoModalEvents() {
  if (window.__videoModalEventsBound) return;
  window.__videoModalEventsBound = true;

  document.addEventListener('click', (event) => {
    const targetToggle = event.target.closest('[data-target-level]');
    if (targetToggle) {
      const levelKey = String(targetToggle.dataset.targetLevel || '').trim();
      const sourceLevels = [...levels, ...verifications];
      const level = sourceLevels.find((item) => getTargetedLevelKey(item) === levelKey) || { name: '', id: levelKey };
      toggleTargetLevel(level);
      return;
    }

    const trigger = event.target.closest('[data-open-video-modal]');
    if (trigger) {
      event.preventDefault();
      openVideoModal(trigger.dataset.openVideoModal);
    }

    const closer = event.target.closest('[data-close-video-modal]');
    if (closer) {
      event.preventDefault();
      closeVideoModal();
    }
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      closeVideoModal();
    }
  });
}

function getLevelDetailsMarkup(level) {
  if (!level._sortedVictors) {
    level._sortedVictors = sortVictorsByDate(level.victors || []);
  }

  const victorPointAwards = buildVictorPointAwards([level], levels);
  return `
    <table class="victors-table">
      <thead>
        <tr>
          <th>#</th>
          <th>Player</th>
          <th>Date</th>
          <th>Time</th>
          <th>Attempts</th>
          <th>Points</th>
          <th>Video</th>
        </tr>
      </thead>
      <tbody>
        ${level._sortedVictors.map((victor, index) => {
          const award = getVictorPointAward(victorPointAwards, level, victor);
          const pointsDisplay = `<span class="award-total" tabindex="0" aria-label="${award.points.toFixed(1)} points; focus or hover for score breakdown" title="${escapeHTML(getScoreBreakdownTooltip(award))}">${award.points.toFixed(1)}</span>`;
          return `
            <tr>
              <td>${index + 1}</td>
              <td>${getPlayerCountryFlagMarkup(victor.name)}${escapeHTML(victor.name)}</td>
              <td>${victor.date}</td>
              <td>${victor.wrTime ? victor.wrTime : '—'}</td>
              <td>${victor.wrAttempts == null ? '—' : victor.wrAttempts.toLocaleString()}</td>
              <td class="stat-cell">${pointsDisplay}</td>
              <td>
                ${victor.victorVideoUrl
                  ? `<button class="btn-video btn-video-inline" type="button" data-open-video-modal="${escapeHTML(victor.victorVideoUrl)}" title="Watch video" aria-label="Watch video"><i class="fa-solid fa-play"></i></button>`
                  : '—'}
              </td>
            </tr>
          `;
        }).join('')}
      </tbody>
    </table>
    ${getRatioStatisticsMarkup(level.ratio)}
  `;
}

function getVirtualLevelEstimatedHeight() {
  const measuredHeights = [...virtualLevelHeightCache.values()]
    .filter((height) => Number.isFinite(height) && height > 0)
    .sort((a, b) => a - b);
  if (!measuredHeights.length) {
    return window.innerWidth <= 700
      ? VIRTUAL_LEVEL_ESTIMATE_MOBILE
      : VIRTUAL_LEVEL_ESTIMATE_DESKTOP;
  }
  return measuredHeights[Math.floor(measuredHeights.length / 2)];
}

function rebuildVirtualLevelPrefixHeights() {
  const estimate = getVirtualLevelEstimatedHeight();
  virtualLevelPrefixHeights = [0];
  virtualLevelGroups.forEach((group) => {
    const measured = virtualLevelHeightCache.get(group.key);
    const height = Number.isFinite(measured) && measured > 0 ? measured : estimate;
    virtualLevelPrefixHeights.push(virtualLevelPrefixHeights[virtualLevelPrefixHeights.length - 1] + height);
  });
}

function getVirtualLevelVisibleRange() {
  const groupCount = virtualLevelGroups.length;
  const listWindow = document.querySelector('#levels-container .virtual-list-window');
  if (!listWindow || !listWindow.clientWidth) {
    return { start: 0, end: Math.min(groupCount, 20) };
  }

  const listTop = listWindow.getBoundingClientRect().top + window.scrollY;
  const viewportTop = Math.max(0, window.scrollY - listTop);
  const viewportBottom = viewportTop + window.innerHeight;
  let firstVisible = 0;
  while (firstVisible < groupCount && virtualLevelPrefixHeights[firstVisible + 1] <= viewportTop) {
    firstVisible += 1;
  }

  let endVisible = firstVisible;
  while (endVisible < groupCount && virtualLevelPrefixHeights[endVisible] < viewportBottom) {
    endVisible += 1;
  }

  let start = Math.max(0, firstVisible - VIRTUAL_LEVEL_OVERSCAN);
  let end = Math.min(groupCount, Math.max(firstVisible + 1, endVisible) + VIRTUAL_LEVEL_OVERSCAN);
  const activeItem = document.activeElement.closest?.('.virtual-list-item');
  if (activeItem) {
    const activeRect = activeItem.getBoundingClientRect();
    const activeIndex = Number(activeItem.getAttribute('aria-posinset')) - 1;
    if (activeRect.bottom > 0 && activeRect.top < window.innerHeight
      && activeIndex >= 0 && activeIndex < groupCount) {
      start = Math.min(start, activeIndex);
      end = Math.max(end, activeIndex + 1);
    }
  }
  return { start, end };
}

function scheduleVirtualLevelRender() {
  const listPage = document.getElementById('page-list');
  if (listPage && !listPage.classList.contains('active')) return;
  if (virtualLevelRenderScheduled) return;
  virtualLevelRenderScheduled = true;
  requestAnimationFrame(() => {
    virtualLevelRenderScheduled = false;
    renderVirtualLevelWindow();
  });
}

function recordVirtualLevelHeight(element) {
  const key = element.dataset.virtualKey;
  const height = element.getBoundingClientRect().height;
  if (!key || !Number.isFinite(height) || height <= 0) return false;

  const previous = virtualLevelHeightCache.get(key);
  if (Number.isFinite(previous) && Math.abs(previous - height) < 1) return false;
  virtualLevelHeightCache.set(key, height);
  return true;
}

function observeVirtualLevelItems(itemsContainer) {
  const items = itemsContainer.querySelectorAll('.virtual-list-item');
  if (!('ResizeObserver' in window)) {
    let changed = false;
    items.forEach((item) => {
      changed = recordVirtualLevelHeight(item) || changed;
    });
    if (changed) {
      rebuildVirtualLevelPrefixHeights();
      scheduleVirtualLevelRender();
    }
    return;
  }

  if (!virtualLevelResizeObserver) {
    virtualLevelResizeObserver = new ResizeObserver((entries) => {
      let changed = false;
      entries.forEach((entry) => {
        changed = recordVirtualLevelHeight(entry.target) || changed;
      });
      if (changed) {
        rebuildVirtualLevelPrefixHeights();
        scheduleVirtualLevelRender();
      }
    });
  } else {
    virtualLevelResizeObserver.disconnect();
  }
  items.forEach((item) => virtualLevelResizeObserver.observe(item));
}

function renderVirtualLevelWindow() {
  if (!virtualLevelGroupRenderer || !virtualLevelGroups.length) return;

  const windowElement = document.querySelector('#levels-container .virtual-list-window');
  const topSpacer = windowElement?.querySelector('.virtual-list-spacer-top');
  const bottomSpacer = windowElement?.querySelector('.virtual-list-spacer-bottom');
  const itemsContainer = windowElement?.querySelector('.virtual-list-items');
  if (!windowElement || !topSpacer || !bottomSpacer || !itemsContainer) return;

  const range = getVirtualLevelVisibleRange();
  const totalHeight = virtualLevelPrefixHeights[virtualLevelGroups.length];
  topSpacer.style.height = `${Math.round(virtualLevelPrefixHeights[range.start])}px`;
  bottomSpacer.style.height = `${Math.max(0, Math.round(totalHeight - virtualLevelPrefixHeights[range.end]))}px`;

  if (virtualLevelRenderedRange
    && virtualLevelRenderedRange.start === range.start
    && virtualLevelRenderedRange.end === range.end) return;

  const targetGroups = virtualLevelGroups.slice(range.start, range.end);
  const activeElement = document.activeElement;
  const activeItem = activeElement.closest?.('.virtual-list-item');
  const activeRect = activeItem?.getBoundingClientRect();
  const activeIndex = Number(activeItem?.getAttribute('aria-posinset')) - 1;
  const activeFocusableIndex = activeItem
    ? getVirtualLevelFocusableElements(activeItem).indexOf(activeElement)
    : -1;
  const restoreFocus = activeItem
    && activeRect.bottom > 0
    && activeRect.top < window.innerHeight
    && activeIndex >= range.start
    && activeIndex < range.end
    && activeFocusableIndex >= 0;

  virtualLevelRenderedRange = range;
  renderedLevelsByCardKey.clear();
  const existingItems = new Map();
  Array.from(itemsContainer.children).forEach((item) => {
    if (item.dataset.virtualKey) existingItems.set(item.dataset.virtualKey, item);
  });
  const targetKeys = new Set(targetGroups.map((group) => group.key));
  existingItems.forEach((item, key) => {
    if (targetKeys.has(key)) return;
    unobserveLazyThumbnails(item);
    item.remove();
  });

  let nextItem = itemsContainer.firstElementChild;
  targetGroups.forEach((group, offset) => {
    let item = existingItems.get(group.key);
    if (!item) {
      const markupContainer = document.createElement('div');
      markupContainer.innerHTML = virtualLevelGroupRenderer(group, range.start + offset);
      item = markupContainer.firstElementChild;
      if (!item) throw new Error('Virtualized level renderer returned no item.');
    }
    if (item !== nextItem) itemsContainer.insertBefore(item, nextItem);
    nextItem = item.nextElementSibling;

    renderedLevelsByCardKey.set(getLevelCardKey(group.level, group.index), group.level);
    group.variants.forEach((variant) => {
      renderedLevelsByCardKey.set(getLevelCardKey(variant.level, variant.index), variant.level);
    });
  });
  while (nextItem) {
    const followingItem = nextItem.nextElementSibling;
    unobserveLazyThumbnails(nextItem);
    nextItem.remove();
    nextItem = followingItem;
  }
  initExpandHandlers();
  initLazyThumbnails(itemsContainer);
  bindVideoModalEvents();
  itemsContainer.onkeydown = handleVirtualLevelKeydown;
  observeVirtualLevelItems(itemsContainer);
  if (restoreFocus) {
    const replacementGroup = itemsContainer.querySelector(`[aria-posinset="${activeIndex + 1}"]`);
    if (replacementGroup) {
      getVirtualLevelFocusableElements(replacementGroup)[activeFocusableIndex]?.focus({ preventScroll: true });
    }
  }
}

function getVirtualLevelFocusableElements(groupElement) {
  return [...groupElement.querySelectorAll(
    'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
  )].filter((element) => element.getClientRects().length);
}

function focusVirtualLevelGroup(groupIndex, direction) {
  const listWindow = document.querySelector('#levels-container .virtual-list-window');
  if (!listWindow) return;

  const listTop = listWindow.getBoundingClientRect().top + window.scrollY;
  const groupTop = listTop + virtualLevelPrefixHeights[groupIndex];
  const targetScroll = direction === 'backward'
    ? groupTop - window.innerHeight + getVirtualLevelEstimatedHeight()
    : groupTop;
  window.scrollTo(0, Math.max(0, targetScroll));
  renderVirtualLevelWindow();

  const group = document.querySelector(`#levels-container [aria-posinset="${groupIndex + 1}"]`);
  const focusableElements = group ? getVirtualLevelFocusableElements(group) : [];
  const focusTarget = direction === 'backward'
    ? focusableElements[focusableElements.length - 1]
    : focusableElements[0];
  focusTarget?.focus();
}

function handleVirtualLevelKeydown(event) {
  if (event.key !== 'Tab' || !virtualLevelRenderedRange) return;

  const group = event.target.closest('.virtual-list-item');
  if (!group) return;
  const groupIndex = Number(group.getAttribute('aria-posinset')) - 1;
  const focusableElements = getVirtualLevelFocusableElements(group);
  if (!focusableElements.length) return;

  if (!event.shiftKey
    && groupIndex === virtualLevelRenderedRange.end - 1
    && virtualLevelRenderedRange.end < virtualLevelGroups.length
    && event.target === focusableElements[focusableElements.length - 1]) {
    event.preventDefault();
    focusVirtualLevelGroup(virtualLevelRenderedRange.end, 'forward');
  } else if (event.shiftKey
    && groupIndex === virtualLevelRenderedRange.start
    && virtualLevelRenderedRange.start > 0
    && event.target === focusableElements[0]) {
    event.preventDefault();
    focusVirtualLevelGroup(virtualLevelRenderedRange.start - 1, 'backward');
  }
}

function handleVirtualLevelResize() {
  if (virtualLevelViewportWidth !== window.innerWidth) {
    virtualLevelViewportWidth = window.innerWidth;
    virtualLevelHeightCache.clear();
    virtualLevelRenderedRange = null;
    rebuildVirtualLevelPrefixHeights();
  }
  scheduleVirtualLevelRender();
}

window.addEventListener('scroll', scheduleVirtualLevelRender, { passive: true });
window.addEventListener('resize', handleVirtualLevelResize);

function renderLevels(data) {
  const container = document.getElementById('levels-container');
  unobserveLazyThumbnails(container);
  renderedLevelsByCardKey.clear();

  if (!data.length) {
    virtualLevelGroups = [];
    virtualLevelGroupRenderer = null;
    virtualLevelPrefixHeights = [0];
    virtualLevelRenderedRange = null;
    if (virtualLevelResizeObserver) virtualLevelResizeObserver.disconnect();
    container.innerHTML = '<div class="empty-state">// NO LEVELS FOUND //</div>';
    return;
  }

  const variantRelations = VariantUtils.getVariantRelations(levels);
  const levelIndexes = new Map();
  levels.forEach((level, index) => {
    levelIndexes.set(level, index);
  });

  const displayGroups = [];
  const addedVariantRoots = new Set();
  data.forEach((level, index) => {
    const sourceIndex = levelIndexes.get(level) ?? index;
    const root = variantRelations.parentByVariant.get(level) || level;
    const rootIndex = levelIndexes.get(root) ?? sourceIndex;
    const variantGroupKey = `variant:${normalizeLevelSearchText(root.name)}`;
    if (addedVariantRoots.has(root)) return;

    const variants = (variantRelations.variantsByParent.get(root) || [])
      .map(variant => ({ level: variant, index: levelIndexes.get(variant) ?? index }));
    if (!variants.length) {
      displayGroups.push({
        key: getLevelCardKey(level, sourceIndex),
        level,
        index: sourceIndex,
        variants: [],
        id: '',
      });
      return;
    }

    addedVariantRoots.add(root);
    displayGroups.push({
      key: getLevelCardKey(root, rootIndex),
      level: root,
      index: rootIndex,
      variants,
      id: variantGroupKey,
    });
  });

  const renderLevelCard = (lvl, index, cardIndex, isVariant = false, variantToggle = null) => {
    const levelKey = getLevelCardKey(lvl, index);
    renderedLevelsByCardKey.set(levelKey, lvl);
    const cardClass = cardIndex % 2 ? 'variant-b' : 'variant-a';
    const rankValue = Number(lvl.displayRank ?? lvl.rank);
    const rankClass = rankValue === 1 ? 'rank-gold' : rankValue === 2 ? 'rank-silver' : rankValue === 3 ? 'rank-bronze' : '';
    const variantMarkup = variantToggle
      ? `<button class="btn-variant-toggle" type="button" data-variant-group="${escapeHTML(variantToggle.id)}" data-variant-panel="${variantToggle.panelId}" data-variant-count="${variantToggle.count}" aria-expanded="${variantToggle.isOpen}" aria-controls="${variantToggle.panelId}" title="${variantToggle.label}" aria-label="${variantToggle.label}">
          <i class="fa-solid fa-layer-group" aria-hidden="true"></i>
        <span class="variant-toggle-label">${variantToggle.count}</span>
        </button>`
      : '';
    const jumpMarkup = normalizeLevelSearchText(document.getElementById('list-search')?.value || '')
      ? `<button class="btn-jump-level" type="button" data-jump-scope="main" data-jump-level="${escapeHTML(levelKey)}" title="Jump to this level in the full list" aria-label="Jump to ${escapeHTML(lvl.name)} in the full list">
          <i class="fa-solid fa-arrow-up" aria-hidden="true"></i>
        </button>`
      : '';

    return `
      <div class="level-card ${cardClass}${isVariant ? ' is-variant' : ''}" id="card-${levelKey}">
        <div class="rank-col">
          ${isVariant ? '' : `<span class="rank-num ${rankClass}">#${lvl.displayRank ?? lvl.rank}</span>`}
        </div>

        <div class="info-col">
          <div class="level-name">${escapeHTML(lvl.name)}</div>

          <div class="level-meta">
            ${getLevelMetaMarkup(lvl)}
            ${isVariant ? `<span class="level-meta-item variant-tag"><i class="fa-solid fa-code-branch" aria-hidden="true"></i><span>Variant of ${escapeHTML(variantRelations.parentByVariant.get(lvl)?.name || lvl.variantParentName || '')}</span></span>` : ''}
          </div>

          ${getLevelSummaryRows(lvl)
            .map(row => `
              <div class="victor-row">
                <span class="victor-label">${row.label}:</span>
                <span class="victor-name">${escapeHTML(row.name)}</span>
                <span class="victor-stats">${row.stat}</span>
              </div>
            `)
            .join('')}
        </div>

        ${getThumbnailMarkup(lvl)}

        <div class="actions-col">
          <button class="btn-expand" data-level="${levelKey}" title="Toggle victors list" aria-label="Toggle victors list" aria-expanded="${expandedLevelKeys.has(levelKey)}">
            <i class="fa-solid ${expandedLevelKeys.has(levelKey) ? 'fa-chevron-up' : 'fa-chevron-down'}"></i>
          </button>
          ${variantMarkup}
          <button class="btn-target-toggle ${isLevelTargeted(lvl) ? 'targeted' : ''}" type="button" data-target-level="${escapeHTML(getTargetedLevelKey(lvl))}" title="${isLevelTargeted(lvl) ? 'Remove target' : 'Add to To-Do'}" aria-label="${isLevelTargeted(lvl) ? 'Remove target' : 'Add to To-Do'}">
            <i class="fa-solid ${isLevelTargeted(lvl) ? 'fa-check' : 'fa-star'}"></i>
          </button>
          ${jumpMarkup}

          ${
            lvl.showcaseVideoUrl
            ? `<button class="btn-video" type="button" data-open-video-modal="${escapeHTML(lvl.showcaseVideoUrl)}" title="Open showcase video" aria-label="Open showcase video">
                 <i class="fa-solid fa-video"></i>
               </button>`
            : '<span class="btn-video no-link" title="No video available"><i class="fa-solid fa-video-slash"></i></span>'
          }
        </div>
      </div>

      <div class="expand-panel${expandedLevelKeys.has(levelKey) ? ' open' : ''}" id="expand-${levelKey}">
        <div class="expand-inner"${expandedLevelKeys.has(levelKey) ? ' data-loaded="true"' : ''}>${expandedLevelKeys.has(levelKey) ? getLevelDetailsMarkup(lvl) : ''}</div>
      </div>`;
  };

  virtualLevelGroups = displayGroups;
  virtualLevelGroupRenderer = (group, groupIndex) => {
    const { level: lvl, index, variants, id, key } = group;
    const levelKey = getLevelCardKey(lvl, index);
    const panelId = `variants-${levelKey}`;
    const isOpen = id ? expandedVariantGroups.has(id) : false;
    const variantLabel = `${isOpen ? 'Hide' : 'Show'} ${variants.length} variant${variants.length === 1 ? '' : 's'}`;
    const groupMarkup = !variants.length
      ? renderLevelCard(lvl, index, groupIndex)
      : `
        <div class="variant-group">
          ${renderLevelCard(lvl, index, groupIndex, false, { id, panelId, isOpen, count: variants.length, label: variantLabel })}
          <div class="variant-panel${isOpen ? ' open' : ''}" id="${panelId}" aria-hidden="${!isOpen}">
            <div class="variant-panel-inner">
              ${variants.map((variant, variantIndex) => renderLevelCard(
                variant.level,
                variant.index,
                variantIndex,
                true,
              )).join('')}
            </div>
          </div>
        </div>`;

    return `<div class="virtual-list-item" data-virtual-key="${escapeHTML(key)}" role="listitem" aria-posinset="${groupIndex + 1}" aria-setsize="${displayGroups.length}">${groupMarkup}</div>`;
  };

  virtualLevelRenderedRange = null;
  rebuildVirtualLevelPrefixHeights();
  container.innerHTML = `
    <div class="section-header">
      <div class="line"></div>
    </div>
    <div class="virtual-list-window">
      <div class="virtual-list-spacer-top" aria-hidden="true"></div>
      <div class="virtual-list-items" role="list" aria-label="Ranked levels" aria-setsize="${displayGroups.length}"></div>
      <div class="virtual-list-spacer-bottom" aria-hidden="true"></div>
    </div>`;
  renderVirtualLevelWindow();
}
function initExpandHandlers() {
  const container = document.getElementById('levels-container');

  container.onclick = e => {
    const variantButton = e.target.closest('.btn-variant-toggle');
    if (variantButton) {
      const groupId = String(variantButton.dataset.variantGroup || '');
      const panel = document.getElementById(variantButton.dataset.variantPanel);
      if (!groupId || !panel) return;

      const isOpen = panel.classList.toggle('open');
      if (isOpen) expandedVariantGroups.add(groupId);
      else expandedVariantGroups.delete(groupId);
      panel.setAttribute('aria-hidden', String(!isOpen));
      variantButton.setAttribute('aria-expanded', String(isOpen));
      const label = `${isOpen ? 'Hide' : 'Show'} ${variantButton.dataset.variantCount} variant${variantButton.dataset.variantCount === '1' ? '' : 's'}`;
      variantButton.title = label;
      variantButton.setAttribute('aria-label', label);
      return;
    }

    const button = e.target.closest('.btn-expand');

    if (!button) return;

    toggleExpand(button.dataset.level);
  };
}
function unobserveLazyThumbnails(root) {
  if (!thumbnailObserver || !root) return;
  root.querySelectorAll('.lazy-thumb').forEach((img) => thumbnailObserver.unobserve(img));
}

function initLazyThumbnails(root = document) {
  const images = root.querySelectorAll('.lazy-thumb[data-src]');
  if (!('IntersectionObserver' in window)) {
    images.forEach(loadThumbnail);
    return;
  }

  if (!thumbnailObserver) {
    thumbnailObserver = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting || !entry.target.isConnected) continue;

        const img = entry.target;
        loadThumbnail(img);
        thumbnailObserver.unobserve(img);
      }
    }, {
      rootMargin: '300px',
    });
  }

  images.forEach((img) => thumbnailObserver.observe(img));
}

function loadThumbnail(img) {
  const source = img.dataset.src;
  if (!source) return;
  img.removeAttribute('data-src');
  img.src = source;
}

function tryThumbnailFallback(img) {
  let urls = [];

  try {
    urls = JSON.parse(
      decodeURIComponent(img.dataset.fallbacks || '[]')
    );
  } catch {}

  const id = img.dataset.id;

  if (id) {
    urls.push(
      `https://raw.githubusercontent.com/AncepsGD/practice-mode-list/main/thumbnails/${id}.webp`,
      `https://raw.githubusercontent.com/AncepsGD/practice-mode-list/main/thumbnails/${id}.png`
    );
  }

  let index = Number(img.dataset.fallbackIndex || 0);

  const next = () => {
    if (index >= urls.length) {
      img.closest('.thumb-col')?.remove();
      return;
    }

    img.dataset.fallbackIndex = String(index + 1);
    img.src = urls[index++];
    img.onerror = next;
  };

  next();
}

function tryPackThumbnailFallback(img) {
  let candidates = [];

  try {
    candidates = JSON.parse(decodeURIComponent(img.dataset.fallbacks || '[]'));
  } catch (error) {
    console.warn('Failed to read pack thumbnail fallbacks', error);
  }

  const nextIndex = Number(img.dataset.fallbackIndex || 0);
  if (nextIndex >= candidates.length) {
    img.remove();
    return;
  }

  img.dataset.fallbackIndex = String(nextIndex + 1);
  img.src = candidates[nextIndex];
}

function toggleExpand(id) {
  const panel = document.getElementById(`expand-${id}`);
  const button = document.querySelector(`#card-${id} .btn-expand`);
  if (!panel || !button) return;

  const isOpen = panel.classList.toggle('open');
  if (isOpen) expandedLevelKeys.add(id);
  else expandedLevelKeys.delete(id);
  const details = panel.querySelector('.expand-inner');
  if (isOpen && details && !details.dataset.loaded) {
    const level = renderedLevelsByCardKey.get(id);
    if (level) {
      details.innerHTML = getLevelDetailsMarkup(level);
      details.dataset.loaded = 'true';
    }
  }
  const icon = button.querySelector('i');
  if (icon) {
    icon.classList.toggle('fa-chevron-up', isOpen);
    icon.classList.toggle('fa-chevron-down', !isOpen);
  }
  button.setAttribute('aria-expanded', String(isOpen));
}

function getScoreBreakdownTooltip(entry) {
  const lines = [
    `Base level points: ${Number(entry.basePoints ?? entry.points ?? 0).toFixed(1)}`,
    `Performance — time: +${Number(entry.timePerformancePoints || 0).toFixed(1)}, attempts: +${Number(entry.attemptsPerformancePoints || 0).toFixed(1)}`,
    `First victor bonus: +${Number(entry.firstVictorBonus || 0).toFixed(1)}`,
    `Record bonuses — fastest time: +${Number(entry.timeRecordBonus || 0).toFixed(1)}, fewest attempts: +${Number(entry.attemptsRecordBonus || 0).toFixed(1)}`,
  ];
  if (Number(entry.aggregatedClearCount) > 1) {
    lines.unshift(`Combined score across ${entry.aggregatedClearCount} clears`);
    lines.push('Individual variant, repeat, and timeline multipliers are included.');
  }
  if (Number(entry.variantMultiplier) < 1) {
    lines.push(`Variant diminishing multiplier: ${(Number(entry.variantMultiplier) * 100).toFixed(2)}%`);
  }
  if (Number(entry.repeatMultiplier) < 1) {
    lines.push(`Repeat completion multiplier: ${(Number(entry.repeatMultiplier) * 100).toFixed(2)}%`);
  }
  if (Number(entry.timelineMultiplier) > 1) {
    lines.push(`Timeline top-1-at-clear multiplier: ${Number(entry.timelineMultiplier).toFixed(1)}x`);
  }
  lines.push(`Total: ${Number(entry.earnedPoints ?? entry.points ?? 0).toFixed(1)}`);
  return lines.join('\n');
}

function aggregateLeaderboardCompletions(completions) {
  const grouped = new Map();
  const summedFields = [
    'earnedPoints',
    'basePoints',
    'performancePoints',
    'timePerformancePoints',
    'attemptsPerformancePoints',
    'recordBonusPoints',
    'firstVictorBonus',
    'timeRecordBonus',
    'attemptsRecordBonus',
  ];

  completions.forEach((entry, index) => {
    const name = String(entry.name || '').trim().replace(/\s+/g, ' ');
    const key = name.toLowerCase() || `completion-${index}`;
    let group = grouped.get(key);
    if (!group) {
      group = { entry, count: 0, totals: Object.fromEntries(summedFields.map(field => [field, 0])) };
      grouped.set(key, group);
    }

    group.count += 1;
    summedFields.forEach((field) => {
      const fallback = field === 'earnedPoints' || field === 'basePoints'
        ? entry.points
        : 0;
      const value = Number(entry[field] ?? fallback);
      if (Number.isFinite(value)) group.totals[field] += value;
    });
  });

  return [...grouped.values()].map(({ entry, count, totals }) => {
    if (count === 1) return entry;
    return {
      ...entry,
      ...totals,
      points: totals.earnedPoints,
      variantMultiplier: undefined,
      repeatMultiplier: undefined,
      timelineMultiplier: undefined,
      aggregatedClearCount: count,
    };
  });
}

function renderLeaderboard(data) {
  const body = document.getElementById('lb-body');
  body.dataset.dirty = 'false';
  const sortedData = getSortedLeaderboardData(data);
  if (!sortedData.length) {
    body.innerHTML = '<tr><td colspan="5" class="empty-state">// NO PLAYERS FOUND //</td></tr>';
    return;
  }

  body.innerHTML = sortedData
    .map((p) => {
      const completionDetails = Array.isArray(p.completionDetails) && p.completionDetails.length
        ? p.completionDetails
        : (p.levels || []).map((name) => ({ name, points: 0, tier: 'unknown' }));
      const groupedCompletionDetails = aggregateLeaderboardCompletions(completionDetails);
      const completionCount = p.completionCount ?? completionDetails.length;
      const hardestCompletion = p.hardestCompletion || completionDetails.reduce((best, current) => {
        if (!best) return current;
        return (Number(current.points) || 0) > (Number(best.points) || 0) ? current : best;
      }, null);
      const hardestLabel = hardestCompletion
        ? `<span class="hardest-completion-primary">${escapeHTML(truncateDisplayText(hardestCompletion.name, 32))}</span><span class="hardest-completion-secondary">${escapeHTML(hardestCompletion.tier || 'Unknown')} · ${Number(hardestCompletion.points || 0).toFixed(0)} pts</span>`
        : '<span class="hardest-completion-primary">None</span>';
      const orderedLevelsMarkup = groupedCompletionDetails.map((entry) => `
        <li class="completion-order-item">
          <span class="completion-order-name">${escapeHTML(truncateDisplayText(entry.name, 32))}</span>
          <span class="completion-order-meta">
            ${escapeHTML(entry.tier || 'unknown')} ·
            <span${Number.isFinite(entry.earnedPoints) ? ` tabindex="0" aria-label="${Number(entry.earnedPoints).toFixed(1)} points; focus or hover for score breakdown" title="${escapeHTML(getScoreBreakdownTooltip(entry))}"` : ''}>
              ${Number(entry.earnedPoints ?? entry.points ?? 0).toFixed(1)} pts
            </span>
          </span>
        </li>
      `).join('');
      return `
        <tr class="leaderboard-row">
          <td class="rank-td">${p.rank ?? sortedData.indexOf(p) + 1}</td>
          <td><span class="player-name">${getPlayerCountryFlagMarkup(p.name)}${escapeHTML(p.name)}</span></td>
          <td><span class="score-val">${p.points.toFixed(1)}</span></td>
          <td class="completion-cell">
            <div class="completion-summary-row">
              <div class="completion-stat-pill">
                <span class="completion-stat-label">Completed</span>
                <strong>${completionCount}</strong>
              </div>
              <div class="completion-stat-pill">
                <span class="completion-stat-label">Total Time</span>
                <strong>${formatDuration(p.totalTimeSeconds ?? 0)}</strong>
              </div>
              <div class="completion-stat-pill">
                <span class="completion-stat-label">Total Attempts</span>
                <strong>${Number(p.totalAttempts ?? 0).toLocaleString()}</strong>
              </div>
              <div class="completion-stat-pill completion-stat-pill--hardest">
                <span class="completion-stat-label">Hardest</span>
                <strong>${hardestLabel}</strong>
              </div>
            </div>
          </td>
          <td class="completion-toggle-cell">
            <button class="completion-toggle" type="button" aria-expanded="false" aria-label="Show completions for ${escapeHTML(p.name)}" title="Show completions">
              <i class="fa-solid fa-chevron-down" aria-hidden="true"></i>
            </button>
          </td>
        </tr>
        <tr class="completion-details-row">
          <td colspan="5">
            <div class="completion-expand-inner">
              <ol class="completion-order-list">${orderedLevelsMarkup}</ol>
            </div>
          </td>
        </tr>
      `;
    })
    .join('');

  body.onclick = (event) => {
    const button = event.target.closest('.completion-toggle');
    if (!button) return;

    const playerRow = button.closest('.leaderboard-row');
    const detailsRow = playerRow?.nextElementSibling;
    if (!detailsRow?.classList.contains('completion-details-row')) return;

    const isOpen = detailsRow.classList.toggle('open');
    button.setAttribute('aria-expanded', String(isOpen));
    button.setAttribute('aria-label', `${isOpen ? 'Hide' : 'Show'} completions for ${button.closest('tr').querySelector('.player-name').textContent.trim()}`);
    button.title = `${isOpen ? 'Hide' : 'Show'} completions`;
    const icon = button.querySelector('i');
    icon?.classList.toggle('fa-chevron-up', isOpen);
    icon?.classList.toggle('fa-chevron-down', !isOpen);
  };
}

function getBrighterPackColor(colors) {
  const luminance = (color) => {
    const channels = color.match(/[a-f\d]{2}/gi);
    if (!channels || channels.length < 3) throw new Error(`Invalid pack color: ${color}`);
    const [red, green, blue] = channels.slice(0, 3).map((channel) => {
      const value = parseInt(channel, 16) / 255;
      return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
  };

  return luminance(colors[0]) >= luminance(colors[1]) ? colors[0] : colors[1];
}

function getPackLevelLookupKey(name) {
  return String(name || "")
    .trim()
    .replace(/\s+/g, " ")
    .replace(/\s*\(layout\)$/i, "")
    .toLowerCase();
}

function renderPacks(packs, players) {
  const playerSelect = document.getElementById('packs-player-select');
  const summary = document.getElementById('packs-summary');
  const container = document.getElementById('packs-container');
  if (!playerSelect || !summary || !container) return;
  container.dataset.dirty = 'false';

  const selectedPlayerName = playerSelect.value || loadSelectedPackPlayer();
  const sortedPlayers = [...players].sort((a, b) => b.points - a.points);
  playerSelect.innerHTML = `<option value="">Select a player</option>${sortedPlayers
    .map((player) => `<option value="${escapeHTML(player.name)}">${escapeHTML(player.name)}</option>`)
    .join('')}`;
  playerSelect.value = sortedPlayers.some((player) => player.name === selectedPlayerName)
    ? selectedPlayerName
    : '';
  saveSelectedPackPlayer(playerSelect.value);

  const packLevelRanks = new Map();
  levels.forEach((level) => {
    const key = getPackLevelLookupKey(level.name);
    if (key) packLevelRanks.set(key, Number(level.sortRank ?? level.rank) || Number.POSITIVE_INFINITY);
  });
  (Array.isArray(window.verifications) ? window.verifications : []).forEach((level) => {
    const key = getPackLevelLookupKey(level.name);
    if (!key || packLevelRanks.has(key)) return;
    packLevelRanks.set(key, getUnverifiedEstimatedRank(level) ?? Number.POSITIVE_INFINITY);
  });

  const selectedPlayer = players.find((player) => player.name === playerSelect.value);
  if (!selectedPlayer) {
    summary.innerHTML = '<span>Select a player to see their pack progress and bonus points.</span>';
  } else {
    const completedPacks = selectedPlayer.packProgress.filter((progress) => progress.isComplete).length;
    summary.innerHTML = `
      <span class="packs-summary-stat"><strong>${selectedPlayer.packBonusPoints.toFixed(1)}</strong> pack bonus points</span>
      <span class="packs-summary-stat"><strong>${completedPacks}</strong> / ${packs.length} packs completed</span>
    `;
  }

  const getPackThumbnails = (pack) => {
    const packLevels = pack.levels
      .map((levelName) => {
        const normalizedName = String(levelName || '').trim().toLowerCase();
        return levels.find((item) => String(item.name || '').trim().toLowerCase() === normalizedName);
      })
      .filter(Boolean);
    const explicitThumbnails = packLevels
      .map((level) => String(level.thumbnail || '').trim())
      .filter(Boolean);
    const levelThumbnails = packLevels
      .filter((level) => level.id)
      .map((level) => `https://levelthumbs.prevter.me/thumbnail/${encodeURIComponent(level.id)}/small`);
    const showcaseThumbnails = packLevels.flatMap((level) => {
      const videoThumbnails = window.getThumbnailUrlSequence
        ? window.getThumbnailUrlSequence('', level.showcaseVideoUrl || '', '', '', [])
        : [];
      return videoThumbnails.filter(Boolean);
    });
    const playerThumbnails = packLevels.flatMap((level) => (
      window.getThumbnailUrlSequence
        ? window.getThumbnailUrlSequence(
          '',
          '',
          '',
          '',
          (level.victors || []).map((victor) => victor.victorVideoUrl).filter(Boolean)
        )
        : []
    ));

    return [...new Set([...explicitThumbnails, ...levelThumbnails, ...showcaseThumbnails, ...playerThumbnails])];
  };

  container.innerHTML = packs.map((pack, packIndex) => {
    const orderedLevelNames = [...pack.levels].sort((a, b) => (
      (packLevelRanks.get(getPackLevelLookupKey(a)) ?? Number.POSITIVE_INFINITY)
      - (packLevelRanks.get(getPackLevelLookupKey(b)) ?? Number.POSITIVE_INFINITY)
    ));
    const progress = selectedPlayer
      ? selectedPlayer.packProgress[packIndex]
      : { completedLevels: [], completedCount: 0, isComplete: false, bonusPoints: 0, maxBonusPoints: PackUtils.getMaxBonusPoints(pack, levels), levelBonuses: [] };
    const percentage = (progress.completedCount / pack.levels.length) * 100;
    const colors = PACK_COLORS[pack.name];
    if (!colors) throw new Error(`Missing color pair for pack: ${pack.name}`);
    const brighterColor = getBrighterPackColor(colors);
    const thumbnails = getPackThumbnails(pack);
    const thumbnail = thumbnails.shift();

    return `
      <article class="pack-card${progress.isComplete ? ' is-complete' : ''}" style="--pack-primary: ${colors[0]}; --pack-secondary: ${colors[1]}; --pack-brightest: ${brighterColor}">
        ${thumbnail ? `<img class="pack-card-thumbnail" src="${escapeHTML(thumbnail)}" data-fallbacks="${encodeURIComponent(JSON.stringify(thumbnails))}" alt="" aria-hidden="true" loading="lazy" onerror="tryPackThumbnailFallback(this)">` : ''}
        <div class="pack-card-header">
          <div>
            <h3>${escapeHTML(pack.name)}</h3>
            <p>${progress.completedCount} / ${pack.levels.length} levels</p>
          </div>
          <span class="pack-points" title="Each level awards 1–10 points based on its list points; completing the pack adds 50 points.">${progress.bonusPoints.toFixed(1)} / ${progress.maxBonusPoints.toFixed(1)} pts</span>
        </div>
        <div class="pack-progress-track" role="progressbar" aria-label="${escapeHTML(pack.name)} progress" aria-valuemin="0" aria-valuemax="${pack.levels.length}" aria-valuenow="${progress.completedCount}">
          <span style="width: ${percentage}%"></span>
        </div>
        <ul class="pack-level-list">
          ${orderedLevelNames.map((levelName) => {
            const isCompleted = progress.completedLevels.includes(levelName);
            const levelBonus = progress.levelBonuses.find((level) => level.name === levelName);
            return `
              <li class="${isCompleted ? 'is-completed' : ''}">
                <span class="pack-level-status" aria-label="${isCompleted ? 'Completed' : 'Not completed'}">${isCompleted ? '<i class="fa-solid fa-check"></i>' : '<i class="fa-regular fa-circle"></i>'}</span>
                <span>${escapeHTML(levelName)}</span>
                ${isCompleted && levelBonus ? `<span class="pack-level-points">+${levelBonus.points.toFixed(1)} pts</span>` : ''}
              </li>
            `;
          }).join('')}
        </ul>
        ${progress.isComplete ? `<p class="pack-complete-label"><i class="fa-solid fa-star"></i> Pack completed: +${progress.completionBonus.toFixed(1)} bonus points</p>` : ''}
      </article>
    `;
  }).join('');
}

const PACKS_PLAYER_STORAGE_KEY = 'pml_packs_selected_player';

function loadSelectedPackPlayer() {
  try {
    return localStorage.getItem(PACKS_PLAYER_STORAGE_KEY) || '';
  } catch (error) {
    return '';
  }
}

function saveSelectedPackPlayer(playerName) {
  try {
    if (playerName) {
      localStorage.setItem(PACKS_PLAYER_STORAGE_KEY, playerName);
    } else {
      localStorage.removeItem(PACKS_PLAYER_STORAGE_KEY);
    }
  } catch (error) {
    // localStorage may be unavailable.
  }
}

function handlePackPlayerChange() {
  saveSelectedPackPlayer(document.getElementById('packs-player-select')?.value || '');
  renderPacks(PACKS, leaderboard);
}

let playerCountriesPromise = null;

function loadPlayerCountries() {
  if (playerCountriesPromise) return playerCountriesPromise;

  window.playerCountries = {};
  playerCountriesPromise = fetchWithTimeout("data/players_countries.json", 5000)
    .then((response) => {
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return response.json();
    })
    .then((mapping) => {
      if (mapping && typeof mapping === "object") window.playerCountries = mapping;
      if (dataReady && document.getElementById("page-leaderboard").classList.contains("active")) {
        renderLeaderboard(leaderboard);
      }
      if (dataReady && document.getElementById("page-list").classList.contains("active")) {
        const searchInput = document.getElementById("list-search");
        if (typeof filterList === "function") {
          filterList(searchInput ? searchInput.value : "");
        } else if (typeof renderLevels === "function") {
          renderLevels(getSortedLevelData(levels));
        }
      }
      if (dataReady && document.getElementById("page-verifications").classList.contains("active")
        && typeof filterVerifications === "function") {
        filterVerifications();
      }
      return window.playerCountries;
    })
    .catch((error) => {
      console.warn("Unable to load players_countries.json", error);
      playerCountriesPromise = null;
      return window.playerCountries;
    });

  return playerCountriesPromise;
}

let editorScriptPromise = null;

function requestEditorOpen() {
  if (!editorScriptPromise) {
    editorScriptPromise = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = "scripts/editor.js?v=20261124-5";
      script.onload = resolve;
      script.onerror = () => {
        editorScriptPromise = null;
        reject(new Error("Failed to load scripts/editor.js"));
      };
      document.head.appendChild(script);
    });
  }

  return editorScriptPromise
    .then(() => {
      const editorOpen = window.openEditMenu;
      if (typeof editorOpen !== "function" || editorOpen === requestEditorOpen) {
        throw new Error("Editor script loaded without defining openEditMenu");
      }
      return editorOpen();
    })
    .catch((error) => {
      console.error("Failed to load the editor", error);
      alert("The editor could not be loaded. Please reload the page and try again.");
    });
}

window.openEditMenu = requestEditorOpen;

function showPage(name, btn) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
  document.getElementById(`page-${name}`).classList.add('active');
  btn.classList.add('active');

  if (name === 'optimizer') {
    const optimizerFrame = document.querySelector('.optimizer-frame[data-src]');
    if (optimizerFrame) {
      optimizerFrame.src = optimizerFrame.dataset.src;
      optimizerFrame.removeAttribute('data-src');
    }
  }

  if (name === 'leaderboard' && document.getElementById('lb-body').dataset.dirty !== 'false') {
    renderLeaderboard(leaderboard);
  }
  if (name === 'leaderboard') {
    loadPlayerCountries();
    Promise.all([loadVerificationsData(), loadTimelineData()])
      .then(() => refreshPackCatalog());
  }
  if (name === 'verifications' || name === 'todo' || name === 'packs') {
    loadVerificationsData();
  }
  if (name === 'packs' && document.getElementById('packs-container').dataset.dirty !== 'false') {
    renderPacks(PACKS, leaderboard);
  }
  if (name === 'timeline') initializeTimeline();
  scheduleVirtualLevelRender();
}

function handleListSearch() {
  const query = document.getElementById('list-search').value.toLowerCase();
  if (query === 'edit') {
    openEditMenu();
  } else {
    filterList(query);
  }
}

function filterList(query) {
  const normalizedQuery = normalizeLevelSearchText(query);
  const rankedLevels = normalizedQuery
    ? getRankedLevelMatches(normalizedQuery, levels)
    : [...levels];

  renderLevels(getSortedLevelData(rankedLevels));
}

function jumpToMainListLevel(level) {
  const searchInput = document.getElementById('list-search');
  if (searchInput) searchInput.value = '';

  const levelIndex = levels.indexOf(level);
  if (levelIndex < 0) return;

  const variantRelations = VariantUtils.getVariantRelations(levels);
  const root = variantRelations.parentByVariant.get(level) || level;
  if (root !== level) {
    expandedVariantGroups.add(`variant:${normalizeLevelSearchText(root.name)}`);
  }

  filterList('');
  const groupIndex = virtualLevelGroups.findIndex((group) => group.level === root);
  if (groupIndex < 0) return;

  const listWindow = document.querySelector('#levels-container .virtual-list-window');
  if (!listWindow) return;
  const listTop = listWindow.getBoundingClientRect().top + window.scrollY;
  window.scrollTo({ top: listTop + virtualLevelPrefixHeights[groupIndex] });
  renderVirtualLevelWindow();

  const card = document.getElementById(`card-${getLevelCardKey(level, levelIndex)}`);
  card?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function jumpToVerificationLevel(level) {
  const searchInput = document.getElementById('verification-search');
  if (searchInput) searchInput.value = '';

  filterVerifications();
  const cardEntry = [...renderedVerificationLevelsByCardKey.entries()]
    .find(([, renderedLevel]) => renderedLevel === level);
  if (!cardEntry) return;

  document.getElementById(`card-${cardEntry[0]}`)
    ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function filterLeaderboard() {
  const query = document.getElementById('lb-search').value.trim().toLowerCase();
  renderLeaderboard(
    leaderboard.filter((p) => {
      const haystack = [
        p.name,
        String(p.points),
        String(p.packBonusPoints),
        p.levels.join(' '),
      ]
        .join(' ')
        .toLowerCase();

      return haystack.includes(query);
    })
  );
}

function getUnverifiedLevels() {
  const mainLevelNames = new Set(levels.map((lvl) => String(lvl.name || '').trim().toLowerCase()));
  const sourceLevels = Array.isArray(window.verifications) ? window.verifications : [];
  const removedLevels = [];

  const filteredLevels = sourceLevels.filter((lvl) => {
    const name = String(lvl.name || '').trim().toLowerCase();
    if (name && mainLevelNames.has(name)) {
      removedLevels.push(lvl.name || lvl.id);
      return false;
    }
    return true;
  });

  if (removedLevels.length) {
    console.log('Removed verification levels already in main list:', removedLevels);
  }

  return filteredLevels;
}

function shuffleArray(array) {
  const shuffled = [...array];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

const unverifiedEstimatedRankCache = new Map();

function getUnverifiedRankCacheEntry(level) {
  if (!level || typeof level !== 'object') return null;
  const id = String(level.id || level.levelId || '').trim();
  const name = String(level.name || level.levelName || '').trim().toLowerCase().replace(/\s+/g, ' ');
  const key = id ? `id:${id}` : name ? `name:${name}` : null;
  const signature = JSON.stringify([
    level.tier,
    level.tierName,
    level.is2Player,
    level.twoPlayer,
    level.tps,
    level.TPS,
    level.length,
    level.levelLength,
    level.precision,
    level.Precision,
    level.iaPerSecond,
    level.inputActivityPerSecond,
    level.ratio,
    level.recordedClearCount,
    level.clearCount,
    level.completionCount,
    level.victorCount,
    level.sourceConfidence,
    level.rank,
    level.modelRank,
    level._difficultyRank,
    level.rankRange,
    level.estimatedRankRange,
    level.estimatedRankMin,
    level.estimatedRankMax,
    (Array.isArray(level.victors) ? level.victors : []).map(victor => [
      victor?.name,
      victor?.seconds,
      victor?.time,
      victor?.attempts,
    ]),
  ]);
  return { key, signature };
}

function getCachedUnverifiedEstimatedRank(level) {
  const entry = getUnverifiedRankCacheEntry(level);
  if (!entry?.key) return null;
  const cached = unverifiedEstimatedRankCache.get(entry.key);
  return cached?.signature === entry.signature
      && cached.calibrationLevels === levels
    ? cached.rank
    : null;
}

function getUnverifiedEstimatedRank(level) {
  const entry = getUnverifiedRankCacheEntry(level);
  if (!entry) return null;
  const { key, signature } = entry;
  const cached = key ? unverifiedEstimatedRankCache.get(key) : null;
  if (cached?.signature === signature && cached.calibrationLevels === levels) {
    return cached.rank;
  }

  const prediction = typeof LadderUtils !== 'undefined'
    && typeof LadderUtils.getEstimatedRankRange === 'function'
    ? LadderUtils.getEstimatedRankRange({ ...level, isUnverified: true }, levels, [])
    : null;
  const rank = Number.isFinite(prediction?.estimatedRank) ? prediction.estimatedRank : null;
  if (key) unverifiedEstimatedRankCache.set(key, { signature, rank, calibrationLevels: levels });
  return rank;
}

function getUnverifiedDifficultyRank(level) {
  const entry = getUnverifiedRankCacheEntry(level);
  if (!entry) return null;
  const { key, signature } = entry;
  const rank = getUnverifiedEstimatedRank(level);
  const cached = key ? unverifiedEstimatedRankCache.get(key) : null;
  if (cached?.signature === signature
      && cached.calibrationLevels === levels
      && Object.prototype.hasOwnProperty.call(cached, 'difficultyRank')) {
    return cached.difficultyRank;
  }

  const prediction = typeof LadderUtils !== 'undefined'
    && typeof LadderUtils.getEstimatedRankRange === 'function'
    ? LadderUtils.getEstimatedRankRange({
      ...level,
      tier: undefined,
      tierName: undefined,
      isUnverified: true,
    }, levels, [])
    : null;
  const difficultyRank = Number.isFinite(prediction?.estimatedRankValue)
    ? prediction.estimatedRankValue
    : (Number.isFinite(prediction?.estimatedRank) ? prediction.estimatedRank : null);
  if (key && cached?.signature === signature && cached.calibrationLevels === levels) {
    cached.difficultyRank = difficultyRank;
  } else if (key) {
    unverifiedEstimatedRankCache.set(key, {
      signature,
      rank,
      difficultyRank,
      calibrationLevels: levels,
    });
  }
  return difficultyRank;
}

function sortUnverifiedByEstimatedDifficulty(unverifiedLevels) {
  return [...unverifiedLevels].sort((a, b) => {
    const rankA = getUnverifiedEstimatedRank(a) ?? Infinity;
    const rankB = getUnverifiedEstimatedRank(b) ?? Infinity;
    if (rankA !== rankB) return rankA - rankB;
    const difficultyRankA = getUnverifiedDifficultyRank(a) ?? Infinity;
    const difficultyRankB = getUnverifiedDifficultyRank(b) ?? Infinity;
    if (difficultyRankA !== difficultyRankB) return difficultyRankA - difficultyRankB;
    return String(a.name || '').localeCompare(String(b.name || ''));
  });
}

function initializeVerifications(options = {}) {
  if (!options.skipPackRefresh) refreshPackCatalog();
  initializeVerificationSortState();
  const unverifiedLevels = getUnverifiedLevels();
  const sortedLevels = sortUnverifiedByEstimatedDifficulty(unverifiedLevels);
  sessionStorage.setItem('verifications-list', JSON.stringify(sortedLevels));
  filterVerifications();
  renderTargetedLevels();
}

function shuffleVerifications() {
  const unverifiedLevels = getUnverifiedLevels();
  const shuffledLevels = shuffleArray(unverifiedLevels);
  sessionStorage.setItem('verifications-list', JSON.stringify(shuffledLevels));
  verificationSortState.key = 'randomOrder';
  verificationSortState.direction = 'asc';
  updateVerificationSortControls();
  filterVerifications();
  renderTargetedLevels();
}

function getVerificationsList() {
  return JSON.parse(sessionStorage.getItem('verifications-list')) || getUnverifiedLevels();
}

function loadVerificationSortState() {
  try {
    const stored = localStorage.getItem(VERIFICATION_SORT_STORAGE_KEY);
    if (!stored) return { ...VERIFICATION_SORT_DEFAULT_STATE };
    const parsed = JSON.parse(stored);
    if ((parsed?.key === 'estimatedRank' || parsed?.key === 'randomOrder')
      && ['asc', 'desc'].includes(parsed.direction)) return parsed;
    const migrated = migrateListSortState(parsed);
    if (migrated) return migrated;
  } catch (error) {
    // Ignore invalid stored state.
  }
  return { ...VERIFICATION_SORT_DEFAULT_STATE };
}

function saveVerificationSortState() {
  try {
    localStorage.setItem(VERIFICATION_SORT_STORAGE_KEY, JSON.stringify(verificationSortState));
  } catch (error) {
    // localStorage may be unavailable.
  }
}

function updateVerificationSortControls() {
  const sortSelect = document.getElementById('verification-sort-key');
  const directionButton = document.getElementById('verification-sort-direction-btn');
  if (sortSelect) sortSelect.value = verificationSortState.key;
  if (directionButton) {
    directionButton.textContent = verificationSortState.direction === 'asc' ? '▲' : '▼';
    directionButton.title = verificationSortState.direction === 'asc' ? 'Ascending order' : 'Descending order';
  }
}

function initializeVerificationSortState() {
  verificationSortState = loadVerificationSortState();
  updateVerificationSortControls();
}

function handleVerificationSortChange() {
  const sortSelect = document.getElementById('verification-sort-key');
  if (!sortSelect) return;
  verificationSortState.key = sortSelect.value;
  if (verificationSortState.key === 'estimatedRank' || verificationSortState.key === 'randomOrder') {
    verificationSortState.direction = 'asc';
  } else {
    verificationSortState.direction = 'desc';
  }
  saveVerificationSortState();
  updateVerificationSortControls();
  filterVerifications();
}

function toggleVerificationSortDirection() {
  verificationSortState.direction = verificationSortState.direction === 'asc' ? 'desc' : 'asc';
  saveVerificationSortState();
  updateVerificationSortControls();
  filterVerifications();
}

function getSortedVerifications(data) {
  if (verificationSortState.key === 'randomOrder') return [...data];
  const direction = verificationSortState.direction === 'asc' ? 1 : -1;
  return [...data].sort((a, b) => {
    const getValue = (level) => verificationSortState.key === 'estimatedRank'
      ? (getUnverifiedEstimatedRank(level) ?? (direction === 1 ? Number.POSITIVE_INFINITY : Number.NEGATIVE_INFINITY))
      : getListSortValue(level, verificationSortState.key, direction);
    const aValue = getValue(a);
    const bValue = getValue(b);
    if (typeof aValue === 'string' && typeof bValue === 'string') {
      return aValue.localeCompare(bValue) * direction;
    }
    if (aValue < bValue) return -1 * direction;
    if (aValue > bValue) return 1 * direction;
    return 0;
  });
}

function handleVerificationSearch() {
  filterVerifications();
}

function filterVerifications() {
  const query = normalizeLevelSearchText(document.getElementById('verification-search')?.value || '');
  const sourceLevels = getVerificationsList();
  const matches = query
    ? getRankedLevelMatches(query, sourceLevels)
    : sourceLevels;
  renderVerifications(getSortedVerifications(matches), query && !matches.length
    ? '// NO MATCHING LEVELS FOUND //'
    : '// ALL LEVELS VERIFIED! //');
}

function renderVerifications(data, emptyMessage = '// ALL LEVELS VERIFIED! //') {
  const container = document.getElementById('verifications-container');
  unobserveLazyThumbnails(container);
  renderedVerificationLevelsByCardKey.clear();
  if (!data.length) {
    container.innerHTML = `<div class="empty-state">${emptyMessage}</div>`;
    return;
  }

  const cards = data
    .map((lvl, index) => {
      const cardClass = index % 2 === 0 ? 'level-card variant-a' : 'level-card variant-b';
      const actionsClass = index % 2 === 0 ? 'actions-col variant-a' : 'actions-col variant-b';
      const levelKey = getLevelCardKey(lvl, index);
      renderedVerificationLevelsByCardKey.set(levelKey, lvl);
      const thumbnailMarkup = getThumbnailMarkup(lvl);
      const metaMarkup = getLevelMetaMarkup(lvl);
      const estimatedRank = getUnverifiedEstimatedRank(lvl);
      const rankLabel = estimatedRank === null ? '•' : `#${Math.round(estimatedRank)}~`;
      const jumpMarkup = normalizeLevelSearchText(document.getElementById('verification-search')?.value || '')
        ? `<button class="btn-jump-level" type="button" data-jump-scope="verification" data-jump-level="${escapeHTML(levelKey)}" title="Jump to this level in the full list" aria-label="Jump to ${escapeHTML(lvl.name)} in the full list">
            <i class="fa-solid fa-arrow-up" aria-hidden="true"></i>
          </button>`
        : '';
      const summaryRowsMarkup = getLevelSummaryRows(lvl)
        .map((row) => `<div class="victor-row"><span class="victor-label">${escapeHTML(row.label || '')}:</span><span class="victor-name">${escapeHTML(row.name || '')}</span><span class="victor-stats">${escapeHTML(row.stat || '')}</span></div>`)
        .join('');

      return `
      <div class="${cardClass}" id="card-${levelKey}">
        <div class="rank-col">
          <span class="rank-num" aria-hidden="true">${rankLabel}</span>
        </div>

        <div class="info-col">
          <div class="level-name">${escapeHTML(lvl.name || '')}</div>
          ${metaMarkup ? `<div class="level-meta">${metaMarkup}</div>` : ''}
          ${summaryRowsMarkup}
        </div>
        ${thumbnailMarkup}
        <div class="${actionsClass}">
          <button class="btn-target-toggle ${isLevelTargeted(lvl) ? 'targeted' : ''}" type="button" data-target-level="${escapeHTML(getTargetedLevelKey(lvl))}" title="${isLevelTargeted(lvl) ? 'Remove target' : 'Add to To-Do'}" aria-label="${isLevelTargeted(lvl) ? 'Remove target' : 'Add to To-Do'}">
            <i class="fa-solid ${isLevelTargeted(lvl) ? 'fa-check' : 'fa-star'}"></i>
          </button>
          ${jumpMarkup}
          ${lvl.showcaseVideoUrl ? `<button class="btn-video" type="button" data-open-video-modal="${escapeHTML(lvl.showcaseVideoUrl)}" title="Open showcase video" aria-label="Open showcase video"><i class="fa-solid fa-video"></i></button>` : '<span class="btn-video no-link" title="No video available"><i class="fa-solid fa-video-slash"></i></span>'}
        </div>
      </div>
    `;
    })
    .join('');

  container.innerHTML = cards;
  initLazyThumbnails(container);
}

function renderTimeline(data) {
  const container = document.getElementById('timeline-container');
  unobserveLazyThumbnails(container);
  if (!data.length) {
    container.innerHTML = '<div class="empty-state">// NO TIMELINE ENTRIES FOUND //</div>';
    return;
  }

  const sorted = [...data].sort((a, b) => new Date(b.date) - new Date(a.date));
  const cards = sorted.map((entry, index) => {
    const cardClass = index % 2 === 0 ? 'level-card variant-a timeline' : 'level-card variant-b timeline';
    const actionsClass = index % 2 === 0 ? 'actions-col variant-a' : 'actions-col variant-b';
    const timelineLevel = {
      ...entry,
      id: entry.id || entry.name,
      creators: entry.creators,
      is2Player: Boolean(entry.twoPlayer),
      thumbnail: entry.image || entry.thumbnail || '',
      showcaseVideoUrl: entry.showcaseVideo || entry.showcaseVideoUrl || '',
    };
    const metaMarkup = getLevelMetaMarkup(timelineLevel);
    const dateDisplay = entry.date ? escapeHTML(entry.date) : 'Unknown';

    return `
      <div class="${cardClass}">
        <div class="rank-col">
          <span class="rank-num">${dateDisplay}</span>
        </div>

        <div class="info-col">
          <div class="level-name">${escapeHTML(entry.name || '')}</div>
          <div class="level-meta">
            ${metaMarkup ? metaMarkup : ''}
          </div>
        </div>

        ${getThumbnailMarkup(timelineLevel)}

        <div class="${actionsClass}">
          ${timelineLevel.showcaseVideoUrl
            ? `<button class="btn-video" type="button" data-open-video-modal="${escapeHTML(timelineLevel.showcaseVideoUrl)}" title="Open showcase video" aria-label="Open showcase video"><i class="fa-solid fa-video"></i></button>`
            : '<span class="btn-video no-link" title="No video available"><i class="fa-solid fa-video-slash"></i></span>'}
        </div>
      </div>
    `;
  }).join('');

  container.innerHTML = cards;
  initLazyThumbnails(container);
}

function initializeTimeline() {
  if (timelineLoadPromise) return timelineLoadPromise;

  timelineLoadPromise = loadTimelineData()
    .then((data) => renderTimeline(data))
    .catch(() => {
      timelineLoadPromise = null;
      renderTimeline([]);
    });
  return timelineLoadPromise;
}