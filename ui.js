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

function renderStats() {
  const totalVictors = new Set(levels.flatMap(lvl => lvl.victors.map(victor => victor.name))).size;
  const totalCompletions = levels.reduce((sum, lvl) => sum + lvl.victors.length, 0);

  document.getElementById('stats-strip').innerHTML = `
    <div class="stat-box"><span class="val">${levels.length}</span><span class="lbl">Levels Ranked</span></div>
    <div class="stat-box"><span class="val">${totalVictors}</span><span class="lbl">Unique Players</span></div>
    <div class="stat-box"><span class="val">${totalCompletions}</span><span class="lbl">Total Completions</span></div>
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

const TARGETED_LEVELS_STORAGE_KEY = 'pml_targeted_levels';

function getTargetedLevelKey(level) {
  const sourceId = String(level?.id ?? '').trim();
  const sourceName = String(level?.name ?? '').trim();
  const key = sourceId || sourceName;
  return key ? key.toLowerCase() : '';
}

function getStoredTargetedLevels() {
  try {
    const saved = JSON.parse(localStorage.getItem(TARGETED_LEVELS_STORAGE_KEY) || '[]');
    return Array.isArray(saved) ? saved.filter((entry) => typeof entry === 'string').map((entry) => String(entry).trim().toLowerCase()) : [];
  } catch (error) {
    return [];
  }
}

function saveStoredTargetedLevels(keys) {
  try {
    localStorage.setItem(TARGETED_LEVELS_STORAGE_KEY, JSON.stringify([...new Set(keys.filter(Boolean))]));
  } catch (error) {
    // localStorage may be unavailable
  }
}

function isLevelTargeted(level) {
  const key = getTargetedLevelKey(level);
  if (!key) return false;
  return getStoredTargetedLevels().includes(key);
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
  renderVerifications(getVerificationsList());
}

function getTargetedLevelsFromData(sourceLevels) {
  const keyed = getStoredTargetedLevels();
  if (!keyed.length) return [];

  return (sourceLevels || []).filter((level) => keyed.includes(getTargetedLevelKey(level)));
}

function getTodoTierRankRange(level) {
  const tier = String(level?.tier || '').trim().toLowerCase();
  if (!tier) return null;

  const tierRanks = levels
    .filter((mainLevel) => String(mainLevel?.tier || '').trim().toLowerCase() === tier)
    .map((mainLevel) => Number(mainLevel.rank))
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
      const aRank = Number(a.rank ?? Number.MAX_SAFE_INTEGER);
      const bRank = Number(b.rank ?? Number.MAX_SAFE_INTEGER);
      if (Number.isFinite(aRank) && Number.isFinite(bRank) && aRank !== bRank) return aRank - bRank;
      return String(a.name || '').localeCompare(String(b.name || ''));
    })
    .map((lvl, index) => {
      const cardClass = index % 2 === 0 ? 'level-card variant-a' : 'level-card variant-b';
      const isMainList = levels.some((item) => getTargetedLevelKey(item) === getTargetedLevelKey(lvl));
      const sourceLabel = isMainList ? 'Main List' : 'Unverified';
      const buttonText = 'Remove Target';
      const tierRankRange = !isMainList ? getTodoTierRankRange(lvl) : null;
      const rankLabel = isMainList && Number.isFinite(Number(lvl.rank))
        ? `#${lvl.rank}`
        : tierRankRange
          ? `#${tierRankRange.min}-${tierRankRange.max}~`
          : '•';

      return `
        <div class="${cardClass}">
          <div class="rank-col">
            <span class="rank-num" aria-hidden="true">${rankLabel}</span>
          </div>

          <div class="info-col">
            <div class="level-name">${escapeHTML(lvl.name || '')}</div>
            <div class="level-meta">
              ${sourceLabel ? `<span class="meta-pill creator">${escapeHTML(sourceLabel)}</span>` : ''}
              ${lvl.tier ? `<span class="meta-pill tier">${escapeHTML(lvl.tier)}</span>` : ''}
              ${getLevelTpsDisplayValue(lvl) !== null ? `<span class="meta-pill tps">TPS: ${escapeHTML(String(getLevelTpsDisplayValue(lvl)))}</span>` : ''}
              ${String(lvl.id || '').trim() ? `<span class="meta-pill id">ID: ${escapeHTML(String(lvl.id || '').trim())}</span>` : ''}
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
  initLazyThumbnails();
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
let listSortState = { ...LIST_SORT_DEFAULT_STATE };

function loadListSortState() {
  try {
    const stored = localStorage.getItem(LIST_SORT_STORAGE_KEY);
    if (!stored) return LIST_SORT_DEFAULT_STATE;
    const parsed = JSON.parse(stored);
    if (parsed && typeof parsed === 'object' && ['rank', 'name', 'creators', 'victors', 'earliestDate', 'id'].includes(parsed.key) && ['asc', 'desc'].includes(parsed.direction)) {
      return parsed;
    }
  } catch (e) {
    // ignore invalid stored state
  }
  return LIST_SORT_DEFAULT_STATE;
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

function getListSortValue(item, key, direction = 1) {
  switch (key) {
    case 'rank': {
      const value = Number.isFinite(Number(item.rank)) ? Number(item.rank) : null;
      return value !== null ? value : (direction === 1 ? Number.MAX_SAFE_INTEGER : Number.MIN_SAFE_INTEGER);
    }
    case 'name':
      return String(item.name || '').toLowerCase();
    case 'creators':
      return normalizeLevelSearchText(getLevelCreatorValue(item));
    case 'victors':
      return Array.isArray(item.victors) ? item.victors.length : 0;
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

function getLevelMetaMarkup(level) {
  const metaPills = [];
  const creatorValue = getLevelCreatorValue(level);

  if (creatorValue) {
    metaPills.push(`<span class="meta-pill creator">${escapeHTML(creatorValue)}</span>`);
  }

  if (level.tier) {
    metaPills.push(`<span class="meta-pill tier">${escapeHTML(level.tier)}</span>`);
  }

  const tpsValue = getLevelTpsDisplayValue(level);
  if (tpsValue !== null) {
    metaPills.push(`<span class="meta-pill tps">TPS: ${escapeHTML(String(tpsValue))}</span>`);
  }

  const idValue = String(level.id ?? '').trim();
  if (idValue) {
    metaPills.push(`<span class="meta-pill id">ID: ${escapeHTML(idValue)}</span>`);
  }

  if (level.is2Player) {
    metaPills.push('<span class="meta-pill two-player">2-PLAYER</span>');
  }

  return metaPills.join('');
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
let thumbnailObserver = null;

function escapeHTML(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function getPlayerCountryEmoji(name) {
  if (!name || typeof name !== 'string') return '';
  const code = window.playerCountries && window.playerCountries[name.trim()];
  if (!code || typeof code !== 'string' || code.length !== 2) return '';
  return code.toUpperCase().split('').map(c => String.fromCodePoint(127397 + c.charCodeAt(0))).join('');
}

function getThumbnailMarkup(level) {
  if (thumbnailCache.has(level.id)) {
    return thumbnailCache.get(level.id);
  }

  const explicitThumbnail = String(level.thumbnail || '').trim();

  let markup = '';

  if (explicitThumbnail) {
    markup = `
      <div class="thumb-col">
        <img class="lazy-thumb"
             src="${explicitThumbnail}"
             data-id="${level.id}"
             alt="${escapeHTML(level.name)}"
             loading="lazy">
      </div>`;
  } else {
    const victorVideoUrls = (level.victors || [])
      .map(v => v.victorVideoUrl)
      .filter(Boolean);

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
               src="${unique[0]}"
               data-fallbacks="${encodeURIComponent(JSON.stringify(unique.slice(1)))}"
               data-id="${level.id}"
               alt="${escapeHTML(level.name)}"
               loading="lazy"
               onerror="tryThumbnailFallback(this)">
        </div>`;
    }
  }

  thumbnailCache.set(level.id, markup);
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

