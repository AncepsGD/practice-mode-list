let dragSrcIndex = null;
let editingSource = "levels";
let dataReady = false;
let editorHasLocalChanges = false;
let editorLastSavedSnapshot = null;
let editorConflictNoticeShown = false;
let editorBaselineData = null;
let editorEstimatedNames = [];
let editorEstimatedRankRange = null;

function updateEditorTierVisibility() {
  const table = document.getElementById("edit-level-table");
  if (table) {
    table.classList.toggle("verifications-only", editingSource === "verifications");
  }
  const tierFieldGroup = document.getElementById("tier-field-group");
  if (tierFieldGroup) {
    tierFieldGroup.style.display = editingSource === "verifications" ? "block" : "none";
  }
}

function setEditingSource(source) {
  editingSource = source;
  updateEditorTierVisibility();
  syncEditorConflictState();
  renderEditTable();
}

window.setEditingSource = setEditingSource;

function escapeEditorText(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function normalizeEditorItem(item, fallbackRank = null) {
  if (!item || typeof item !== "object") {
    return {
      rank: fallbackRank,
      name: "",
      creators: "",
      id: "",
      length: "",
      tps: "",
      precision: "",
      ratio: "",
      twoPlayer: "",
      showcaseVideo: "",
      image: "",
      victors: [],
    };
  }

  const readString = (...values) => {
    for (const value of values) {
      if (typeof value === "string") {
        const trimmed = value.trim();
        if (trimmed) return trimmed;
      }
    }
    return "";
  };

  const creators = readString(item.creators, item.creator, item.author);
  const id = readString(item.id, item.levelId);
  const name = readString(item.name, item.levelName);
  const showcaseVideo = readString(item.showcaseVideo, item.showcaseVideoUrl, item.video, item.showcase);
  const image = readString(item.image, item.thumbnail, item.thumb, item.levelImage);
  const twoPlayer = item.twoPlayer === true || item.twoPlayer === "2 Player" || item.twoPlayer === "2P" || item.twoPlayer === "true" || item.is2Player === true ? "2 Player" : "";
  const rank = Number.isFinite(Number(item.rank)) ? Number(item.rank) : fallbackRank;
  const rawTps = item.tps ?? item.TPS ?? item.tpsValue;
  const normalizedTps = rawTps === null || rawTps === undefined || (typeof rawTps === "string" && rawTps.trim() === "") || Number(rawTps) === 0 ? "" : String(Number(rawTps));
  const tps = Number.isFinite(Number(normalizedTps)) ? String(Number(normalizedTps)) : "";
  const rawLength = item.length ?? item.levelLength;
  const lengthValue = parseDurationToSeconds(rawLength) ?? Number(rawLength);
  const length = Number.isFinite(lengthValue) && lengthValue > 0 ? formatSecondsAsDuration(lengthValue) : "";
  const rawPrecision = item.precision ?? item.Precision;
  const normalizedPrecision = rawPrecision === null || rawPrecision === undefined || (typeof rawPrecision === "string" && rawPrecision.trim() === "") ? "" : String(Number(rawPrecision));
  const precisionValue = Number(normalizedPrecision);
  const precision = Number.isFinite(precisionValue) && precisionValue > 0 ? String(precisionValue) : "";
  const ratio = typeof item.ratio === "string" ? item.ratio.trim() : "";
  const victors = Array.isArray(item.victors) ? item.victors : [];
  const tier = readString(item.tier, item.tierName);
  const rawRankRange = item.rankRange || item.estimatedRankRange;
  const rankRangeMin = Number(rawRankRange?.min ?? item.estimatedRankMin);
  const rankRangeMax = Number(rawRankRange?.max ?? item.estimatedRankMax);
  const rankRange = Number.isFinite(rankRangeMin) && Number.isFinite(rankRangeMax)
    && rankRangeMin > 0 && rankRangeMax > 0
    ? { min: Math.min(rankRangeMin, rankRangeMax), max: Math.max(rankRangeMin, rankRangeMax) }
    : null;

  return {
    rank,
    name,
    creators,
    id,
    length,
    tps,
    precision,
    ratio,
    twoPlayer,
    showcaseVideo,
    image,
    victors,
    tier,
    rankRange,
  };
}

function validateEditorRankRange(listSize) {
  const minInput = document.getElementById("f-rank-min");
  const maxInput = document.getElementById("f-rank-max");
  const minText = minInput.value.trim();
  const maxText = maxInput.value.trim();
  if (!minText && !maxText) return { range: null, valid: true };
  if (!minText || !maxText) {
    alert("Enter both the minimum and maximum rank, or leave both blank.");
    return { range: null, valid: false };
  }

  let min = Number(minText);
  let max = Number(maxText);
  if (!Number.isFinite(min) || !Number.isFinite(max)) {
    alert("Rank range values must be valid numbers.");
    return { range: null, valid: false };
  }
  if (min < 1 || max < 1) {
    alert("Rank range values cannot be below 1.");
    return { range: null, valid: false };
  }
  if (min > max) {
    alert("The minimum rank cannot be greater than the maximum rank.");
    return { range: null, valid: false };
  }

  if (Number.isFinite(listSize) && listSize > 0 && max > listSize) {
    alert(`The maximum rank exceeds the current list size (${listSize}) and will be clamped.`);
    max = listSize;
    maxInput.value = max;
  }
  if (Number.isFinite(listSize) && listSize > 0 && min > listSize) {
    alert(`The minimum rank exceeds the current list size (${listSize}).`);
    return { range: null, valid: false };
  }

  return { range: { min, max }, valid: true };
}

function renderRankEstimateBasis(level, hasSecretEstimate) {
  const container = document.getElementById("rank-estimate-basis");
  if (!container) return;
  const used = [];
  const missing = [];
  ["tps", "length", "precision"].forEach(field => {
    const label = field === "tps" ? "TPS" : field.charAt(0).toUpperCase() + field.slice(1);
    const value = field === "length" ? parseDurationToSeconds(level[field]) : Number(level[field]);
    if (Number.isFinite(value) && value > 0) used.push(label);
    else missing.push(label);
  });
  const ratioValue = String(level.ratio ?? document.getElementById("f-ratio")?.value ?? "").trim();
  if (ratioValue) used.push("Ratio");
  else missing.push("Ratio");
  if (level.tier) used.push("tier");
  else missing.push("tier");

  const victors = Array.isArray(level.victors) ? level.victors : [];
  const usableVictorEvidence = victors.some(victor => {
    const hasTime = typeof victor.time === "string" && victor.time.trim();
    const hasAttempts = Number(victor.attempts) > 0;
    return String(victor.name || "").trim() && (hasTime || hasAttempts);
  });
  if (usableVictorEvidence) used.push("victor names, times, and attempts");
  else missing.push("victor evidence");
  if (hasSecretEstimate) used.push("estimated difficulty list position");

  container.textContent = `Estimated using ${used.join(", ") || "no matching inputs"}.`
    + (missing.length ? ` Missing: ${missing.join(", ")}.` : "");
  container.classList.add("visible");
}

function estimateRankFromLevel() {
  const level = {
    name: document.getElementById("f-name").value,
    tier: document.getElementById("f-tier").value,
    tps: document.getElementById("f-tps").value,
    length: document.getElementById("f-length").value,
    precision: document.getElementById("f-precision").value,
    ratio: document.getElementById("f-ratio").value,
    is2Player: document.getElementById("f-twoplayer").value === "2 Player",
    victors: Array.from(document.querySelectorAll("#victors-list .victor-entry")).map(entry => ({
      name: entry.querySelector('[data-field="name"]').value,
      time: entry.querySelector('[data-field="time"]').value,
      attempts: entry.querySelector('[data-field="attempts"]').value,
    })),
  };
  const rangeValidation = validateEditorRankRange(Array.isArray(rawData) ? rawData.length : 0);
  if (!rangeValidation.valid) return;
  const enteredMin = rangeValidation.range?.min;
  const enteredMax = rangeValidation.range?.max;
  const hasEnteredRange = Boolean(rangeValidation.range);
  const matchesGeneratedRange = editorEstimatedRankRange
    && enteredMin === editorEstimatedRankRange.min
    && enteredMax === editorEstimatedRankRange.max;
  const preservesManualRange = hasEnteredRange && !matchesGeneratedRange;
  if (preservesManualRange) {
    level.rankRange = {
      min: Math.min(enteredMin, enteredMax),
      max: Math.max(enteredMin, enteredMax),
    };
  }

  const normalizedLevelName = String(level.name || "").trim().toLowerCase();
  const hasSecretEstimate = normalizedLevelName
    && editorEstimatedNames.some(name => String(name || "").trim().toLowerCase() === normalizedLevelName);
  let range = LadderUtils.getEstimatedRankRange(
    level,
    Array.isArray(rawData) ? rawData : [],
    hasSecretEstimate ? editorEstimatedNames : [],
  );
  if (!range && Array.isArray(rawData) && rawData.length) {
    range = LadderUtils.getEstimatedRankRange(level, rawData, []);
  }
  if (range) {
    const { min, max } = range;
    const estimatedRank = range.estimatedRank ?? Math.round((min + max) / 2);
    if (!preservesManualRange) {
      document.getElementById("f-rank-min").value = min;
      document.getElementById("f-rank-max").value = max;
      editorEstimatedRankRange = { min, max };
    }
    document.getElementById("f-rank").value = Math.round(estimatedRank);
    renderRankEstimateBasis(level, hasSecretEstimate);
    return;
  }

  const tier = String(level.tier || "").trim().toLowerCase();
  if (rangeValidation.range) {
    document.getElementById("f-rank").value = Math.round(
      (rangeValidation.range.min + rangeValidation.range.max) / 2,
    );
    renderRankEstimateBasis(level, false);
    return;
  }

  alert(tier ? `No ranked levels found in the ${tier} tier.` : "Select a tier or enter both placement bounds first.");
}

window.estimateRankFromLevel = estimateRankFromLevel;

function getEditorData() {
  return editingSource === "verifications" ? window.verifications : rawData;
}

function getEditorDataSourceName() {
  return editingSource === "verifications" ? "verifications.json" : "levels.json";
}

function getEditorDraftState() {
  const currentData = getEditorData();
  const baseline = editorBaselineData || editorRemoteBaseline;
  const currentSignature = EditorStateUtils.buildDataSignature(currentData || []);
  const baselineSignature = baseline ? baseline.signature : null;
  return {
    currentData,
    currentSignature,
    baselineSignature,
    hasConflict: Boolean(baselineSignature && baselineSignature !== currentSignature),
  };
}

function syncEditorConflictState() {
  const state = getEditorDraftState();
  editorBaselineData = editorRemoteBaseline;
  editorLastSavedSnapshot = editorRemoteBaseline;
  editorHasLocalChanges = Boolean(state.baselineSignature && state.baselineSignature !== state.currentSignature);
  editorConflictNoticeShown = false;
}

function showEditorConflictNotice() {
  if (editorConflictNoticeShown) return;
  editorConflictNoticeShown = true;
  const message = `This editor has unsaved local changes and ${getEditorDataSourceName()} was changed elsewhere. Publishing now may overwrite the newer file.`;
  alert(message);
}

async function checkEditorConflictBeforeExit() {
  const state = getEditorDraftState();
  if (state.hasConflict) {
    showEditorConflictNotice();
    return false;
  }

  const source = editingSource === "verifications" ? "verifications" : "levels";
  const baseline = editorRemoteBaseline || editorBaselineData;
  if (!baseline) return true;

  try {
    const response = await fetchWithTimeout(source === "verifications" ? "verifications.json" : "levels.json");
    const remoteData = await response.json();
    const remoteSignature = EditorStateUtils.buildDataSignature(remoteData || []);
    if (remoteSignature !== baseline.signature) {
      showEditorConflictNotice();
      return false;
    }
  } catch (err) {
    console.warn("Unable to verify editor source freshness", err);
  }

  return true;
}

function persistEditorDraftState() {
  const currentData = getEditorData();
  const snapshot = EditorStateUtils.createEditorSnapshot(currentData || [], editingSource);
  editorLastSavedSnapshot = snapshot;
  editorBaselineData = snapshot;
  localStorage.setItem("pml_editor_draft_state", JSON.stringify(snapshot));
}

function restoreEditorDraftState() {
  const raw = localStorage.getItem("pml_editor_draft_state");
  if (!raw) return;
  try {
    const snapshot = JSON.parse(raw);
    editorLastSavedSnapshot = snapshot;
    editorBaselineData = snapshot;
    return snapshot;
  } catch (err) {
    return null;
  }
}

async function refreshEditorRemoteBaseline() {
  const source = editingSource === "verifications" ? "verifications" : "levels";
  const url = source === "verifications" ? "verifications.json" : "levels.json";

  try {
    const response = await fetchWithTimeout(url);
    const remoteData = await response.json();
    persistEditorRemoteBaseline(remoteData || [], source);
    return remoteData;
  } catch (err) {
    console.warn(`Unable to refresh ${url} baseline`, err);
    return null;
  }
}

function openEditMenu() {
  window.editorSessionActive = true;
  const modal = document.getElementById("edit-modal");
  modal.classList.add("open");
  document.body.style.overflow = "hidden";
  document.getElementById("reset-notice").classList.remove("show");

  showEditView("list");
  loadEditorRemoteBaseline();
  restoreEditorDraftState();
  refreshEditorRemoteBaseline().finally(() => {
    syncEditorConflictState();
  });

  if (!dataReady) {
    setTimeout(renderEditTable, 50);
  } else {
    renderEditTable();
  }
}

async function closeEditMenu() {
  const canClose = await checkEditorConflictBeforeExit();
  if (!canClose) {
    return;
  }
  document.getElementById("edit-modal").classList.remove("open");
  document.body.style.overflow = "";
}

function showEditView(name) {
  document.querySelectorAll(".edit-view").forEach((v) => v.classList.remove("active"));
  document.getElementById("edit-view-" + name).classList.add("active");
}

function renderEditTable() {
  const data = getEditorData();

  const tbody = document.getElementById("edit-table-body");

  if (!data.length) {
    const msg = editingSource === "verifications" ? "No verifications loaded" : "No data loaded";
    tbody.innerHTML =
      `<tr><td colspan="11" class="empty-state" style="padding:24px">${msg}</td></tr>`;
    renderPublishBanner();
    return;
  }

  tbody.innerHTML = data
    .map((item, i) => {
      const normalizedItem = normalizeEditorItem(item, i + 1);
      return `
      <tr draggable="true" data-index="${i}" ondragstart="dragStart(event,${i})" ondragover="dragOver(event,${i})" ondrop="dropRow(event,${i})" ondragleave="dragLeave(event)">
        <td><span class="drag-handle">⠿</span></td>
        <td class="rank-td">${normalizedItem.rank ?? "—"}</td>
        <td class="name-td">${escapeEditorText(normalizedItem.name || "—")}</td>
        <td class="creator-td">${escapeEditorText(normalizedItem.creators || "—")}</td>
        <td class="tier-td">${escapeEditorText(editingSource === "verifications" ? normalizedItem.tier || "—" : "—")}</td>
        <td class="id-td">${escapeEditorText(normalizedItem.id || "—")}</td>
        <td class="length-td">${escapeEditorText(normalizedItem.length || "—")}</td>
        <td class="tps-td">${escapeEditorText(normalizedItem.tps || "—")}</td>
        <td class="precision-td">${escapeEditorText(normalizedItem.precision || "—")}</td>
        <td class="victors-td">${(normalizedItem.victors || []).length}</td>
        <td class="actions-td">
          <button class="ebtn ebtn-ghost ebtn-sm" onclick="openLevelForm(${i})">Edit</button>
          <button class="ebtn ebtn-red ebtn-sm" onclick="deleteLevel(${i})">Delete</button>
        </td>
      </tr>
    `;
    })
    .join("");

  renderPublishBanner();
}

function getUnpublishedChangeState() {
  const data = getEditorData();
  const currentSignature = EditorStateUtils.buildDataSignature(data || []);
  const lastPublished = getLastPublishedSignature();
  return {
    currentSignature,
    lastPublished,
    hasUnpublished: lastPublished !== null && lastPublished !== currentSignature,
  };
}

function ensurePublishBanner() {
  let banner = document.getElementById("publish-status-banner");
  if (banner) return banner;
  const modal = document.getElementById("edit-modal");
  if (!modal) return null;
  banner = document.createElement("div");
  banner.id = "publish-status-banner";
  banner.style.cssText =
    "position:sticky;top:0;z-index:9999;padding:12px 16px;font-weight:700;text-align:center;";
  modal.prepend(banner);
  return banner;
}

function renderPublishBanner() {
  const banner = ensurePublishBanner();
  if (!banner) return;
  const state = getUnpublishedChangeState();
  if (state.hasUnpublished) {
    banner.style.background = "#b91c1c";
    banner.style.color = "#fff";
    banner.textContent =
      "⚠ UNPUBLISHED CHANGES — nothing here is live. Click Export, then paste over the file in your repo and deploy.";
    banner.style.display = "block";
  } else {
    banner.style.background = "#166534";
    banner.style.color = "#fff";
    banner.textContent =
      "No changes since last export. Still confirm the file was actually redeployed — export alone does not publish.";
    banner.style.display = "block";
  }
}
window.renderPublishBanner = renderPublishBanner;

async function init() {
  const data = await loadData();

  try {
    const response = await fetchWithTimeout("secret.txt");
    if (response.ok) {
      editorEstimatedNames = (await response.text())
        .split(/\r?\n/)
        .map(name => name.trim())
        .filter(Boolean);
    }
  } catch (err) {
    console.warn("Unable to load secret.txt for estimated rank ranges", err);
  }

  window.playerCountries = {};
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    const res = await fetch('players_countries.json', { signal: controller.signal });
    if (res && res.ok) {
      try {
        const mapping = await res.json();
        if (mapping && typeof mapping === 'object') window.playerCountries = mapping;
      } catch (e) {
        console.warn('Failed to parse players_countries.json', e);
      }
    }
    clearTimeout(timeout);
  } catch (e) {

  }

  loadEditorRemoteBaseline();
  restoreEditorDraftState();
  refreshEditorRemoteBaseline().finally(() => {
    syncEditorConflictState();
  });
  processRawData(data);
  dataReady = true;
}

