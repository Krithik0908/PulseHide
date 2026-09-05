import { BeaconEvent } from './types';

// ─── Mathematical Helpers ───────────────────────────────────────────────────

/**
 * Computes the sample mean of an array of numbers.
 */
function computeMean(values: number[]): number {
  if (values.length === 0) return 0;
  const sum = values.reduce((acc, val) => acc + val, 0);
  return sum / values.length;
}

/**
 * Computes the sample standard deviation of an array of numbers.
 * Uses Bessel's correction (N - 1 denominator) when N > 1.
 */
function computeStdDev(values: number[], mean: number): number {
  if (values.length <= 1) return 0;
  const sumSquaredDiffs = values.reduce(
    (acc, val) => acc + Math.pow(val - mean, 2),
    0,
  );
  return Math.sqrt(sumSquaredDiffs / (values.length - 1));
}

/**
 * Computes the Jaccard similarity coefficient between two sets of numbers.
 * J(A, B) = |A ∩ B| / |A ∪ B|
 * Returns 0 if both sets are empty.
 */
function computeJaccardSimilarity(setA: Set<number>, setB: Set<number>): number {
  if (setA.size === 0 && setB.size === 0) return 0;

  // Optimize intersection by iterating the smaller set
  const [small, large] = setA.size < setB.size ? [setA, setB] : [setB, setA];
  let intersectionSize = 0;
  small.forEach((item) => {
    if (large.has(item)) {
      intersectionSize++;
    }
  });

  const unionSize = setA.size + setB.size - intersectionSize;
  if (unionSize === 0) return 0;

  return intersectionSize / unionSize;
}

// ─── Phase 1 Regularity Scoring ─────────────────────────────────────────────

/**
 * Computes a 0–1 regularity score for a given host within a time window [windowStartMs, windowEndMs).
 *
 * Scoring Formula:
 * ────────────────
 * 1. Filter events for `hostId` strictly in [windowStartMs, windowEndMs).
 * 2. Calculate consecutive inter-arrival intervals: Δt_i = t_{i+1} - t_i.
 * 3. Require at least 3 events (≥ 2 intervals) to evaluate periodicity; otherwise return 0.
 * 4. Compute Coefficient of Variation (CV):
 *      CV = σ(intervals) / μ(intervals)
 * 5. Map CV to a smooth [0, 1] score using the rational function:
 *      score = 1 / (1 + CV * 10)
 *    - Perfectly periodic signals (CV ≈ 0) approach 1.0.
 *    - Low noise (e.g. ±3s on 60s interval, CV ≈ 0.028) yields score ≈ 0.78–0.80.
 *    - High-variance/random signals (CV ≥ 0.35) yield score ≤ 0.22.
 * 6. Clamped to the closed interval [0, 1].
 *
 * @param events - Flat array of simulation beacon events.
 * @param hostId - Host ID to score (e.g. "host-01").
 * @param windowStartMs - Window start timestamp (inclusive).
 * @param windowEndMs - Window end timestamp (exclusive).
 * @returns Regularity score between 0.0 and 1.0.
 */
export function scorePhase1(
  events: BeaconEvent[],
  hostId: string,
  windowStartMs: number,
  windowEndMs: number,
): number {
  // 1. Filter events for this host in [windowStartMs, windowEndMs)
  const hostEvents = events
    .filter(
      (e) =>
        e.hostId === hostId &&
        e.timestampMs >= windowStartMs &&
        e.timestampMs < windowEndMs,
    )
    .sort((a, b) => a.timestampMs - b.timestampMs);

  // 3. Minimum event count guard
  if (hostEvents.length < 3) {
    return 0;
  }

  // 2. Compute inter-arrival intervals
  const intervals: number[] = [];
  for (let i = 1; i < hostEvents.length; i++) {
    const gap = hostEvents[i].timestampMs - hostEvents[i - 1].timestampMs;
    intervals.push(gap);
  }

  if (intervals.length < 2) {
    return 0;
  }

  const mean = computeMean(intervals);
  if (mean <= 0) {
    return 0;
  }

  const stdDev = computeStdDev(intervals, mean);

  // 4. Coefficient of Variation
  const cv = stdDev / mean;

  // 5. Convert CV to [0, 1] regularity score
  // Formula: score = 1 / (1 + CV * 10)
  const rawScore = 1 / (1 + cv * 10);

  // 6. Clamp to [0, 1]
  return Math.min(1, Math.max(0, rawScore));
}

/**
 * Scores Phase 1 interval regularity for all specified hosts.
 *
 * @param events - Flat array of simulation beacon events.
 * @param hostIds - List of host IDs to evaluate.
 * @param windowStartMs - Window start timestamp (inclusive).
 * @param windowEndMs - Window end timestamp (exclusive).
 * @returns Record mapping hostId -> score (0.0 to 1.0).
 */
