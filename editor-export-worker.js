self.onmessage = (event) => {
  try {
    const { data, sourceData } = event.data;
    const json = JSON.stringify(data, null, 2);
    const sourceSignature = simpleHash(JSON.stringify(sortObject(sourceData || [])));
    self.postMessage({ json, sourceSignature });
  } catch (error) {
    self.postMessage({
      error: error instanceof Error ? error.message : String(error),
    });
  }
};

function sortObject(value) {
  if (Array.isArray(value)) return value.map(sortObject);
  if (value && typeof value === "object") {
    return Object.keys(value)
      .sort()
      .reduce((result, key) => {
        result[key] = sortObject(value[key]);
        return result;
      }, {});
  }
  return value;
}

function simpleHash(input) {
  let hash = 0;
  for (let index = 0; index < input.length; index += 1) {
    hash = (hash << 5) - hash + input.charCodeAt(index);
    hash |= 0;
  }
  return String(hash >>> 0);
}