init();
window.addEventListener("beforeunload", (e) => {
  persistCurrentEditorData();
  persistEditorDraftState();
  if (window.editorSessionActive && getUnpublishedChangeState().hasUnpublished) {
    e.preventDefault();
    e.returnValue = "";
  }
});

function openEditMenu() {
  window.editorSessionActive = true;
  const modal = document.getElementById("edit-modal");
  modal.classList.add("open");
  document.body.style.overflow = "hidden";
  document.getElementById("reset-notice").classList.remove("show");

  showEditView("list");
  loadEditorRemoteBaseline();
  restoreEditorDraftState();
  refreshEditorRemoteBaseline().finally(() => {
    syncEditorConflictState();
    renderPublishBanner();
  });

  if (!dataReady) {
    setTimeout(renderEditTable, 50);
  } else {
    renderEditTable();
  }
}

async function closeEditMenu() {
  const canClose = await checkEditorConflictBeforeExit();
  if (!canClose) {
    return;
  }

  const publishState = getUnpublishedChangeState();
  if (publishState.hasUnpublished) {
    const leaveAnyway = confirm(
      "You have changes that were never exported and published. Closing now means these edits exist only in this browser and no one else will ever see them unless you export and deploy them.\n\nClose anyway and lose the publish reminder?"
    );
    if (!leaveAnyway) return;
  }

  document.getElementById("edit-modal").classList.remove("open");
  document.body.style.overflow = "";
}

