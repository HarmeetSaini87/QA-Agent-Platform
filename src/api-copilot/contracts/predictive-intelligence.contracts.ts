// src/api-copilot/contracts/predictive-intelligence.contracts.ts
// Phase E Step 10: Predictive intelligence contracts. Read-only forecasts — never mutates runtime.

export interface FlakinessForecast {
  readonly collectionId: string;
  readonly stepId: string;
  readonly predictedFlakinessScore: number;   // 0–100
  readonly confidence: number;                 // 0–100
  readonly contributingFactors: readonly string[];
  readonly forecastedAt: string;
}

export interface RetryStormForecast {
  readonly collectionId: string;
  readonly predictedRetryRate: number;         // 0–1
  readonly stormRisk: 'low' | 'medium' | 'high';
  readonly affectedStepIds: readonly string[];
  readonly confidence: number;
  readonly forecastedAt: string;
}

export interface SlaBreachForecast {
  readonly collectionId: string;
  readonly slaMetric: string;
  readonly currentValue: number;
  readonly forecastedValue: number;
  readonly breachLikelihood: number;           // 0–1
  readonly forecastedAt: string;
}

export interface IPredictiveIntelligenceEngine {
  forecastFlakiness(collectionId: string, stepIds: readonly string[]): FlakinessForecast[];
  forecastRetryStorm(collectionId: string): RetryStormForecast;
  forecastSlaBreach(collectionId: string, slaMetric: string, currentValue: number): SlaBreachForecast;
}
