(function (global) {
  function sortObject(value) {
    if (Array.isArray(value)) return value.map(sortObject);
    if (value && typeof value === "object") {
      return Object.keys(value)
        .sort()
        .reduce((acc, key) => {
          acc[key] = sortObject(value[key]);
          return acc;
        }, {});
    }
    return value;
  }

  function stableSerialize(value) {
    return JSON.stringify(sortObject(value));
  }

  function simpleHash(input) {
    let hash = 0;
    for (let i = 0; i < input.length; i += 1) {
      hash = (hash << 5) - hash + input.charCodeAt(i);
      hash |= 0;
    }
    return String(hash >>> 0);
  }

  function buildDataSignature(data) {
    return simpleHash(stableSerialize(data || []));
  }

  function createEditorSnapshot(data, source) {
    return {
      source: source || "levels",
      signature: buildDataSignature(data),
      updatedAt: Date.now(),
    };
  }

  function hasEditorSourceChanged(currentData, lastSnapshot, remoteData) {
    if (!lastSnapshot) return false;
    if (!Array.isArray(currentData) || !Array.isArray(remoteData)) {
      return buildDataSignature(remoteData) !== lastSnapshot.signature;
    }
    return buildDataSignature(remoteData) !== lastSnapshot.signature;
  }

  function getEditorSourceLabel(source) {
    return source === "verifications" ? "verifications.json" : "levels.json";
  }

  global.EditorStateUtils = {
    buildDataSignature,
    createEditorSnapshot,
    hasEditorSourceChanged,
    getEditorSourceLabel,
  };
})(typeof window !== "undefined" ? window : globalThis);