function dragStart(e, index) {
  dragSrcIndex = index;
  e.currentTarget.classList.add("dragging");
  e.dataTransfer.effectAllowed = "move";
}

function dragOver(e, index) {
  e.preventDefault();
  e.dataTransfer.dropEffect = "move";
  document.querySelectorAll("#edit-table-body tr").forEach((r) => r.classList.remove("drag-over"));
  e.currentTarget.classList.add("drag-over");
}

function dragLeave(e) {
  e.currentTarget.classList.remove("drag-over");
}

function dropRow(e, targetIndex) {
  e.preventDefault();
  if (dragSrcIndex === null || dragSrcIndex === targetIndex) return;
  const data = getEditorData();
  const moved = data.splice(dragSrcIndex, 1)[0];
  data.splice(targetIndex, 0, moved);
  if (editingSource !== "verifications") {
    data.forEach((item, i) => {
      item.rank = i + 1;
    });
  }
  document.querySelectorAll("#edit-table-body tr").forEach((r) => {
    r.classList.remove("dragging");
    r.classList.remove("drag-over");
  });
  dragSrcIndex = null;
  persistEditorDraftState();
  saveAndRefresh({ flash: false });
  renderEditTable();
}

function deleteLevel(index) {
  const data = getEditorData();
  if (index < 0 || index >= data.length) {
    alert("Level not found");
    return;
  }
  if (!confirm(`Delete "${data[index].name}"?`)) return;
  data.splice(index, 1);
  if (editingSource !== "verifications") {
    data.forEach((item, i) => {
      item.rank = i + 1;
    });
  }
  persistEditorDraftState();
  saveAndRefresh();
  renderEditTable();
}

