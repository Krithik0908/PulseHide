import { GroundTruth } from './types';

// ─── Evaluation Types ────────────────────────────────────────────────────────

/**
 * Detailed evaluation report comparing detector containment decisions against ground truth.
 */
export interface EvaluationResult {
  /** Compromised hosts correctly flagged as contained. */
  truePositives: string[];

  /** Benign hosts incorrectly flagged as contained. */
  falsePositives: string[];

  /** Compromised hosts missed by the detector (not contained). */
  falseNegatives: string[];

  /** Benign hosts correctly left uncontained. */
  trueNegatives: string[];

  /** Strict benchmark pass status: true only if 0 false positives AND 0 false negatives. */
  passed: boolean;
}

// ─── Evaluator Function ──────────────────────────────────────────────────────

/**
 * Evaluates detection containment results against simulation ground truth.
 *
 * Classification Logic:
 * ─────────────────────
 * • True Positive (TP)  : contained === true  && isCompromised
 * • False Positive (FP) : contained === true  && !isCompromised
 * • False Negative (FN) : contained === false && isCompromised
 * • True Negative (TN)  : contained === false && !isCompromised
 *
 * A benchmark run passes (`passed === true`) if and only if:
 *   FP.length === 0 && FN.length === 0  (100% Precision & 100% Recall)
 *
 * @param detectionResults - Array of host containment results from runDetection.
 * @param groundTruth - Ground-truth labels from getGroundTruth.
 * @returns EvaluationResult summary with host arrays and passed boolean.
 */
export function evaluate(
  detectionResults: { hostId: string; contained: boolean }[],
  groundTruth: GroundTruth,
): EvaluationResult {
  const compromisedSet = new Set(groundTruth.compromisedHostIds);

  const truePositives: string[] = [];
  const falsePositives: string[] = [];
  const falseNegatives: string[] = [];
  const trueNegatives: string[] = [];

  for (const result of detectionResults) {
    const isCompromised = compromisedSet.has(result.hostId);

    if (result.contained) {
      if (isCompromised) {
        truePositives.push(result.hostId);
      } else {
        falsePositives.push(result.hostId);
      }
    } else {
      if (isCompromised) {
        falseNegatives.push(result.hostId);
      } else {
        trueNegatives.push(result.hostId);
      }
    }
  }

  const passed = falsePositives.length === 0 && falseNegatives.length === 0;

  return {
    truePositives,
    falsePositives,
    falseNegatives,
    trueNegatives,
    passed,
  };
}
