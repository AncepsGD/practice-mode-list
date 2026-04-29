let dragSrcIndex = null;
let editingSource = "levels";

function openEditMenu() {
  const modal = document.getElementById("edit-modal");
  modal.classList.add("open");
  document.body.style.overflow = "hidden";
  document.getElementById("reset-notice").classList.remove("show");
  showEditView("list");
  renderEditTable();
}

function closeEditMenu() {
  document.getElementById("edit-modal").classList.remove("open");
  document.body.style.overflow = "";
}

function getCurrentEditData() {
  return editingSource === "verifications" ? verifications : rawData;
}

function setEditingSource(source) {
  editingSource = source;
  renderEditTable();
}

function showEditView(name) {
  document.querySelectorAll(".edit-view").forEach((v) => v.classList.remove("active"));
  document.getElementById("edit-view-" + name).classList.add("active");
}

function renderEditTable() {
  const tbody = document.getElementById("edit-table-body");
  const currentData = getCurrentEditData();
  if (!currentData.length) {
    tbody.innerHTML =
      '<tr><td colspan="9" class="empty-state" style="padding:24px">No data loaded</td></tr>';
    return;
  }
  tbody.innerHTML = currentData
    .map(
      (item, i) => `
      <tr draggable="true" data-index="${i}" ondragstart="dragStart(event,${i})" ondragover="dragOver(event,${i})" ondrop="dropRow(event,${i})" ondragleave="dragLeave(event)">
        <td><span class="drag-handle" title="Drag to reorder">⠿</span></td>
        <td class="rank-td">${item.rank || "—"}</td>
        <td class="name-td">${item.name || "—"}</td>
        <td class="creator-td">${item.creators || "—"}</td>
        <td class="id-td">${item.id || "—"}</td>
        <td class="stat-cell">${Math.max(0, Number(item.framePerfects) || 0)}</td>
        <td class="stat-cell">${Math.max(1, Number(item.lengthSeconds) || 60)}</td>
        <td class="victors-td">${(item.victors || []).length} victor${(item.victors || []).length !== 1 ? "s" : ""}</td>
        <td class="actions-td">
          <button class="ebtn ebtn-ghost ebtn-sm" onclick="openLevelForm(${i})">Edit</button>
          <button class="ebtn ebtn-red ebtn-sm" onclick="deleteLevel(${i})">Delete</button>
        </td>
      </tr>
    `,
    )
    .join("");
}

const tableBody = document.getElementById("edit-table-body");

function dragStart(e, index) {
  dragSrcIndex = index;
  e.currentTarget.classList.add("dragging");
  e.dataTransfer.effectAllowed = "move";
}

function dragOver(e, index) {
  e.preventDefault();

  const rows = tableBody.querySelectorAll("tr");
  for (let i = 0; i < rows.length; i++) {
    rows[i].classList.remove("drag-over");
  }

  e.currentTarget.classList.add("drag-over");
  e.dataTransfer.dropEffect = "move";
}

function dragLeave(e) {
  e.currentTarget.classList.remove("drag-over");
}

function dropRow(e, targetIndex) {
  e.preventDefault();

  if (dragSrcIndex === null || dragSrcIndex === targetIndex) return;

  const data = getCurrentEditData();

  const moved = data.splice(dragSrcIndex, 1)[0];
  data.splice(targetIndex, 0, moved);

  for (let i = 0; i < data.length; i++) {
    data[i].rank = i + 1;
  }

  const rows = tableBody.querySelectorAll("tr");

  for (let i = 0; i < rows.length; i++) {
    rows[i].classList.remove("dragging", "drag-over");
  }

  dragSrcIndex = null;

  saveAndRefresh();
  renderEditTable();
}

function deleteLevel(index) {
  const currentData = getCurrentEditData();
  if (!confirm(`Delete "${currentData[index].name}"?`)) return;
  currentData.splice(index, 1);
  currentData.forEach((item, i) => {
    item.rank = i + 1;
  });
  saveAndRefresh();
  renderEditTable();
}