function openLevelForm(index) {
  editingIndex = -1;
  editorEstimatedRankRange = null;
  const isNew = index === -1;

  document.getElementById("form-delete-btn").style.display = isNew ? "none" : "";

  const data = getEditorData();
  updateEditorTierVisibility();
  document.getElementById("tier-field-group").style.display = editingSource === "verifications" ? "block" : "none";

  let item;
  if (isNew) {
    document.getElementById("form-title").textContent = "Add Level";
    item = {
      rank: data.length + 1,
      name: "",
      creators: "",
      id: "",
      length: "",
      tps: "",
      precision: "",
      ratio: "",
      twoPlayer: "",
      showcaseVideo: "",
      image: "",
      victors: [],
    };
  } else {
    if (index < 0 || index >= data.length) {
      alert("Level not found");
      return;
    }
    editingIndex = index;
    const existingName = normalizeEditorItem(data[index], data.length + 1).name || "Untitled";
    document.getElementById("form-title").textContent = `Editing: ${existingName}`;
    item = normalizeEditorItem(data[index], data.length + 1);
  }

  const normalizedItem = normalizeEditorItem(item, data.length + 1);

  document.getElementById("f-name").value = normalizedItem.name || "";
  document.getElementById("f-creators").value = normalizedItem.creators || "";
  document.getElementById("f-id").value = normalizedItem.id || "";
  document.getElementById("f-rank").value = normalizedItem.rank || data.length + 1;
  document.getElementById("f-rank-min").value = normalizedItem.rankRange?.min || "";
  document.getElementById("f-rank-max").value = normalizedItem.rankRange?.max || "";
  const estimateBasis = document.getElementById("rank-estimate-basis");
  if (estimateBasis) {
    estimateBasis.textContent = "";
    estimateBasis.classList.remove("visible");
  }
  document.getElementById("f-length").value = normalizedItem.length === "" ? "" : normalizedItem.length;
  document.getElementById("f-tps").value = normalizedItem.tps === 0 || normalizedItem.tps === "0" || normalizedItem.tps == null || normalizedItem.tps === "" ? "" : normalizedItem.tps;
  document.getElementById("f-precision").value = normalizedItem.precision || "";
  document.getElementById("f-ratio").value = normalizedItem.ratio || "";
  document.getElementById("f-twoplayer").value = normalizedItem.twoPlayer || "";
  document.getElementById("f-showcase").value = normalizedItem.showcaseVideo || "";
  document.getElementById("f-image").value = normalizedItem.image || "";
  if (editingSource === "verifications") {
    document.getElementById("f-tier").value = normalizedItem.tier || "";
  } else {
    document.getElementById("f-tier").value = "";
  }

  document.getElementById("victors-list").innerHTML = "";
  (normalizedItem.victors || []).forEach(() => addVictorRow());

  const victorEntries = document.querySelectorAll(".victor-entry");
  (normalizedItem.victors || []).forEach((v, i) => {
    if (!victorEntries[i]) return;
    victorEntries[i].querySelector('[data-field="name"]').value = v.name || "";
    victorEntries[i].querySelector('[data-field="date"]').value = v.date || "";
    victorEntries[i].querySelector('[data-field="time"]').value = v.time || "";
    victorEntries[i].querySelector('[data-field="attempts"]').value = v.attempts || "";
    victorEntries[i].querySelector('[data-field="video"]').value = v.video || "";
  });

  showEditView("form");
}

