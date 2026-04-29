let thumbnailObserver;

function setSystemBusy(isBusy) {
  systemBusy = isBusy;
  const btnA = document.getElementById("suggestion-a");
  const btnB = document.getElementById("suggestion-b");
  if (btnA) btnA.disabled = isBusy || !currentSuggestionPair;
  if (btnB) btnB.disabled = isBusy || !currentSuggestionPair;
}

function setSystemStatus(message) {
  const status = document.getElementById("system-status");
  if (status) status.textContent = message;
}

function flashSaved() {
  const el = document.getElementById("save-flash");
  el.classList.add("show");
  setTimeout(() => el.classList.remove("show"), 2000);
}

function flashCopied() {
  const el = document.getElementById("save-flash");
  el.textContent = "✓ COPIED TO CLIPBOARD";
  el.classList.add("show");
  setTimeout(() => {
    el.classList.remove("show");
    el.textContent = "✓ SAVED";
  }, 2000);
}

function renderStats() {
  const totalVictors = new Set(
    levels.flatMap((l) => l.victors.map((v) => v.name)),
  ).size;
  const totalCompletions = levels.reduce((s, l) => s + l.victors.length, 0);
  document.getElementById("stats-strip").innerHTML = `
    <div class="stat-box"><span class="val">${levels.length}</span><span class="lbl">Levels Ranked</span></div>
    <div class="stat-box"><span class="val">${totalVictors}</span><span class="lbl">Unique Players</span></div>
    <div class="stat-box"><span class="val">${totalCompletions}</span><span class="lbl">Total Completions</span></div>
  `;
}

function renderLevels(data) {
  const container = document.getElementById("levels-container");
  if (!data.length) {
    container.innerHTML = '<div class="empty-state">// NO LEVELS FOUND //</div>';
    return;
  }

  const header = `<div class="section-header"><div class="line"></div></div>`;

  const cards = data
    .map((lvl) => {
      const hasVideo = lvl.showcaseVideoUrl && lvl.showcaseVideoUrl.trim() !== "";
      return `
        <div class="level-card" id="card-${lvl.id}">
          <div class="rank-col"><span class="rank-num">#${lvl.rank}</span></div>
          <div class="info-col">
            <div class="level-name">${lvl.name}</div>
            <div class="level-meta">
              <span class="meta-pill creator">${lvl.creator}</span>
              <span class="meta-pill id">ID: ${lvl.id}</span>
              ${lvl.is2Player ? '<span class="meta-pill two-player">2-PLAYER</span>' : ""}
            </div>
            ${lvl.wrTime ? `<div class="victor-row"><span class="victor-label">WR Time:</span><span class="victor-name">${lvl.wrTime.name}</span><span class="victor-stats">${lvl.wrTime.time}</span></div>` : ""}
            ${lvl.wrAttempts ? `<div class="victor-row"><span class="victor-label">WR Attempts:</span><span class="victor-name">${lvl.wrAttempts.name}</span><span class="victor-stats">${lvl.wrAttempts.attempts} atts</span></div>` : ""}
          </div>
          ${lvl.thumbnail ? `<div class="thumb-col"><img class="lazy-thumb" data-src="${lvl.thumbnail}" alt="${lvl.name}" loading="lazy" onerror="tryThumbnailFallback(this, '${lvl.id}')"></div>` : ""}
          <div class="actions-col">
            <button class="btn-expand" onclick="toggleExpand('${lvl.id}')">Victors ▾</button>
            ${hasVideo
              ? `<a class="btn-video" href="${lvl.showcaseVideoUrl}" target="_blank" rel="noopener">Video ↗</a>`
              : `<span class="btn-video no-link">No video</span>`
            }
          </div>
        </div>
        <div class="expand-panel" id="expand-${lvl.id}">
          <div class="expand-inner">
            <table class="victors-table">
              <thead><tr><th>#</th><th>Player</th><th>Date</th><th>Time</th><th>Attempts</th><th>Video</th></tr></thead>
              <tbody>
                ${[...lvl.victors]
                  .sort((a, b) => new Date(a.date) - new Date(b.date))
                  .map(
                    (v, vi) => `
                    <tr>
                      <td class="stat-cell">${vi + 1}</td>
                      <td class="name-cell">${v.name}</td>
                      <td class="date-cell">${v.date}</td>
                      <td class="stat-cell">${v.wrTime}</td>
                      <td class="stat-cell">${v.wrAttempts.toLocaleString()}</td>
                      <td>${v.victorVideoUrl ? `<a href="${v.victorVideoUrl}" target="_blank" rel="noopener" style="color:var(--green)">Watch ↗</a>` : '<span class="no-video">—</span>'}</td>
                    </tr>
                  `,
                  )
                  .join("")}
              </tbody>
            </table>
          </div>
        </div>
      `;
    })
    .join("");

  container.innerHTML = header + cards;
  initLazyThumbnails();
}

