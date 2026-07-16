let dragSrcIndex = null;
let editingSource = "levels";
let dataReady = false;
let editorHasLocalChanges = false;
let editorLastSavedSnapshot = null;
let editorConflictNoticeShown = false;
let editorBaselineData = null;

function setEditingSource(source) {
  editingSource = source;
  syncEditorConflictState();
  renderEditTable();
}

window.setEditingSource = setEditingSource;

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
      `<tr><td colspan="9" class="empty-state" style="padding:24px">${msg}</td></tr>`;
    return;
  }

  tbody.innerHTML = data
    .map(
      (item, i) => `
      <tr draggable="true" data-index="${i}" ondragstart="dragStart(event,${i})" ondragover="dragOver(event,${i})" ondrop="dropRow(event,${i})" ondragleave="dragLeave(event)">
        <td><span class="drag-handle">⠿</span></td>
        <td class="rank-td">${item.rank || "—"}</td>
        <td class="name-td">${item.name || "—"}</td>
        <td class="creator-td">${item.creators || "—"}</td>
        <td class="id-td">${item.id || "—"}</td>
        <td class="victors-td">${(item.victors || []).length}</td>
        <td class="actions-td">
          <button class="ebtn ebtn-ghost ebtn-sm" onclick="openLevelForm(${i})">Edit</button>
          <button class="ebtn ebtn-red ebtn-sm" onclick="deleteLevel(${i})">Delete</button>
        </td>
      </tr>
    `
    )
    .join("");
}
async function init() {
  const data = await loadData();

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
window.addEventListener("beforeunload", () => {
  persistCurrentEditorData();
  persistEditorDraftState();
});

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
  data.forEach((item, i) => {
    item.rank = i + 1;
  });
  document.querySelectorAll("#edit-table-body tr").forEach((r) => {
    r.classList.remove("dragging");
    r.classList.remove("drag-over");
  });
  dragSrcIndex = null;
  persistEditorDraftState();
  saveAndRefresh({ flash: false, skipRender: true });
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
  data.forEach((item, i) => {
    item.rank = i + 1;
  });
  persistEditorDraftState();
  saveAndRefresh();
  renderEditTable();
}

function openLevelForm(index) {
  editingIndex = -1;
  const isNew = index === -1;

  document.getElementById("form-delete-btn").style.display = isNew ? "none" : "";

  const data = getEditorData();

  let item;
  if (isNew) {
    document.getElementById("form-title").textContent = "Add Level";
    item = {
      rank: data.length + 1,
      name: "",
      creators: "",
      id: "",
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
    document.getElementById("form-title").textContent = `Editing: ${data[index].name}`;
    item = data[index];
  }

  document.getElementById("f-name").value = item.name || "";
  document.getElementById("f-creators").value = item.creators || "";
  document.getElementById("f-id").value = item.id || "";
  document.getElementById("f-rank").value = item.rank || data.length + 1;
  document.getElementById("f-twoplayer").value = item.twoPlayer || "";
  document.getElementById("f-showcase").value = item.showcaseVideo || "";
  document.getElementById("f-image").value = item.image || "";

  document.getElementById("victors-list").innerHTML = "";
  (item.victors || []).forEach(() => addVictorRow());

  const victorEntries = document.querySelectorAll(".victor-entry");
  (item.victors || []).forEach((v, i) => {
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
    alert("A level with this ID already exists.");
    return;
  }

  const victors = Array.from(document.querySelectorAll(".victor-entry")).map((el) => ({
    name: el.querySelector('[data-field="name"]').value.trim(),
    date: el.querySelector('[data-field="date"]').value.trim(),
    time: el.querySelector('[data-field="time"]').value.trim(),
    attempts: parseInt(el.querySelector('[data-field="attempts"]').value) || 0,
    video: el.querySelector('[data-field="video"]').value.trim(),
  }));

  const item = {
    rank: parseInt(document.getElementById("f-rank").value) || data.length + 1,
    name,
    creators: document.getElementById("f-creators").value.trim(),
    id,
    twoPlayer: document.getElementById("f-twoplayer").value,
    showcaseVideo: document.getElementById("f-showcase").value.trim(),
    image: document.getElementById("f-image").value.trim(),
    victors,
  };

  if (currentIndex === -1) {
    data.push(item);
  } else {
    data[currentIndex] = item;
  }

  data.sort((a, b) => (a.rank || 999) - (b.rank || 999));
  data.forEach((d, i) => {
    d.rank = i + 1;
  });

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
  data.forEach((item, i) => {
    item.rank = i + 1;
  });
  persistEditorDraftState();
  saveAndRefresh();
  showEditView("list");
  renderEditTable();
}