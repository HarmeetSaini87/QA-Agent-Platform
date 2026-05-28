// src/api-analytics/contracts/predictive-intelligence.contracts.ts
// Phase E Step 7: Future predictive intelligence extension points. Stubs only.

export interface IPredictiveFlakinessAnalyzer {
  /** Predict flakiness score for a step over next N runs (stub). */
  predict(stepId: string, collectionId: string, lookAheadRuns: number): Promise<{ predictedScore: number; confidence: number }>;
}

export interface ISlaForecaster {
  /** Forecast SLA health for next window (stub). */
  forecast(collectionId: string, policyId: string, horizonMs: number): Promise<{ breachLikelihood: number; advisoryNote: string }>;
}

export interface IAnomalyDetector {
  /** Detect anomalies in execution trends (stub). */
  detect(collectionId: string, windowMs: number): Promise<Array<{ stepId: string; anomalyType: string; score: number }>>;
}

export class NoOpPredictiveFlakinessAnalyzer implements IPredictiveFlakinessAnalyzer {
  async predict(_stepId: string, _collectionId: string, _lookAheadRuns: number) {
    return { predictedScore: 0, confidence: 0 };
  }
}

export class NoOpSlaForecaster implements ISlaForecaster {
  async forecast(_collectionId: string, _policyId: string, _horizonMs: number) {
    return { breachLikelihood: 0, advisoryNote: 'Forecasting not yet implemented.' };
  }
}

export class NoOpAnomalyDetector implements IAnomalyDetector {
  async detect(_collectionId: string, _windowMs: number) { return []; }
}