function initLazyThumbnails() {
  if (thumbnailObserver) thumbnailObserver.disconnect();
  const lazyImages = Array.from(document.querySelectorAll("img.lazy-thumb[data-src]"));
  if (!lazyImages.length) return;
  if ("IntersectionObserver" in window) {
    thumbnailObserver = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          const img = entry.target;
          if (img.dataset.src) {
            img.src = img.dataset.src;
            img.removeAttribute("data-src");
          }
          thumbnailObserver.unobserve(img);
        });
      },
      { rootMargin: "200px 0px", threshold: 0.1 },
    );
    lazyImages.forEach((img) => thumbnailObserver.observe(img));
  } else {
    lazyImages.forEach((img) => {
      if (img.dataset.src) {
        img.src = img.dataset.src;
        img.removeAttribute("data-src");
      }
    });
  }
}

function tryThumbnailFallback(img, id) {
  img.src = `https://raw.githubusercontent.com/AncepsGD/practice-mode-list/refs/heads/main/thumbnails/${id}.webp`;
  img.onerror = () => {
    img.src = `https://raw.githubusercontent.com/AncepsGD/practice-mode-list/refs/heads/main/thumbnails/${id}.png`;
    img.onerror = () => (img.parentElement.style.display = "none");
  };
}

function toggleExpand(id) {
  const panel = document.getElementById("expand-" + id);
  panel.classList.toggle("open");
  const btn = document.querySelector(`#card-${id} .btn-expand`);
  btn.textContent = panel.classList.contains("open") ? "Victors ▴" : "Victors ▾";
}

function renderLeaderboard(data) {
  const body = document.getElementById("lb-body");
  if (!data.length) {
    body.innerHTML = '<tr><td colspan="4" class="empty-state">// NO PLAYERS FOUND //</td></tr>';
    return;
  }
  body.innerHTML = data
    .map((p) => {
      const rank = leaderboard.indexOf(p) + 1;
      return `
        <tr class="leaderboard-row">
          <td class="rank-td">${rank}</td>
          <td><span class="player-name">${p.name}</span></td>
          <td><span class="score-val">${p.points.toFixed(1)}</span></td>
          <td><div class="completion-tags">${p.levels.map((l) => `<span class="ctag">${l}</span>`).join("")}</div></td>
        </tr>
      `;
    })
    .join("");
}

function renderSystemUnavailable(message) {
  const status = document.getElementById("system-status");
  const body = document.getElementById("system-rankings-body");
  const stats = document.getElementById("system-stats-strip");
  status.textContent = message;
  body.innerHTML = '<tr><td colspan="7" class="empty-state">// SYSTEM OFFLINE //</td></tr>';
  stats.innerHTML = `
    <div class="stat-box"><span class="val">0</span><span class="lbl">Tracked Levels</span></div>
    <div class="stat-box"><span class="val">0</span><span class="lbl">Comparisons</span></div>
    <div class="stat-box"><span class="val">0</span><span class="lbl">Model Players</span></div>
  `;
  document.getElementById("suggestion-a").disabled = true;
  document.getElementById("suggestion-b").disabled = true;
}

function renderSystemRankings(rows) {
  const body = document.getElementById("system-rankings-body");
  const stats = document.getElementById("system-stats-strip");
  if (!rows.length) {
    body.innerHTML = '<tr><td colspan="7" class="empty-state">// NO RANKINGS AVAILABLE //</td></tr>';
  } else {
    body.innerHTML = rows
      .map(
        (row, idx) => `
        <tr>
          <td>${idx + 1}</td>
          <td>${row.name}</td>
          <td><span class="system-tier">${row.tier}</span></td>
          <td>${row.rating.toFixed(1)}</td>
          <td>${row.uncertainty.toFixed(1)}</td>
          <td>${row.score.toFixed(1)}</td>
          <td>${row.controversyScore.toFixed(4)}</td>
        </tr>
      `,
      )
      .join("");
  }

  const comparisons = demonSystem ? demonSystem.comparisons.length : 0;
  const players = demonSystem ? demonSystem.players.size : 0;
  stats.innerHTML = `
    <div class="stat-box"><span class="val">${rows.length}</span><span class="lbl">Tracked Levels</span></div>
    <div class="stat-box"><span class="val">${comparisons}</span><span class="lbl">Comparisons</span></div>
    <div class="stat-box"><span class="val">${players}</span><span class="lbl">Model Players</span></div>
  `;
}