function renderLevels(data) {
  const container = document.getElementById('levels-container');

  if (!data.length) {
    container.innerHTML = '<div class="empty-state">// NO LEVELS FOUND //</div>';
    return;
  }

  const fragment = document.createDocumentFragment();

  const wrapper = document.createElement('div');

  wrapper.innerHTML = `
    <div class="section-header">
      <div class="line"></div>
    </div>
    ${data.map((lvl, index) => {
      const levelKey = getLevelCardKey(lvl, index);
      const cardClass = index % 2 ?
        'level-card variant-b' :
        'level-card variant-a';
      const rankValue = Number(lvl.rank);
      const rankClass = rankValue === 1 ? 'rank-gold' : rankValue === 2 ? 'rank-silver' : rankValue === 3 ? 'rank-bronze' : '';

      if (!lvl._sortedVictors) {
        lvl._sortedVictors = [...(lvl.victors || [])]
          .sort((a, b) => new Date(a.date) - new Date(b.date));
      }

      return `
      <div class="${cardClass}" id="card-${levelKey}">
        <div class="rank-col">
          <span class="rank-num ${rankClass}">#${lvl.rank}</span>
        </div>

        <div class="info-col">
          <div class="level-name">${escapeHTML(lvl.name)}</div>

          <div class="level-meta">
            ${getLevelCreatorValue(lvl) ? `<span class="meta-pill creator">${escapeHTML(getLevelCreatorValue(lvl))}</span>` : ''}
            ${lvl.tier ? `<span class="meta-pill tier">${escapeHTML(lvl.tier)}</span>` : ''}
            ${getLevelTpsDisplayValue(lvl) !== null ? `<span class="meta-pill tps">TPS: ${escapeHTML(String(getLevelTpsDisplayValue(lvl)))}</span>` : ''}
            <span class="meta-pill id">ID: ${lvl.id}</span>
            ${lvl.is2Player ? '<span class="meta-pill two-player">2-PLAYER</span>' : ''}
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
          <button class="btn-expand" data-level="${levelKey}" title="Toggle victors list" aria-label="Toggle victors list">
            <i class="fa-solid fa-chevron-down"></i>
          </button>
          <button class="btn-target-toggle ${isLevelTargeted(lvl) ? 'targeted' : ''}" type="button" data-target-level="${escapeHTML(getTargetedLevelKey(lvl))}" title="${isLevelTargeted(lvl) ? 'Remove target' : 'Add to To-Do'}" aria-label="${isLevelTargeted(lvl) ? 'Remove target' : 'Add to To-Do'}">
            <i class="fa-solid ${isLevelTargeted(lvl) ? 'fa-check' : 'fa-star'}"></i>
          </button>

          ${
            lvl.showcaseVideoUrl
            ? `<button class="btn-video" type="button" data-open-video-modal="${escapeHTML(lvl.showcaseVideoUrl)}" title="Open showcase video" aria-label="Open showcase video">
                 <i class="fa-solid fa-video"></i>
               </button>`
            : '<span class="btn-video no-link" title="No video available"><i class="fa-solid fa-video-slash"></i></span>'
          }
        </div>
      </div>

      <div class="expand-panel" id="expand-${levelKey}">
        <div class="expand-inner">
          <table class="victors-table">
          <thead>
            <tr>
              <th>#</th>
              <th>Player</th>
              <th>Date</th>
              <th>Time</th>
              <th>Attempts</th>
              <th>Video</th>
            </tr>
          </thead>

          <tbody>
          ${lvl._sortedVictors.map((v,i)=>`
            <tr>
              <td>${i+1}</td>
              <td>${getPlayerCountryEmoji(v.name) ? getPlayerCountryEmoji(v.name) + ' ' : ''}${escapeHTML(v.name)}</td>
              <td>${v.date}</td>
              <td>${v.wrTime ? v.wrTime : '—'}</td>
              <td>${v.wrAttempts == null ? '—' : v.wrAttempts.toLocaleString()}</td>
              <td>
                ${
                  v.victorVideoUrl
                  ? `<button class="btn-video btn-video-inline" type="button" data-open-video-modal="${escapeHTML(v.victorVideoUrl)}" title="Watch video" aria-label="Watch video"><i class="fa-solid fa-play"></i></button>`
                  : '—'
                }
              </td>
            </tr>
          `).join('')}
          </tbody>

          </table>
        </div>
      </div>`;
    }).join('')}
  `;

  fragment.appendChild(wrapper);
  container.replaceChildren(fragment);

  initExpandHandlers();
  initLazyThumbnails();
  bindVideoModalEvents();
}
function initExpandHandlers() {
  const container = document.getElementById('levels-container');

  container.onclick = e => {
    const button = e.target.closest('.btn-expand');

    if (!button) return;

    toggleExpand(button.dataset.level);
  };
}
function initLazyThumbnails() {
  const images = document.querySelectorAll('.lazy-thumb');

  if (thumbnailObserver) {
    thumbnailObserver.disconnect();
  }

  if (!('IntersectionObserver' in window)) return;

  thumbnailObserver = new IntersectionObserver(entries => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;

      const img = entry.target;

      img.loading = 'lazy';

      thumbnailObserver.unobserve(img);
    }
  }, {
    rootMargin: '300px'
  });

  images.forEach(img => thumbnailObserver.observe(img));
}
function tryThumbnailFallback(img) {
  let urls = [];

  try {
    urls = JSON.parse(
      decodeURIComponent(img.dataset.fallbacks || '[]')
    );
  } catch {}

  const id = img.dataset.id;

  urls.push(
    `https://raw.githubusercontent.com/AncepsGD/practice-mode-list/main/thumbnails/${id}.webp`,
    `https://raw.githubusercontent.com/AncepsGD/practice-mode-list/main/thumbnails/${id}.png`
  );

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

function toggleExpand(id) {
  const panel = document.getElementById(`expand-${id}`);
  const button = document.querySelector(`#card-${id} .btn-expand`);
  if (!panel || !button) return;

  const isOpen = panel.classList.toggle('open');
  const icon = button.querySelector('i');
  if (icon) {
    icon.classList.toggle('fa-chevron-up', isOpen);
    icon.classList.toggle('fa-chevron-down', !isOpen);
  }
}

function renderLeaderboard(data) {
  const body = document.getElementById('lb-body');
  const sortedData = getSortedLeaderboardData(data);
  if (!sortedData.length) {
    body.innerHTML = '<tr><td colspan="4" class="empty-state">// NO PLAYERS FOUND //</td></tr>';
    return;
  }

  function countryCodeToEmoji(code) {
    if (!code || typeof code !== 'string' || code.length !== 2) return '';

    const chars = code.toUpperCase().split('');
    return chars.map(c => String.fromCodePoint(127397 + c.charCodeAt(0))).join('');
  }

  body.innerHTML = sortedData
    .map((p) => {
      const completionDetails = Array.isArray(p.completionDetails) && p.completionDetails.length
        ? p.completionDetails
        : (p.levels || []).map((name) => ({ name, points: 0, tier: 'unknown' }));
      const completionCount = p.completionCount ?? completionDetails.length;
      const hardestCompletion = p.hardestCompletion || completionDetails.reduce((best, current) => {
        if (!best) return current;
        return (Number(current.points) || 0) > (Number(best.points) || 0) ? current : best;
      }, null);
      const hardestLabel = hardestCompletion
        ? `<span class="hardest-completion-primary">${escapeHTML(hardestCompletion.name)}</span><span class="hardest-completion-secondary">${escapeHTML(hardestCompletion.tier || 'Unknown')} · ${Number(hardestCompletion.points || 0).toFixed(0)} pts</span>`
        : '<span class="hardest-completion-primary">None</span>';
      const orderedLevelsMarkup = completionDetails.map((entry) => `
        <li class="completion-order-item">
          <span class="completion-order-name">${escapeHTML(entry.name)}</span>
          <span class="completion-order-meta">${escapeHTML(entry.tier || 'unknown')} · ${Number(entry.points || 0).toFixed(0)} pts</span>
        </li>
      `).join('');
      return `
        <tr class="leaderboard-row">
          <td class="rank-td">${p.rank ?? sortedData.indexOf(p) + 1}</td>
          <td><span class="player-name">${(window.playerCountries && window.playerCountries[p.name]) ? countryCodeToEmoji(window.playerCountries[p.name]) + ' ' : ''}${escapeHTML(p.name)}</span></td>
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
              <div class="completion-stat-pill">
                <span class="completion-stat-label">Hardest</span>
                <strong>${hardestLabel}</strong>
              </div>
              <details class="completion-dropdown completion-dropdown--inline">
                <summary>
                  <span class="completion-summary">
                    <span class="completion-count">View completions</span>
                    <span class="completion-pill">▾</span>
                  </span>
                </summary>
                <div class="completion-dropdown-body">
                  <ol class="completion-order-list">${orderedLevelsMarkup}</ol>
                </div>
              </details>
            </div>
          </td>
        </tr>
      `;
    })
    .join('');
}

function showPage(name, btn) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
  document.getElementById(`page-${name}`).classList.add('active');
  btn.classList.add('active');
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

function filterLeaderboard() {
  const query = document.getElementById('lb-search').value.trim().toLowerCase();
  renderLeaderboard(
    leaderboard.filter((p) => {
      const haystack = [
        p.name,
        String(p.points),
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
  const sourceLevels = verifications.length > 0 ? verifications : levels.filter((lvl) => !lvl.victors || lvl.victors.length === 0);
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

function initializeVerifications() {
  const unverifiedLevels = getUnverifiedLevels();
  const shuffledLevels = shuffleArray(unverifiedLevels);
  sessionStorage.setItem('verifications-list', JSON.stringify(shuffledLevels));
  renderVerifications(shuffledLevels);
  renderTargetedLevels();
}

function shuffleVerifications() {
  const unverifiedLevels = getUnverifiedLevels();
  const shuffledLevels = shuffleArray(unverifiedLevels);
  sessionStorage.setItem('verifications-list', JSON.stringify(shuffledLevels));
  renderVerifications(shuffledLevels);
  renderTargetedLevels();
}

function getVerificationsList() {
  return JSON.parse(sessionStorage.getItem('verifications-list')) || getUnverifiedLevels();
}

function renderVerifications(data) {
  const container = document.getElementById('verifications-container');
  if (!data.length) {
    container.innerHTML = '<div class="empty-state">// ALL LEVELS VERIFIED! //</div>';
    return;
  }

  const cards = data
    .map((lvl, index) => {
      const cardClass = index % 2 === 0 ? 'level-card variant-a' : 'level-card variant-b';
      const actionsClass = index % 2 === 0 ? 'actions-col variant-a' : 'actions-col variant-b';
      const levelKey = getLevelCardKey(lvl, index);
      const thumbnailMarkup = getThumbnailMarkup(lvl);
      const metaMarkup = getLevelMetaMarkup(lvl);
      const tierRankRange = getTodoTierRankRange(lvl);
      const rankLabel = tierRankRange
        ? `#${tierRankRange.min}-${tierRankRange.max}~`
        : '•';
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
          ${lvl.showcaseVideoUrl ? `<button class="btn-video" type="button" data-open-video-modal="${escapeHTML(lvl.showcaseVideoUrl)}" title="Open showcase video" aria-label="Open showcase video"><i class="fa-solid fa-video"></i></button>` : '<span class="btn-video no-link" title="No video available"><i class="fa-solid fa-video-slash"></i></span>'}
        </div>
      </div>
    `;
    })
    .join('');

  container.innerHTML = cards;
  initLazyThumbnails();
}

function renderTimeline(data) {
  const container = document.getElementById('timeline-container');
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
  initLazyThumbnails();
}

function initializeTimeline() {
  fetch('timeline.json')
    .then((response) => response.json())
    .then((data) => renderTimeline(data))
    .catch(() => renderTimeline([]));
}