function addVictorRow() {
  const list = document.getElementById("victors-list");
  const num = list.children.length + 1;
  const div = document.createElement("div");
  div.className = "victor-entry";
  div.innerHTML = `
    <div class="victor-entry-header">
      <span class="victor-entry-num">VICTOR #${num}</span>
      <button class="ebtn ebtn-red ebtn-sm" style="margin-left:auto" onclick="this.closest('.victor-entry').remove(); renumberVictors()">Remove</button>
    </div>
    <div class="victor-entry-grid">
      <div class="form-group">
        <label class="form-label sm">Player Name</label>
        <input class="form-input sm" data-field="name" type="text" placeholder="Name">
      </div>
      <div class="form-group">
        <label class="form-label sm">Date</label>
        <input class="form-input sm" data-field="date" type="text" placeholder="YYYY-MM-DD">
      </div>
      <div class="form-group">
        <label class="form-label sm">Time</label>
        <input class="form-input sm" data-field="time" type="text" placeholder="1h 30m 0s">
      </div>
    </div>
    <div class="victor-entry-grid-2">
      <div class="form-group">
        <label class="form-label sm">Attempts</label>
        <input class="form-input sm" data-field="attempts" type="number" placeholder="0">
      </div>
      <div class="form-group">
        <label class="form-label sm">Video URL</label>
        <input class="form-input sm" data-field="video" type="text" placeholder="https://...">
      </div>
    </div>
  `;
  list.appendChild(div);
}

