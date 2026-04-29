let dragSrcIndex = null;
let editingSource = "levels";
let rawVerifications = [];
let dataReady = false;

loadData().then(() => {
  processRawData();
  dataReady = true;
});

function setEditingSource(source) {
  editingSource = source;

  if (source === "verifications") renderVerificationTable();
  else renderEditTable();
}

window.setEditingSource = setEditingSource;

function openEditMenu() {
  const modal = document.getElementById("edit-modal");
  modal.classList.add("open");
  document.body.style.overflow = "hidden";
  document.getElementById("reset-notice").classList.remove("show");

  showEditView("list");

  if (!dataReady) {
    setTimeout(renderEditTable, 50);
  } else {
    renderEditTable();
  }
}

function closeEditMenu() {
  document.getElementById("edit-modal").classList.remove("open");
  document.body.style.overflow = "";
}

function showEditView(name) {
  document.querySelectorAll(".edit-view").forEach((v) => v.classList.remove("active"));
  document.getElementById("edit-view-" + name).classList.add("active");
}

function renderEditTable() {
  if (editingSource === "verifications") {
    renderVerificationTable();
    return;
  }

  const tbody = document.getElementById("edit-table-body");

  if (!rawData.length) {
    tbody.innerHTML =
      '<tr><td colspan="9" class="empty-state" style="padding:24px">No data loaded</td></tr>';
    return;
  }

  tbody.innerHTML = rawData
    .map(
      (item, i) => `
      <tr draggable="true" data-index="${i}" ondragstart="dragStart(event,${i})" ondragover="dragOver(event,${i})" ondrop="dropRow(event,${i})" ondragleave="dragLeave(event)">
        <td><span class="drag-handle">⠿</span></td>
        <td class="rank-td">${item.rank || "—"}</td>
        <td class="name-td">${item.name || "—"}</td>
        <td class="creator-td">${item.creators || "—"}</td>
        <td class="id-td">${item.id || "—"}</td>
        <td class="stat-cell">${Math.max(0, Number(item.framePerfects) || 0)}</td>
        <td class="stat-cell">${Math.max(1, Number(item.lengthSeconds) || 60)}</td>
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

function renderVerificationTable() {
  const tbody = document.getElementById("edit-table-body");

  if (!rawVerifications.length) {
    tbody.innerHTML =
      '<tr><td colspan="7" class="empty-state" style="padding:24px">No verifications loaded</td></tr>';
    return;
  }

  tbody.innerHTML = rawVerifications
    .map(
      (v, i) => `
      <tr data-index="${i}">
        <td></td>
        <td>${v.levelName || "—"}</td>
        <td>${v.player || "—"}</td>
        <td>${v.date || "—"}</td>
        <td>${v.status || "pending"}</td>
        <td>${v.verifier || "—"}</td>
        <td class="actions-td">
          <button class="ebtn ebtn-ghost ebtn-sm" onclick="openVerificationForm(${i})">Edit</button>
          <button class="ebtn ebtn-red ebtn-sm" onclick="deleteVerification(${i})">Delete</button>
        </td>
      </tr>
    `
    )
    .join("");
}

function openVerificationForm(index) {
  editingIndex = index;

  const isNew = index === -1;

  const item = isNew
    ? {
      levelName: "",
      player: "",
      date: "",
      status: "pending",
      verifier: ""
    }
    : rawVerifications[index];

  showEditView("form");

  document.getElementById("form-title").textContent = isNew
    ? "Add Verification"
    : `Editing: ${item.levelName}`;

  document.getElementById("v-level").value = item.levelName || "";
  document.getElementById("v-player").value = item.player || "";
  document.getElementById("v-date").value = item.date || "";
  document.getElementById("v-status").value = item.status || "pending";
  document.getElementById("v-verifier").value = item.verifier || "";
}

function saveVerificationForm() {
  const item = {
    levelName: document.getElementById("v-level").value.trim(),
    player: document.getElementById("v-player").value.trim(),
    date: document.getElementById("v-date").value.trim(),
    status: document.getElementById("v-status").value,
    verifier: document.getElementById("v-verifier").value.trim()
  };

  if (!item.levelName) return;

  if (editingIndex === -1) rawVerifications.push(item);
  else rawVerifications[editingIndex] = item;

  saveAndRefresh();
  showEditView("list");
  renderVerificationTable();
}

function deleteVerification(index) {
  if (!confirm("Delete this verification?")) return;
  rawVerifications.splice(index, 1);
  saveAndRefresh();
  renderVerificationTable();
}

async function loadVerificationsFromStorage() {

  const saved = localStorage.getItem("pml_verifications_data");
  if (saved) {
    try {
      rawVerifications = JSON.parse(saved);
      console.log("Loaded verifications from storage:", rawVerifications.length);
      return;
    } catch (e) { }
  }
  rawVerifications = [];
}

async function init() {
  await loadData();
  processRawData();
  await loadVerificationsFromStorage();
}

init();
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
  const moved = rawData.splice(dragSrcIndex, 1)[0];
  rawData.splice(targetIndex, 0, moved);
  rawData.forEach((item, i) => {
    item.rank = i + 1;
  });
  document.querySelectorAll("#edit-table-body tr").forEach((r) => {
    r.classList.remove("dragging");
    r.classList.remove("drag-over");
  });
  dragSrcIndex = null;
  renderEditTable();
}

function deleteLevel(index) {
  if (!confirm(`Delete "${rawData[index].name}"?`)) return;
  rawData.splice(index, 1);
  rawData.forEach((item, i) => {
    item.rank = i + 1;
  });
  saveAndRefresh();
  renderEditTable();
}

function openLevelForm(index) {
  editingIndex = index;
  const isNew = index === -1;
  document.getElementById("form-title").textContent = isNew
    ? "Add Level"
    : `Editing: ${rawData[index].name}`;
  document.getElementById("form-delete-btn").style.display = isNew ? "none" : "";

  const item = isNew
    ? {
      rank: rawData.length + 1,
      name: "",
      creators: "",
      id: "",
      framePerfects: 0,
      lengthSeconds: 60,
      twoPlayer: "",
      showcaseVideo: "",
      image: "",
      victors: [],
    }
    : rawData[index];

  document.getElementById("f-name").value = item.name || "";
  document.getElementById("f-creators").value = item.creators || "";
  document.getElementById("f-id").value = item.id || "";
  document.getElementById("f-rank").value = item.rank || rawData.length + 1;
  document.getElementById("f-frameperfects").value = Math.max(0, Number(item.framePerfects) || 0);
  document.getElementById("f-lengthseconds").value = Math.max(1, Number(item.lengthSeconds) || 60);
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

  const victors = Array.from(document.querySelectorAll(".victor-entry")).map((el) => ({
    name: el.querySelector('[data-field="name"]').value.trim(),
    date: el.querySelector('[data-field="date"]').value.trim(),
    time: el.querySelector('[data-field="time"]').value.trim(),
    attempts: parseInt(el.querySelector('[data-field="attempts"]').value) || 0,
    video: el.querySelector('[data-field="video"]').value.trim(),
  }));

  const item = {
    rank: parseInt(document.getElementById("f-rank").value) || rawData.length + 1,
    name,
    creators: document.getElementById("f-creators").value.trim(),
    id: document.getElementById("f-id").value.trim(),
    framePerfects: Math.max(0, parseInt(document.getElementById("f-frameperfects").value) || 0),
    lengthSeconds: Math.max(1, parseInt(document.getElementById("f-lengthseconds").value) || 60),
    twoPlayer: document.getElementById("f-twoplayer").value,
    showcaseVideo: document.getElementById("f-showcase").value.trim(),
    image: document.getElementById("f-image").value.trim(),
    victors,
  };

  if (editingIndex === -1) {
    rawData.push(item);
  } else {
    rawData[editingIndex] = item;
  }

  rawData.sort((a, b) => (a.rank || 999) - (b.rank || 999));
  rawData.forEach((d, i) => {
    d.rank = i + 1;
  });

  saveAndRefresh();
  showEditView("list");
  renderEditTable();
}

function deleteCurrentLevel() {
  if (editingIndex === -1) return;
  if (!confirm(`Delete "${rawData[editingIndex].name}"?`)) return;
  rawData.splice(editingIndex, 1);
  rawData.forEach((item, i) => {
    item.rank = i + 1;
  });
  saveAndRefresh();
  showEditView("list");
  renderEditTable();
}

loadData().then(processRawData);