export function scoreAllHostsPhase1(
  events: BeaconEvent[],
  hostIds: string[],
  windowStartMs: number,
  windowEndMs: number,
): Record<string, number> {
  const scores: Record<string, number> = {};

  for (const hostId of hostIds) {
    scores[hostId] = scorePhase1(
      events,
      hostId,
      windowStartMs,
      windowEndMs,
    );
  }

  return scores;
}

// ─── Phase 2 Temporal Co-occurrence / Correlation Scoring ───────────────────

/**
 * Computes Phase 2 temporal correlation scores across a set of hosts using
 * multi-host Jaccard bucket similarity and top-K peer averaging.
 *
 * Algorithm & Design Rationale:
 * ─────────────────────────────
 * 1. Filter all events to [windowStartMs, windowEndMs) for the specified `hostIds`.
 * 2. Partition time into fixed buckets of width `bucketSizeMs` (e.g. 10,000 ms).
 *    Bucket index = Math.floor((timestampMs - windowStartMs) / bucketSizeMs).
 *    Build a Set of active bucket indices for each host.
 * 3. Compute pairwise Jaccard similarity:
 *      J(H_i, H_j) = |Buckets(H_i) ∩ Buckets(H_j)| / |Buckets(H_i) ∪ Buckets(H_j)|
 * 4. Top-K Peer Averaging (K = 4):
 *    - In a fleet with many benign hosts and a small subset of compromised hosts
 *      (e.g., 5 out of 20 hosts), a global average across all 19 other hosts would
 *      dilute the true synchronized cluster signal with the ~15 uncorrelated hosts.
 *    - Averaging only against the host's top-K most similar peers captures whether
 *      the host participates in a tightly coordinated cluster of size K+1 (e.g. K=4
 *      for a 5-member C2 botnet group), while completely ignoring the large
 *      background of uncoordinated hosts.
 * 5. Clamped to [0, 1].
 *
 * @param events - Flat array of simulation beacon events.
 * @param hostIds - Array of all host IDs to score.
 * @param windowStartMs - Phase 2 window start (inclusive).
 * @param windowEndMs - Phase 2 window end (exclusive).
 * @param bucketSizeMs - Temporal bucket width (ms), matching phase2BurstWindowMs.
 * @returns Record mapping hostId -> phase 2 correlation score (0.0 to 1.0).
 */
export function scorePhase2(
  events: BeaconEvent[],
  hostIds: string[],
  windowStartMs: number,
  windowEndMs: number,
  bucketSizeMs: number,
): Record<string, number> {
  const hostIdSet = new Set(hostIds);

  // 1 & 2. Bucket active occurrences per host
  const activeBucketsByHost = new Map<string, Set<number>>();
  for (const hostId of hostIds) {
    activeBucketsByHost.set(hostId, new Set<number>());
  }

  for (const event of events) {
    if (
      hostIdSet.has(event.hostId) &&
      event.timestampMs >= windowStartMs &&
      event.timestampMs < windowEndMs
    ) {
      const bucketIdx = Math.floor(
        (event.timestampMs - windowStartMs) / bucketSizeMs,
      );
      activeBucketsByHost.get(event.hostId)!.add(bucketIdx);
    }
  }

  // 3. Compute pairwise Jaccard similarities
  const n = hostIds.length;
  // Pre-allocate similarity matrix / lookup
  const pairwiseSimilarity = new Map<string, Map<string, number>>();
  for (const hostId of hostIds) {
    pairwiseSimilarity.set(hostId, new Map<string, number>());
  }

  for (let i = 0; i < n; i++) {
    const hostA = hostIds[i];
    const setA = activeBucketsByHost.get(hostA)!;

    for (let j = i + 1; j < n; j++) {
      const hostB = hostIds[j];
      const setB = activeBucketsByHost.get(hostB)!;

      const sim = computeJaccardSimilarity(setA, setB);
      pairwiseSimilarity.get(hostA)!.set(hostB, sim);
      pairwiseSimilarity.get(hostB)!.set(hostA, sim);
    }
  }

  // 4. Compute Top-K average similarity for each host (K = 4)
  const TOP_K = 4;
  const scores: Record<string, number> = {};

  for (const hostId of hostIds) {
    const peerSimsMap = pairwiseSimilarity.get(hostId)!;
    const peerSims: number[] = [];

    for (const otherHost of hostIds) {
      if (otherHost !== hostId) {
        peerSims.push(peerSimsMap.get(otherHost) ?? 0);
      }
    }

    // Sort peer similarities descending
    peerSims.sort((a, b) => b - a);

    const k = Math.min(TOP_K, peerSims.length);
    if (k === 0) {
      scores[hostId] = 0;
    } else {
      const topKSims = peerSims.slice(0, k);
      const topKMean = topKSims.reduce((sum, v) => sum + v, 0) / k;
      // 5. Clamp to [0, 1]
      scores[hostId] = Math.min(1, Math.max(0, topKMean));
    }
  }

  return scores;
}
