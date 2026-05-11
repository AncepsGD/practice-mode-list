let thumbnailObserver;

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

function renderLevels(data) {
  const container = document.getElementById('levels-container');
  if (!data.length) {
    container.innerHTML = '<div class="empty-state">// NO LEVELS FOUND //</div>';
    return;
  }

  const header = `<div class="section-header"><div class="line"></div></div>`;

  const cards = data
    .map(lvl => `
      <div class="level-card" id="card-${lvl.id}">
        <div class="rank-col"><span class="rank-num">#${lvl.rank}</span></div>
        <div class="info-col">
          <div class="level-name">${lvl.name}</div>
          <div class="level-meta">
            <span class="meta-pill creator">${lvl.creator}</span>
            <span class="meta-pill id">ID: ${lvl.id}</span>
            ${lvl.is2Player ? '<span class="meta-pill two-player">2-PLAYER</span>' : ''}
          </div>
          ${lvl.wrTime ? `<div class="victor-row"><span class="victor-label">WR Time:</span><span class="victor-name">${lvl.wrTime.name}</span><span class="victor-stats">${lvl.wrTime.time}</span></div>` : ''}
          ${lvl.wrAttempts ? `<div class="victor-row"><span class="victor-label">WR Attempts:</span><span class="victor-name">${lvl.wrAttempts.name}</span><span class="victor-stats">${lvl.wrAttempts.attempts} atts</span></div>` : ''}
        </div>
        ${lvl.thumbnail ? `<div class="thumb-col"><img class="lazy-thumb" data-src="${lvl.thumbnail}" alt="${lvl.name}" loading="lazy" onerror="tryThumbnailFallback(this, '${lvl.id}')"></div>` : ''}
        <div class="actions-col">
          <button class="btn-expand" onclick="toggleExpand('${lvl.id}')">Victors ▾</button>
          ${lvl.showcaseVideoUrl ? `<a class="btn-video" href="${lvl.showcaseVideoUrl}" target="_blank" rel="noopener">Video ↗</a>` : '<span class="btn-video no-link">No video</span>'}
        </div>
      </div>
      <div class="expand-panel" id="expand-${lvl.id}">
        <div class="expand-inner">
          <table class="victors-table">
            <thead><tr><th>#</th><th>Player</th><th>Date</th><th>Time</th><th>Attempts</th><th>Video</th></tr></thead>
            <tbody>
              ${lvl.victors
        .sort((a, b) => new Date(a.date) - new Date(b.date))
        .map((v, vi) => `
                  <tr>
                    <td class="stat-cell">${vi + 1}</td>
                    <td class="name-cell">${v.name}</td>
                    <td class="date-cell">${v.date}</td>
                    <td class="stat-cell">${v.wrTime}</td>
                    <td class="stat-cell">${v.wrAttempts.toLocaleString()}</td>
                    <td>${v.victorVideoUrl ? `<a href="${v.victorVideoUrl}" target="_blank" rel="noopener" style="color:var(--green)">Watch ↗</a>` : '<span class="no-video">—</span>'}</td>
                  </tr>
                `).join('')}
            </tbody>
          </table>
        </div>
      </div>
    `)
    .join('');

  container.innerHTML = header + cards;
  initLazyThumbnails();
}

function initLazyThumbnails() {
  if (thumbnailObserver) thumbnailObserver.disconnect();
  const lazyImages = Array.from(document.querySelectorAll('img.lazy-thumb[data-src]'));
  if (!lazyImages.length) return;

  if ('IntersectionObserver' in window) {
    thumbnailObserver = new IntersectionObserver(entries => {
      entries.forEach(entry => {
        if (!entry.isIntersecting) return;
        const img = entry.target;
        if (img.dataset.src) {
          img.src = img.dataset.src;
          img.removeAttribute('data-src');
        }
        thumbnailObserver.unobserve(img);
      });
    }, { rootMargin: '200px 0px', threshold: 0.1 });

    lazyImages.forEach(img => thumbnailObserver.observe(img));
  } else {
    lazyImages.forEach(img => {
      if (img.dataset.src) {
        img.src = img.dataset.src;
        img.removeAttribute('data-src');
      }
    });
  }
}

function tryThumbnailFallback(img, id) {
  const fallbackUrl1 = `https://raw.githubusercontent.com/AncepsGD/practice-mode-list/refs/heads/main/thumbnails/${id}.webp`;
  const fallbackUrl2 = `https://raw.githubusercontent.com/AncepsGD/practice-mode-list/refs/heads/main/thumbnails/${id}.png`;

  img.src = fallbackUrl1;
  img.onerror = () => {
    img.src = fallbackUrl2;
    img.onerror = () => (img.parentElement.style.display = 'none');
  };
}

function toggleExpand(id) {
  const panel = document.getElementById(`expand-${id}`);
  const btnText = panel.classList.toggle('open') ? 'Victors ▴' : 'Victors ▾';
  document.querySelector(`#card-${id} .btn-expand`).textContent = btnText;
}

function renderLeaderboard(data) {
  const body = document.getElementById('lb-body');
  if (!data.length) {
    body.innerHTML = '<tr><td colspan="4" class="empty-state">// NO PLAYERS FOUND //</td></tr>';
    return;
  }

  body.innerHTML = data
    .map(p => `
      <tr class="leaderboard-row">
        <td class="rank-td">${leaderboard.indexOf(p) + 1}</td>
        <td><span class="player-name">${p.name}</span></td>
        <td><span class="score-val">${p.points.toFixed(1)}</span></td>
        <td><div class="completion-tags">${p.levels.map(lvl => `<span class="ctag">${lvl}</span>`).join('')}</div></td>
      </tr>
    `)
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
  renderLevels(levels.filter(lvl =>
    lvl.name.toLowerCase().includes(query) ||
    lvl.creator.toLowerCase().includes(query) ||
    String(lvl.id).includes(query)
  ));
}

function filterLeaderboard() {
  const query = document.getElementById('lb-search').value.toLowerCase();
  renderLeaderboard(leaderboard.filter(p => p.name.toLowerCase().includes(query)));
}

function getUnverifiedLevels() {
  return verifications.length > 0 ? verifications : levels.filter(lvl => !lvl.victors || lvl.victors.length === 0);
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
    .map(lvl => `
      <div class="level-card" id="card-${lvl.id}">
        <div class="rank-col"><span class="rank-num">#${lvl.rank}</span></div>
        <div class="info-col">
          <div class="level-name">${lvl.name}</div>
          <div class="level-meta">
            <span class="meta-pill creator">${lvl.creator}</span>
            <span class="meta-pill id">ID: ${lvl.id}</span>
            ${lvl.is2Player ? '<span class="meta-pill two-player">2-PLAYER</span>' : ''}
          </div>
        </div>
        ${lvl.thumbnail ? `<div class="thumb-col"><img class="lazy-thumb" data-src="${lvl.thumbnail}" alt="${lvl.name}" loading="lazy" onerror="tryThumbnailFallback(this, '${lvl.id}')"></div>` : ''}
        <div class="actions-col">
          ${lvl.showcaseVideoUrl ? `<a class="btn-video" href="${lvl.showcaseVideoUrl}" target="_blank" rel="noopener">Video ↗</a>` : '<span class="btn-video no-link">No video</span>'}
        </div>
      </div>
    `)
    .join('');

  container.innerHTML = cards;
  initLazyThumbnails();
}