function openLevelForm(index) {
  editingIndex = index;
  const isNew = index === -1;
  const currentData = getCurrentEditData();
  document.getElementById("form-title").textContent = isNew
    ? "Add Level"
    : `Editing: ${currentData[index].name}`;
  document.getElementById("form-delete-btn").style.display = isNew ? "none" : "";

  const item = isNew
    ? {
        rank: currentData.length + 1,
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
    : currentData[index];

  document.getElementById("f-name").value = item.name || "";
  document.getElementById("f-creators").value = item.creators || "";
  document.getElementById("f-id").value = item.id || "";
  document.getElementById("f-rank").value = item.rank || currentData.length + 1;
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

const list = document.getElementById("victors-list");

function addVictorRow() {
  const num = list.children.length + 1;

  const div = document.createElement("div");
  div.className = "victor-entry";

  const html = `
    <div class="victor-entry-header">
      <span class="victor-entry-num">VICTOR #${num}</span>
      <button class="ebtn ebtn-red ebtn-sm remove-victor" style="margin-left:auto">Remove</button>
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

  div.innerHTML = html;
  list.appendChild(div);
}

list.addEventListener("click", (e) => {
  const btn = e.target.closest(".remove-victor");
  if (!btn) return;

  const entry = btn.closest(".victor-entry");
  if (!entry) return;

  entry.remove();
  renumberVictors();
});

function renumberVictors() {
  const entries = list.children;

  for (let i = 0; i < entries.length; i++) {
    const label = entries[i].querySelector(".victor-entry-num");
    if (label) label.textContent = `VICTOR #${i + 1}`;
  }
}

function saveLevelForm() {
  const get = (id) => document.getElementById(id);

  const nameInput = get("f-name");
  const name = nameInput.value.trim();
  if (!name) {
    alert("Level name is required.");
    return;
  }

  const rankInput = get("f-rank");
  const creatorsInput = get("f-creators");
  const idInput = get("f-id");
  const fpInput = get("f-frameperfects");
  const lengthInput = get("f-lengthseconds");
  const twoPlayerInput = get("f-twoplayer");
  const showcaseInput = get("f-showcase");
  const imageInput = get("f-image");

  const victorNodes = document.querySelectorAll(".victor-entry");
  const victors = new Array(victorNodes.length);

  for (let i = 0; i < victorNodes.length; i++) {
    const el = victorNodes[i];
    const fields = el.querySelectorAll("[data-field]");

    let name = "", date = "", time = "", attempts = 0, video = "";

    for (let j = 0; j < fields.length; j++) {
      const f = fields[j];
      const val = f.value.trim();
      switch (f.dataset.field) {
        case "name": name = val; break;
        case "date": date = val; break;
        case "time": time = val; break;
        case "attempts": attempts = parseInt(val) || 0; break;
        case "video": video = val; break;
      }
    }

    victors[i] = { name, date, time, attempts, video };
  }

  const currentData = getCurrentEditData();

  const item = {
    rank: parseInt(rankInput.value) || currentData.length + 1,
    name,
    creators: creatorsInput.value.trim(),
    id: idInput.value.trim(),
    framePerfects: Math.max(0, parseInt(fpInput.value) || 0),
    lengthSeconds: Math.max(1, parseInt(lengthInput.value) || 60),
    twoPlayer: twoPlayerInput.value,
    showcaseVideo: showcaseInput.value.trim(),
    image: imageInput.value.trim(),
    victors
  };

  if (editingIndex === -1) {
    currentData.push(item);
  } else {
    currentData[editingIndex] = item;
  }

  let needsSort = false;
  for (let i = 1; i < currentData.length; i++) {
    if ((currentData[i - 1].rank || 999) > (currentData[i].rank || 999)) {
      needsSort = true;
      break;
    }
  }

  if (needsSort) {
    currentData.sort((a, b) => (a.rank || 999) - (b.rank || 999));
  }

  for (let i = 0; i < currentData.length; i++) {
    currentData[i].rank = i + 1;
  }

  saveAndRefresh();
  showEditView("list");
  renderEditTable();
}

const modal = document.getElementById("edit-modal");

function deleteCurrentLevel() {
  if (editingIndex === -1) return;

  const currentData = getCurrentEditData();
  const item = currentData[editingIndex];

  if (!confirm(`Delete "${item.name}"?`)) return;

  currentData.splice(editingIndex, 1);

  for (let i = 0; i < currentData.length; i++) {
    currentData[i].rank = i + 1;
  }

  saveAndRefresh();
  showEditView("list");
  renderEditTable();
}

document.addEventListener("keydown", (e) => {
  const isOpen = modal.classList.contains("open");

  if (e.shiftKey && e.key === "M") {
    isOpen ? closeEditMenu() : openEditMenu();
    return;
  }

  if (e.key === "Escape" && isOpen) {
    closeEditMenu();
  }
});

loadData().then(processRawData);
