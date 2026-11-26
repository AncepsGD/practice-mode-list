const VariantUtils = (() => {
  const FIRST_VARIANT_MULTIPLIER = 0.5;
  const VARIANT_DECAY_MULTIPLIER = 0.5;

  function normalizeName(value) {
    return String(value ?? "").trim().replace(/\s+/g, " ").toLowerCase();
  }

  function getCompletionTimestamp(completion) {
    const timestamp = Date.parse(String(completion?.date || ""));
    return Number.isFinite(timestamp) ? timestamp : null;
  }

  function compareCompletionDates(left, right) {
    const validLeft = left.timestamp !== null;
    const validRight = right.timestamp !== null;
    if (validLeft && validRight && left.timestamp !== right.timestamp) {
      return left.timestamp - right.timestamp;
    }
    if (validLeft !== validRight) return validLeft ? -1 : 1;
    return left.index - right.index;
  }

  function getVariantRelations(levels) {
    const items = Array.isArray(levels) ? levels : [];
    const levelByName = new Map();
    const indexByLevel = new Map();
    items.forEach((level, index) => {
      const key = normalizeName(level?.name);
      if (key && !levelByName.has(key)) levelByName.set(key, level);
      indexByLevel.set(level, index);
    });

    const parentByVariant = new Map();
    items.forEach((level) => {
      const parentName = normalizeName(level?.variantOf);
      const parent = levelByName.get(parentName);
      if (parentName && parent && parent !== level && !normalizeName(parent.variantOf)) {
        parentByVariant.set(level, parent);
      }
    });

    const levelsById = new Map();
    items.forEach((level) => {
      const id = String(level?.id || "").trim();
      if (!id) return;
      if (!levelsById.has(id)) levelsById.set(id, []);
      levelsById.get(id).push(level);
    });

    levelsById.forEach((entries) => {
      if (entries.length < 2) return;
      const root = entries
        .map((level) => parentByVariant.get(level))
        .find(parent => parent && entries.includes(parent))
        || entries.find(level => !parentByVariant.has(level))
        || entries[0];
      entries.forEach((level) => {
        if (level !== root && !parentByVariant.has(level)) {
          parentByVariant.set(level, root);
        }
      });
    });

    const variantsByParent = new Map();
    parentByVariant.forEach((parent, variant) => {
      if (!variantsByParent.has(parent)) variantsByParent.set(parent, []);
      variantsByParent.get(parent).push(variant);
    });
    variantsByParent.forEach((variants) => {
      variants.sort((a, b) => {
        const rankA = Number(a.rank);
        const rankB = Number(b.rank);
        const normalizedA = Number.isFinite(rankA) && rankA > 0 ? rankA : Number.POSITIVE_INFINITY;
        const normalizedB = Number.isFinite(rankB) && rankB > 0 ? rankB : Number.POSITIVE_INFINITY;
        return normalizedA - normalizedB || indexByLevel.get(a) - indexByLevel.get(b);
      });
    });

    return { items, levelByName, indexByLevel, parentByVariant, variantsByParent };
  }

  function assignRanklessRanks(levels, relations = getVariantRelations(levels)) {
    const rankedLevels = relations.items
      .filter(level => !relations.parentByVariant.has(level))
      .sort((a, b) => {
        const rankA = Number(a.rank);
        const rankB = Number(b.rank);
        const normalizedA = Number.isFinite(rankA) && rankA > 0 ? rankA : Number.POSITIVE_INFINITY;
        const normalizedB = Number.isFinite(rankB) && rankB > 0 ? rankB : Number.POSITIVE_INFINITY;
        return normalizedA - normalizedB || relations.indexByLevel.get(a) - relations.indexByLevel.get(b);
      });

    rankedLevels.forEach((level, index) => {
      level.displayRank = index + 1;
      level.sortRank = index + 1;
      level.isVariant = false;
      level.variantParentName = "";
    });
    relations.parentByVariant.forEach((parent, variant) => {
      variant.displayRank = null;
      variant.sortRank = parent.displayRank;
      variant.isVariant = true;
      variant.variantParentName = String(parent.name || "").trim();
    });

    return { ...relations, rankedLevels };
  }

  function getVariantMultiplier(ordinal) {
    const index = Math.max(0, Math.floor(Number(ordinal) || 0));
    return FIRST_VARIANT_MULTIPLIER * (VARIANT_DECAY_MULTIPLIER ** index);
  }

  function getRepeatMultiplier(ordinal) {
    const index = Math.max(0, Math.floor(Number(ordinal) || 0));
    return index === 0 ? 1 : getVariantMultiplier(index - 1);
  }

  function getPlayerRepeatMultipliers(completionDetails) {
    const completionsByLevel = new Map();
    const multipliersByCompletion = new Map();
    (Array.isArray(completionDetails) ? completionDetails : []).forEach((completion, index) => {
      const key = normalizeName(completion?.name);
      if (!key) return;
      if (!completionsByLevel.has(key)) completionsByLevel.set(key, []);
      completionsByLevel.get(key).push({
        completion,
        index,
        timestamp: getCompletionTimestamp(completion),
      });
    });

    completionsByLevel.forEach((completions) => {
      completions.sort(compareCompletionDates);
      completions.forEach(({ completion }, index) => {
        multipliersByCompletion.set(completion, getRepeatMultiplier(index));
      });
    });
    return multipliersByCompletion;
  }

  function getNextRepeatMultiplier(player, level) {
    const key = normalizeName(typeof level === "string" ? level : level?.name);
    if (!key) return 1;
    const detailCount = (Array.isArray(player?.completionDetails) ? player.completionDetails : [])
      .filter(completion => normalizeName(completion?.name) === key)
      .length;
    const levelCount = (Array.isArray(player?.levels) ? player.levels : [])
      .filter(name => normalizeName(name) === key)
      .length;
    return getRepeatMultiplier(Math.max(detailCount, levelCount));
  }

  function getPlayerVariantProgress(player, levels, relations = getVariantRelations(levels)) {
    const completedByName = new Map();
    const orderedCompletions = (Array.isArray(player?.completionDetails) ? player.completionDetails : [])
      .map((detail, index) => ({
        detail,
        index,
        timestamp: getCompletionTimestamp(detail),
      }))
      .sort(compareCompletionDates);
    orderedCompletions.forEach(({ detail }) => {
      const key = normalizeName(detail?.name);
      if (key && !completedByName.has(key)) completedByName.set(key, detail);
    });
    (Array.isArray(player?.levels) ? player.levels : []).forEach((name) => {
      const key = normalizeName(name);
      if (key && !completedByName.has(key)) completedByName.set(key, null);
    });

    const multiplierByVariantName = new Map();
    const completedCountByParentName = new Map();
    relations.variantsByParent.forEach((variants, parent) => {
      const completedVariants = variants
        .filter(variant => completedByName.has(normalizeName(variant.name)))
        .sort((a, b) => {
          const dateA = Date.parse(String(completedByName.get(normalizeName(a.name))?.date || ""));
          const dateB = Date.parse(String(completedByName.get(normalizeName(b.name))?.date || ""));
          const validA = Number.isFinite(dateA);
          const validB = Number.isFinite(dateB);
          if (validA && validB && dateA !== dateB) return dateA - dateB;
          if (validA !== validB) return validA ? -1 : 1;
          return relations.indexByLevel.get(a) - relations.indexByLevel.get(b);
        });

      const parentName = normalizeName(parent.name);
      completedCountByParentName.set(parentName, completedVariants.length);
      completedVariants.forEach((variant, index) => {
        multiplierByVariantName.set(normalizeName(variant.name), getVariantMultiplier(index));
      });
    });

    return { completedByName, multiplierByVariantName, completedCountByParentName };
  }

  function createPlayerContext(player, levels, relations = getVariantRelations(levels)) {
    return {
      player,
      levels,
      relations,
      progress: getPlayerVariantProgress(player, levels, relations),
    };
  }

  function getPlayerContext(player, levels, context) {
    return context?.player === player && context?.levels === levels
      ? context
      : createPlayerContext(player, levels);
  }

  function getNextVariantMultiplier(player, level, levels, plannedVariantNames = [], context = null) {
    const playerContext = context?.player === player && context?.levels === levels
      ? context
      : null;
    const relations = playerContext?.relations || getVariantRelations(levels);
    const targetKey = normalizeName(level?.name);
    const target = relations.levelByName.get(targetKey) || level;
    const parent = relations.parentByVariant.get(target);
    if (!parent) return 1;

    const progress = playerContext?.progress || getPlayerVariantProgress(player, levels, relations);
    const parentKey = normalizeName(parent.name);
    const plannedNames = new Set((Array.isArray(plannedVariantNames) ? plannedVariantNames : [])
      .map((entry) => normalizeName(typeof entry === "string" ? entry : entry?.name || entry?.level))
      .filter(Boolean));
    const completedCount = progress.completedCountByParentName.get(parentKey) || 0;
    const plannedCount = (relations.variantsByParent.get(parent) || [])
      .filter(variant => (
        !progress.completedByName.has(normalizeName(variant.name))
        && plannedNames.has(normalizeName(variant.name))
      ))
      .length;
    return getVariantMultiplier(completedCount + plannedCount);
  }

  function getPlayerVariantMultiplier(player, level, levels, context = null) {
    const playerContext = getPlayerContext(player, levels, context);
    const { relations, progress } = playerContext;
    const key = normalizeName(level?.name);
    if (!relations.parentByVariant.has(relations.levelByName.get(key) || level)) return 1;
    return progress.multiplierByVariantName.get(key)
      ?? getNextVariantMultiplier(player, level, levels, [], playerContext);
  }

  return {
    normalizeName,
    getVariantRelations,
    assignRanklessRanks,
    getVariantMultiplier,
    getRepeatMultiplier,
    getPlayerRepeatMultipliers,
    getNextRepeatMultiplier,
    getPlayerVariantProgress,
    createPlayerContext,
    getNextVariantMultiplier,
    getPlayerVariantMultiplier,
  };
})();