function renderSuggestion() {
  const status = document.getElementById("system-status");
  const btnA = document.getElementById("suggestion-a");
  const btnB = document.getElementById("suggestion-b");

  if (!demonSystem) {
    status.textContent = "System unavailable: initialize rankings first.";
    btnA.textContent = "System unavailable";
    btnB.textContent = "System unavailable";
    btnA.disabled = true;
    btnB.disabled = true;
    return;
  }

  if (systemBusy) {
    status.textContent = "Working... updating rankings and suggestions.";
    btnA.textContent = "Please wait...";
    btnB.textContent = "Please wait...";
    btnA.disabled = true;
    btnB.disabled = true;
    return;
  }

  if (demonSystem.levels.size < 2) {
    status.textContent = "Need at least two levels in the list to generate a comparison.";
    btnA.textContent = "Not enough levels";
    btnB.textContent = "Not enough levels";
    btnA.disabled = true;
    btnB.disabled = true;
    return;
  }

  if (!currentSuggestionPair) {
    status.textContent = "No high-value pair available right now. Try Suggest New Pair.";
    btnA.textContent = "No pair available";
    btnB.textContent = "No pair available";
    btnA.disabled = true;
    btnB.disabled = true;
    return;
  }

  const [idA, idB] = currentSuggestionPair;
  btnA.textContent = levelMetaByModelId.get(idA) || idA;
  btnB.textContent = levelMetaByModelId.get(idB) || idB;
  btnA.disabled = false;
  btnB.disabled = false;
  status.textContent = "Choose the harder level. Your choice is saved and rankings recalculate.";
}

function showPage(name, btn) {
  document.querySelectorAll(".page").forEach((p) => p.classList.remove("active"));
  document.querySelectorAll(".nav-btn").forEach((b) => b.classList.remove("active"));
  document.getElementById("page-" + name).classList.add("active");
  btn.classList.add("active");
}

function handleListSearch() {
  const val = document.getElementById("list-search").value;
  if (val.toLowerCase() === "edit") {
    document.getElementById("list-search").value = "";
    openEditMenu();
    return;
  }
  filterList(val);
}

function filterList(q) {
  q = (q || document.getElementById("list-search").value).toLowerCase();
  renderLevels(
    levels.filter(
      (l) =>
        l.name.toLowerCase().includes(q) ||
        l.creator.toLowerCase().includes(q) ||
        String(l.id).includes(q),
    ),
  );
}

function filterLeaderboard() {
  const q = document.getElementById("lb-search").value.toLowerCase();
  renderLeaderboard(leaderboard.filter((p) => p.name.toLowerCase().includes(q)));
}

function getUnverifiedLevels() {
  if (verifications.length > 0) {
    return verifications;
  }
  return levels.filter((lvl) => !lvl.victors || lvl.victors.length === 0);
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
  const unverified = getUnverifiedLevels();
  const shuffled = shuffleArray(unverified);
  sessionStorage.setItem('verifications-list', JSON.stringify(shuffled));
  renderVerifications(shuffled);
}

function shuffleVerifications() {
  const unverified = getUnverifiedLevels();
  const shuffled = shuffleArray(unverified);
  sessionStorage.setItem('verifications-list', JSON.stringify(shuffled));
  renderVerifications(shuffled);
}

function getVerificationsList() {
  const stored = sessionStorage.getItem('verifications-list');
  if (stored) {
    try {
      return JSON.parse(stored);
    } catch (e) {}
  }
  return getUnverifiedLevels();
}

function renderVerifications(data) {
  const container = document.getElementById("verifications-container");
  if (!data.length) {
    container.innerHTML = '<div class="empty-state">// ALL LEVELS VERIFIED! //</div>';
    return;
  }

  const cards = data
    .map((lvl) => {
      const hasVideo = lvl.showcaseVideoUrl && lvl.showcaseVideoUrl.trim() !== "";
      return `
        <div class="level-card" id="card-${lvl.id}">
          <div class="rank-col"><span class="rank-num">#${lvl.rank}</span></div>
          <div class="info-col">
            <div class="level-name">${lvl.name}</div>
            <div class="level-meta">
              <span class="meta-pill creator">${lvl.creator}</span>
              <span class="meta-pill id">ID: ${lvl.id}</span>
              ${lvl.is2Player ? '<span class="meta-pill two-player">2-PLAYER</span>' : ""}
            </div>
            <div class="verification-notice">⚠ No verified completions yet</div>
          </div>
          ${lvl.thumbnail ? `<div class="thumb-col"><img class="lazy-thumb" data-src="${lvl.thumbnail}" alt="${lvl.name}" loading="lazy" onerror="tryThumbnailFallback(this, '${lvl.id}')"></div>` : ""}
          <div class="actions-col">
            ${hasVideo
              ? `<a class="btn-video" href="${lvl.showcaseVideoUrl}" target="_blank" rel="noopener">Video ↗</a>`
              : `<span class="btn-video no-link">No video</span>`
            }
          </div>
        </div>
      `;
    })
    .join("");

  container.innerHTML = cards;
  initLazyThumbnails();
}
