const fs = require("node:fs");
const path = require("node:path");

const PACK_LEVELS = {
  "V2 Pack": [
    "haunted corridor v2",
    "Calamity Fortune V2",
    "Silent Skrillex v2",
    "sakupen circles v2",
    "Necropolis v2",
  ],
  "1Cicl3 Pack": [
    "Shadows Torture",
    "silent landscape",
    "haunted corridor v2",
    "ultra silent circles",
    "Silent Acropolis",
  ],
  "Legend Pack II": [
    "RMGD Legend II",
    "RMGD Legend",
    "ICE Legend",
    "Zap legend",
    "Chaotic Legend",
  ],
  "2019 Pack": [
    "Golden True (ILL)",
    "Monodia",
    "Empyrean is dead",
  ],
  "2017 Pack": [
    "Disquietude",
    "Omega Circles II",
    "kataTARTARUS",
    "Deadly Silent Ego",
    "Omega Circles",
  ],
  "SLL Nine Circles Pack": [
    "Zobros Worst Fear",
    "Rampant Circles (Unnerfed)",
    "The Last Hour",
  ],
  "ILL Top 1 Pack II": [
    "Realm Of Bloodshadow (Unnerfed)",
    "Formosa",
    "MINUSclub",
    "Silent Circles",
    "Singularity",
  ],
  "Fast Pack": [
    "Eddies Castle",
    "Rub the Wrong Way",
    "Anima Immortalis",
    "PARALLEL UNIVERSE (Old)",
    "Angelicide (Unnerfed)",
  ],
  "AngelEffect Pack": [
    "World Render",
    "Rikkachet Love",
    "Calamity Fortune V2",
    "Shatter Synapse",
    "Morisummer Lane",
  ],
  "One Player Dual Pack": [
    "i n j u r y (Old)",
    "Asterios (Unnerfed)",
    "T E M P L E",
    "01ILLg21 Night",
    "Nodependence",
  ],
};

const dataFiles = ["levels.json", "verifications.json"].map((fileName) => {
  const filePath = path.join(__dirname, "..", "data", fileName);
  const records = JSON.parse(fs.readFileSync(filePath, "utf8"));
  if (!Array.isArray(records)) {
    throw new Error(`Expected ${fileName} to contain an array of level records.`);
  }

  const recordsByName = new Map();
  for (const record of records) {
    if (typeof record.name !== "string") continue;
    const matches = recordsByName.get(record.name) || [];
    matches.push(record);
    recordsByName.set(record.name, matches);
  }
  return { fileName, filePath, records, recordsByName, changed: false };
});

const assignments = [];
for (const [packName, levelNames] of Object.entries(PACK_LEVELS)) {
  for (const levelName of levelNames) {
    const matches = dataFiles.flatMap((file) => {
      const records = file.recordsByName.get(levelName) || [];
      if (records.length > 1) {
        throw new Error(
          `Expected at most one "${levelName}" record in ${file.fileName}, found ${records.length}.`
        );
      }
      return records.map((record) => ({ file, record }));
    });
    if (matches.length === 0) {
      throw new Error(`Could not find a level named "${levelName}" in either data file.`);
    }
    assignments.push({ levelName, packName, matches });
  }
}

let additions = 0;
for (const { levelName, packName, matches } of assignments) {
  for (const { file, record } of matches) {
    if (record.packs === undefined) record.packs = [];
    if (!Array.isArray(record.packs)) {
      throw new Error(`Expected "${levelName}" in ${file.fileName} to have a packs array.`);
    }
    if (!record.packs.includes(packName)) {
      record.packs.push(packName);
      file.changed = true;
      additions += 1;
    }
  }
}

for (const file of dataFiles) {
  if (file.changed) {
    fs.writeFileSync(file.filePath, `${JSON.stringify(file.records, null, 2)}\n`);
  }
}

console.log(`Applied ${additions} pack assignment(s) across the level data files.`);
