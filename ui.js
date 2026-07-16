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

function normalizeLevelSearchText(value) {
  return String(value || '').trim().toLowerCase();
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
      const creatorScore = normalizeLevelSearchText(lvl.creator).includes(normalizedQuery) ? 300 : 0;
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
    entries.push({
      name: level.wrAttempts.name,
      label: 'WR Attempts',
      value: `${level.wrAttempts.attempts} atts`,
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

      if (!lvl._sortedVictors) {
        lvl._sortedVictors = [...(lvl.victors || [])]
          .sort((a, b) => new Date(a.date) - new Date(b.date));
      }

      return `
      <div class="${cardClass}" id="card-${levelKey}">
        <div class="rank-col">
          <span class="rank-num">#${lvl.rank}</span>
        </div>

        <div class="info-col">
          <div class="level-name">${escapeHTML(lvl.name)}</div>

          <div class="level-meta">
            <span class="meta-pill creator">${escapeHTML(lvl.creator)}</span>
            ${lvl.tier ? `<span class="meta-pill tier">${escapeHTML(lvl.tier)}</span>` : ''}
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
          <button class="btn-expand" data-level="${levelKey}">
            Victors ▾
          </button>

          ${
            lvl.showcaseVideoUrl
            ? `<a class="btn-video"
                 href="${lvl.showcaseVideoUrl}"
                 target="_blank"
                 rel="noopener">
                 Video ↗
               </a>`
            : '<span class="btn-video no-link">No video</span>'
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
              <td>${v.wrTime}</td>
              <td>${v.wrAttempts.toLocaleString()}</td>
              <td>
                ${
                  v.victorVideoUrl
                  ? `<a href="${v.victorVideoUrl}"
                       target="_blank"
                       rel="noopener">
                       Watch ↗
                     </a>`
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

  const btnText = panel.classList.toggle('open') ? 'Victors ▴' : 'Victors ▾';
  button.textContent = btnText;
}

function renderLeaderboard(data) {
  const body = document.getElementById('lb-body');
  if (!data.length) {
    body.innerHTML = '<tr><td colspan="4" class="empty-state">// NO PLAYERS FOUND //</td></tr>';
    return;
  }

  function countryCodeToEmoji(code) {
    if (!code || typeof code !== 'string' || code.length !== 2) return '';

    const chars = code.toUpperCase().split('');
    return chars.map(c => String.fromCodePoint(127397 + c.charCodeAt(0))).join('');
  }

  body.innerHTML = data
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
          <td class="rank-td">${data.indexOf(p) + 1}</td>
          <td><span class="player-name">${(window.playerCountries && window.playerCountries[p.name]) ? countryCodeToEmoji(window.playerCountries[p.name]) + ' ' : ''}${escapeHTML(p.name)}</span></td>
          <td><span class="score-val">${p.points.toFixed(1)}</span></td>
          <td class="completion-cell">
            <div class="completion-summary-row">
              <div class="completion-stat-pill">
                <span class="completion-stat-label">Completed</span>
                <strong>${completionCount}</strong>
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

  renderLevels(rankedLevels);
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
}

function shuffleVerifications() {
  const unverifiedLevels = getUnverifiedLevels();
  const shuffledLevels = shuffleArray(unverifiedLevels);
  sessionStorage.setItem('verifications-list', JSON.stringify(shuffledLevels));
  renderVerifications(shuffledLevels);
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
      const levelKey = getLevelCardKey(lvl, index);
      const thumbnailMarkup = getThumbnailMarkup(lvl);
      return `
      <div class="${cardClass}" id="card-${levelKey}">
        <div class="rank-col"><span class="rank-num">#${lvl.rank}</span></div>
        <div class="info-col">
          <div class="level-name">${lvl.name}</div>
          <div class="level-meta">
            <span class="meta-pill creator">${lvl.creator}</span>
            ${lvl.tier ? `<span class="meta-pill tier">${lvl.tier}</span>` : ''}
            <span class="meta-pill id">ID: ${lvl.id}</span>
            ${lvl.is2Player ? '<span class="meta-pill two-player">2-PLAYER</span>' : ''}
          </div>
          ${getLevelSummaryRows(lvl).map((row) => `<div class="victor-row"><span class="victor-label">${row.label}:</span><span class="victor-name">${row.name}</span><span class="victor-stats">${row.stat}</span></div>`).join('')}
        </div>
        ${thumbnailMarkup}
        <div class="actions-col">
          ${lvl.showcaseVideoUrl ? `<a class="btn-video" href="${lvl.showcaseVideoUrl}" target="_blank" rel="noopener">Video ↗</a>` : '<span class="btn-video no-link">No video</span>'}
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
    return `
      <div class="${cardClass}">
        <div class="rank-col"><span class="rank-num">${entry.date}</span></div>
        <div class="info-col">
          <div class="level-name">${entry.name}</div>
          <div class="level-meta">
            ${entry.creators ? `<span class="meta-pill creator">${entry.creators}</span>` : ''}
          </div>
        </div>
      </div>
    `;
  }).join('');

  container.innerHTML = cards;
}

function initializeTimeline() {
  fetch('timeline.json')
    .then((response) => response.json())
    .then((data) => renderTimeline(data))
    .catch(() => renderTimeline([]));
}