function renumberVictors() {
  document.querySelectorAll(".victor-entry").forEach((el, i) => {
    const label = el.querySelector(".victor-entry-num");
    if (label) label.textContent = `VICTOR #${i + 1}`;
  });
}

function saveLevelForm() {
  const name = document.getElementById("f-name").value.trim();
  if (!name) {
    alert("Level name is required.");
    return;
  }

  const id = document.getElementById("f-id").value.trim();
  if (!id) {
    alert("Level ID is required.");
    return;
  }

  const data = getEditorData();
  const existingIndex = data.findIndex(l => l.id === id);
  const currentIndex = editingIndex;

  if (existingIndex !== -1 && existingIndex !== currentIndex) {
    console.warn("Duplicate level ID detected while saving; continuing with save.", {
      id,
      existingIndex,
      currentIndex,
    });
    alert("A level with this ID already exists. Saving anyway.");
  }

  const victors = Array.from(document.querySelectorAll(".victor-entry")).map((el) => ({
    name: el.querySelector('[data-field="name"]').value.trim(),
    date: el.querySelector('[data-field="date"]').value.trim(),
    time: el.querySelector('[data-field="time"]').value.trim(),
    attempts: parseInt(el.querySelector('[data-field="attempts"]').value) || 0,
    video: el.querySelector('[data-field="video"]').value.trim(),
  }));

  const tpsInput = document.getElementById("f-tps").value.trim();
  const parsedTps = tpsInput === "" || Number(tpsInput) === 0 ? "" : Number.parseFloat(tpsInput);
  const lengthInput = document.getElementById("f-length").value.trim();
  const parsedLength = parseDurationToSeconds(lengthInput) ?? Number(lengthInput);
  const precisionInput = document.getElementById("f-precision").value.trim();
  const parsedPrecision = precisionInput === "" ? "" : Number.parseFloat(precisionInput);

  const item = {
    rank: parseInt(document.getElementById("f-rank").value) || data.length + 1,
    name,
    creators: document.getElementById("f-creators").value.trim(),
    id,
    length: Number.isFinite(parsedLength) && parsedLength > 0 ? formatSecondsAsDuration(parsedLength) : "",
    tps: Number.isFinite(parsedTps) ? parsedTps : "",
    precision: Number.isFinite(parsedPrecision) && parsedPrecision > 0 ? parsedPrecision : "",
    ratio: document.getElementById("f-ratio").value.trim(),
    twoPlayer: document.getElementById("f-twoplayer").value,
    showcaseVideo: document.getElementById("f-showcase").value.trim(),
    image: document.getElementById("f-image").value.trim(),
    victors,
  };

  if (editingSource === "verifications") {
    item.tier = document.getElementById("f-tier").value;
    const listSize = currentIndex === -1 ? data.length + 1 : data.length;
    const rangeValidation = validateEditorRankRange(listSize);
    if (!rangeValidation.valid) return;
    if (rangeValidation.range) item.rankRange = rangeValidation.range;
  } else if (currentIndex !== -1) {
    item.tier = data[currentIndex].tier;
  }

  if (editingSource !== "verifications") {
    const requestedRank = Math.max(1, item.rank);
    if (currentIndex !== -1) {
      data.splice(currentIndex, 1);
    }
    data.sort((a, b) => (a.rank || 999) - (b.rank || 999));
    data.splice(Math.min(requestedRank - 1, data.length), 0, item);
    data.forEach((d, i) => {
      d.rank = i + 1;
    });
  } else {
    if (currentIndex === -1) {
      data.push(item);
    } else {
      data[currentIndex] = item;
    }
    data.sort((a, b) => (a.rank || 999) - (b.rank || 999));
  }

  persistEditorDraftState();
  saveAndRefresh();
  showEditView("list");
  renderEditTable();
}

function deleteCurrentLevel() {
  if (editingIndex === -1) return;
  const data = getEditorData();
  if (editingIndex < 0 || editingIndex >= data.length) {
    alert("Level not found.");
    return;
  }
  if (!confirm(`Delete "${data[editingIndex].name}"?`)) return;
  data.splice(editingIndex, 1);
  if (editingSource !== "verifications") {
    data.forEach((item, i) => {
      item.rank = i + 1;
    });
  }
  persistEditorDraftState();
  saveAndRefresh();
  showEditView("list");
  renderEditTable();
}