'use strict';

(function attachDemonListSystem(globalObj) {
  function classifyTierByPercentile(percentile) {
    if (percentile < 0.25) return 'easy';
    if (percentile < 0.60) return 'medium';
    if (percentile < 0.85) return 'hard';
    return 'extreme';
  }

  function sigmoid(x) {
    return 1 / (1 + Math.exp(-x));
  }

  class Level {
    constructor(id, attrs = {}) {
      this.id = id;

      this.avgDifficulty = attrs.avgDifficulty ?? 5;
      this.framePerfects = attrs.framePerfects ?? 0;
      this.lengthSeconds = attrs.lengthSeconds ?? 60;
      this.attemptsMedian = attrs.attemptsMedian ?? 10;
      this.inputDensity = attrs.inputDensity ?? 1;
      this.completionRate = attrs.completionRate ?? 0.5;

      this.mu = 1000 + this.avgDifficulty * 100;
      this.sigma = 120;
      this.residualVar = attrs.residualVar ?? 0.25;

      this.controversyScore = 0;
    }

    getRating() {
      return this.mu;
    }

    getDifficultyEstimate() {
      return (this.mu - 1000) / 100;
    }

    getTier() {
      const liveDifficulty = this.getDifficultyEstimate();
      if (!Number.isFinite(liveDifficulty)) return classifyTierByPercentile(0.5);
      if (liveDifficulty <= 3) return 'easy';
      if (liveDifficulty <= 6) return 'medium';
      if (liveDifficulty <= 8) return 'hard';
      return 'extreme';
    }

    toStateDTO() {
      return {
        id: this.id,
        mu: this.mu,
        sigma: this.sigma,
        avgDifficulty: this.avgDifficulty,
        framePerfects: this.framePerfects,
        lengthSeconds: this.lengthSeconds,
        attemptsMedian: this.attemptsMedian,
        inputDensity: this.inputDensity,
        completionRate: this.completionRate,
        residualVar: this.residualVar,
        controversyScore: this.controversyScore
      };
    }

    toJSON() {
      return {
        ...this.toStateDTO(),
        tier: this.getTier()
      };
    }

    static fromLevelDTO(dto) {
      const level = new Level(dto.id, {
        avgDifficulty: dto.avgDifficulty,
        framePerfects: dto.framePerfects,
        lengthSeconds: dto.lengthSeconds,
        attemptsMedian: dto.attemptsMedian,
        inputDensity: dto.inputDensity,
        completionRate: dto.completionRate,
        residualVar: dto.residualVar
      });

      if (Number.isFinite(dto.mu)) level.mu = dto.mu;
      if (Number.isFinite(dto.sigma)) level.sigma = dto.sigma;
      if (Number.isFinite(dto.controversyScore)) level.controversyScore = dto.controversyScore;

      return level;
    }
  }

  class Player {
    constructor(id) {
      this.id = id;

      this.reliability = 1.0;
      this.reliability0 = 1.0;
      this.reliabilityMin = 0.4;
      this.reliabilityMax = 1.8;

      const baseline = (this.reliability0 - this.reliabilityMin) / (this.reliabilityMax - this.reliabilityMin);
      this.skillLogit0 = Math.log(baseline / (1 - baseline));
      this.skillLogit = this.skillLogit0;
    }

    getWeight() {
      return Math.max(this.reliabilityMin, Math.min(this.reliabilityMax, this.reliability));
    }

    update(correctProb, actual) {
      const lr = 0.25;
      const shrink = 0.015;

      const residual = actual - correctProb;
      const confidence = Math.abs(correctProb - 0.5) * 2;
      const wrongDirection = residual < 0;
      const asymmetry = wrongDirection
        ? (1.0 + 2.0 * confidence)
        : (0.35 + 0.65 * (1 - confidence));

      this.skillLogit += lr * residual * asymmetry;
      this.skillLogit += shrink * (this.skillLogit0 - this.skillLogit);

      const trust = sigmoid(this.skillLogit);
      this.reliability = this.reliabilityMin + (this.reliabilityMax - this.reliabilityMin) * trust;
    }

    toJSON() {
      return {
        id: this.id,
        reliability: this.reliability,
        reliability0: this.reliability0,
        reliabilityMin: this.reliabilityMin,
        reliabilityMax: this.reliabilityMax,
        skillLogit: this.skillLogit,
        skillLogit0: this.skillLogit0,
        weight: this.getWeight()
      };
    }
  }

  class Comparison {
    constructor(id, levelA, levelB, winnerId, playerId, timestamp = Date.now()) {
      this.id = id;
      this.levelA = levelA;
      this.levelB = levelB;
      this.winnerId = winnerId;
      this.playerId = playerId;
      this.timestamp = timestamp;
    }

    toJSON() {
      return {
        id: this.id,
        levelA: this.levelA,
        levelB: this.levelB,
        winnerId: this.winnerId,
        playerId: this.playerId,
        timestamp: this.timestamp
      };
    }
  }

  class DemonListSystem {
    constructor({
      beta = 200,
      tau = 5,
      decayLambda = 0.01,
      suggestionPoolSize = 50,
      calibrationEpsilon = 1e-6,
      calibrationErrorEmaAlpha = 0.05,
      calibrationUncertaintyScale = 0.25,
      calibrationErrorScale = 2.0,
      calibrationMidtierScale = 0.2,
      sigmaEwmaDecay = 0.97,
      sigmaMin = 20,
      sigmaMax = 350
    } = {}) {
      this.levels = new Map();
      this.players = new Map();
      this.comparisons = [];
      this.processedComparisons = new Set();

      this.beta = beta;
      this.tau = tau;
      this.decayLambda = decayLambda;
      this.suggestionPoolSize = suggestionPoolSize;
      this.calibrationEpsilon = calibrationEpsilon;
      this.calibrationErrorEmaAlpha = calibrationErrorEmaAlpha;
      this.calibrationUncertaintyScale = calibrationUncertaintyScale;
      this.calibrationErrorScale = calibrationErrorScale;
      this.calibrationMidtierScale = calibrationMidtierScale;
      this.sigmaEwmaDecay = sigmaEwmaDecay;
      this.sigmaMin = sigmaMin;
      this.sigmaMax = sigmaMax;
      this.calibrationErrorEma = 0.25;
      this.betaFloorScale = 0.25;
    }

    addLevel(id, attrs = {}) {
      this.levels.set(id, new Level(id, attrs));
    }

    importLevels(levelDtos = []) {
      for (const dto of levelDtos) {
        if (!dto || typeof dto.id !== 'string') continue;
        this.levels.set(dto.id, Level.fromLevelDTO(dto));
      }
    }

    addPlayer(id) {
      this.players.set(id, new Player(id));
    }

    addComparison(a, b, winner, player) {
      const id = `${this.comparisons.length}:${a}:${b}:${winner}:${player}:${Date.now()}`;
      this.comparisons.push(new Comparison(id, a, b, winner, player));
    }

    getTimeWeight(ts, now = Date.now()) {
      const ageDays = (now - ts) / 86400000;
      return Math.exp(-this.decayLambda * Math.log1p(Math.max(0, ageDays)));
    }

    expectedWithC(A, B) {
      const aSigma2 = A.sigma * A.sigma;
      const bSigma2 = B.sigma * B.sigma;
      const c = Math.sqrt(aSigma2 + bSigma2) + this.betaFloorScale * this.beta;
      const p = sigmoid((A.mu - B.mu) / c);
      return { p, c };
    }

    expected(A, B) {
      return this.expectedWithC(A, B).p;
    }

    getAdaptiveCalibrationEpsilon(c, p) {
      const normalizedUncertainty = c / this.beta;
      const uncertaintyFactor = this.calibrationUncertaintyScale * normalizedUncertainty;
      const errorFactor = this.calibrationErrorScale * this.calibrationErrorEma;
      const confidenceShape = 4 * p * (1 - p);
      const midtierFactor = this.calibrationMidtierScale * confidenceShape;
      const eps = this.calibrationEpsilon * (1 + uncertaintyFactor + errorFactor + midtierFactor);
      return Math.max(this.calibrationEpsilon, eps);
    }

    residualVarToSigma(residualVar) {
      const clampedVar = Math.max(0, Math.min(1, residualVar));
      const volatility = Math.sqrt(clampedVar);
      return this.sigmaMin + (this.sigmaMax - this.sigmaMin) * volatility;
    }

    updateRatings() {
      const now = Date.now();

      for (const comp of this.comparisons) {
        if (this.processedComparisons.has(comp.id)) continue;

        const A = this.levels.get(comp.levelA);
        const B = this.levels.get(comp.levelB);
        const player = this.players.get(comp.playerId);
        if (!A || !B || !player) {
          this.processedComparisons.add(comp.id);
          continue;
        }

        const w = player.getWeight() * this.getTimeWeight(comp.timestamp, now);

        const aPriorVar = (A.sigma * A.sigma) + (this.tau * this.tau);
        const bPriorVar = (B.sigma * B.sigma) + (this.tau * this.tau);
        const c = Math.sqrt(aPriorVar + bPriorVar) + this.betaFloorScale * this.beta;
        const P = sigmoid((A.mu - B.mu) / c);

        const S = comp.winnerId === A.id ? 1 : 0;
        const kA = Math.sqrt(aPriorVar) / c;
        const kB = Math.sqrt(bPriorVar) / c;

        const adaptiveEpsilon = this.getAdaptiveCalibrationEpsilon(c, P);
        const calibratedDenom = (P * (1 - P)) + adaptiveEpsilon;
        const delta = w * (S - P) / calibratedDenom;

        A.mu += kA * delta;
        B.mu -= kB * delta;

        const residual2 = (S - P) * (S - P);
        A.residualVar = this.sigmaEwmaDecay * A.residualVar + (1 - this.sigmaEwmaDecay) * residual2;
        B.residualVar = this.sigmaEwmaDecay * B.residualVar + (1 - this.sigmaEwmaDecay) * residual2;
        A.sigma = this.residualVarToSigma(A.residualVar);
        B.sigma = this.residualVarToSigma(B.residualVar);

        this.calibrationErrorEma += this.calibrationErrorEmaAlpha * (residual2 - this.calibrationErrorEma);

        player.update(P, S);
        this.processedComparisons.add(comp.id);
      }

      this.anchorRatings();
    }

    anchorRatings(targetMean = 1000) {
      if (this.levels.size === 0) return;
      let sum = 0;
      for (const level of this.levels.values()) {
        sum += level.mu;
      }
      const mean = sum / this.levels.size;
      const shift = mean - targetMean;
      for (const level of this.levels.values()) {
        level.mu -= shift;
      }
    }

    computeControversy() {
      const mse = new Map();
      const wsum = new Map();
      const now = Date.now();
      let globalWeightedErr = 0;
      let globalWeight = 0;
      const lam = 5;

      for (const id of this.levels.keys()) {
        mse.set(id, 0);
        wsum.set(id, 0);
      }

      for (const comp of this.comparisons) {
        const A = this.levels.get(comp.levelA);
        const B = this.levels.get(comp.levelB);
        const player = this.players.get(comp.playerId);
        if (!A || !B || !player) continue;

        const w = player.getWeight() * this.getTimeWeight(comp.timestamp, now);

        const P = this.expectedWithC(A, B).p;
        const S = comp.winnerId === A.id ? 1 : 0;

        const err = (S - P) * (S - P);
        globalWeightedErr += w * err;
        globalWeight += w;

        mse.set(A.id, mse.get(A.id) + w * err);
        mse.set(B.id, mse.get(B.id) + w * err);

        wsum.set(A.id, wsum.get(A.id) + w);
        wsum.set(B.id, wsum.get(B.id) + w);
      }

      for (const l of this.levels.values()) {
        const w = wsum.get(l.id) || 1;
        const priorMeanErr = globalWeight > 0 ? globalWeightedErr / globalWeight : 0;
        const bayesVariance = (lam * priorMeanErr + mse.get(l.id)) / (lam + w);
        l.controversyScore = bayesVariance / (1 + Math.log1p(w));
      }
    }

    fit() {
      this.updateRatings();
      this.computeControversy();
    }

    suggestComparison() {
      const pool = [...this.levels.values()]
        .sort((a, b) => b.sigma - a.sigma)
        .slice(0, this.suggestionPoolSize);
      const n = pool.length;

      let best = -Infinity;
      let bestPair = null;

      for (let i = 0; i < n; i++) {
        for (let j = i + 1; j < n; j++) {
          const A = pool[i];
          const B = pool[j];

          const { p: P } = this.expectedWithC(A, B);
          const score = P * (1 - P) * (A.sigma + B.sigma);

          if (score > best) {
            best = score;
            bestPair = [A.id, B.id];
          }
        }
      }

      return bestPair;
    }

    getRankings() {
      const analyticsRows = this.computeRankingAnalytics();
      return this.decorateRankingsWithTiers(analyticsRows);
    }

    computeRankingAnalytics() {
      return [...this.levels.values()]
        .map(l => ({
          id: l.id,
          rating: l.mu,
          uncertainty: l.sigma,
          score: l.mu - 0.75 * l.sigma,
          controversyScore: l.controversyScore
        }))
        .sort((a, b) => b.score - a.score);
    }

    decorateRankingsWithTiers(analyticsRows) {
      const n = analyticsRows.length;
      return analyticsRows.map((entry, idx) => {
        const percentile = n <= 1 ? 0.5 : idx / (n - 1);
        return {
          ...entry,
          tier: classifyTierByPercentile(1 - percentile)
        };
      });
    }

    exportLevels() {
      const tierById = new Map(this.getRankings().map(row => [row.id, row.tier]));
      return [...this.levels.values()].map(level => ({
        ...level.toStateDTO(),
        tier: tierById.get(level.id) ?? level.getTier()
      }));
    }

    exportLevelStates() {
      return [...this.levels.values()].map(level => level.toStateDTO());
    }

    exportPlayers() {
      return [...this.players.values()].map(player => ({
        id: player.id,
        reliability: player.reliability,
        skillLogit: player.skillLogit
      }));
    }

    exportComparisons() {
      return this.comparisons.map(comp => comp.toJSON());
    }

    exportRankings() {
      return this.getRankings();
    }

    toJSON() {
      return {
        config: {
          beta: this.beta,
          tau: this.tau,
          decayLambda: this.decayLambda,
          suggestionPoolSize: this.suggestionPoolSize,
          calibrationEpsilon: this.calibrationEpsilon,
          calibrationErrorEmaAlpha: this.calibrationErrorEmaAlpha,
          calibrationUncertaintyScale: this.calibrationUncertaintyScale,
          calibrationErrorScale: this.calibrationErrorScale,
          calibrationMidtierScale: this.calibrationMidtierScale,
          sigmaEwmaDecay: this.sigmaEwmaDecay,
          sigmaMin: this.sigmaMin,
          sigmaMax: this.sigmaMax,
          betaFloorScale: this.betaFloorScale
        },
        calibrationErrorEma: this.calibrationErrorEma,
        levels: this.exportLevels(),
        players: this.exportPlayers(),
        comparisons: this.exportComparisons(),
        rankings: this.getRankings()
      };
    }
  }

  globalObj.DemonListSystem = DemonListSystem;
})(typeof window !== 'undefined' ? window : globalThis);
