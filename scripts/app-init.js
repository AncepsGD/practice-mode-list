let dataReady = false;

async function initializeMainData() {
  const data = await loadData();
  processRawData(data);
  dataReady = true;
  if (typeof loadPlayerCountries === "function") {
    loadPlayerCountries();
  }
  if (window.editorSessionActive) renderEditTable();
}

initializeMainData();
