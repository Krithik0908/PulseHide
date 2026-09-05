import {
  BeaconEvent,
  GroundTruth,
  ScenarioConfig,
  getAllHostIds,
} from './types';

// ─── PRNG: Mulberry32 ─────────────────────────────────────────────────────────

/**
 * Creates a seeded pseudo-random number generator using the Mulberry32 algorithm.
 *
 * Returns a closure that yields floats uniformly distributed in [0, 1).
 * Identical seed → identical sequence. No Math.random() is used anywhere in
 * this file.
 *
 * @param seed - 32-bit unsigned integer seed value
 * @returns A stateful `() => number` function
 */
export function createRng(seed: number): () => number {
  let s = seed >>> 0; // coerce to uint32
  return function rng(): number {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) >>> 0;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

/** Returns a float uniformly in [min, max). */
function randBetween(rng: () => number, min: number, max: number): number {
  return min + rng() * (max - min);
}

/**
 * Derives a fresh uint32 seed from a meta-RNG.
 * Calling this in a fixed sequence gives deterministic sub-seeds.
 */
function nextSeed(metaRng: () => number): number {
  return (metaRng() * 0x100000000) >>> 0;
}

// ─── Phase-1 / regular generators ────────────────────────────────────────────

/**
 * Fixed-interval + noise beaconing.
 *
 * Used for:
 *  - Compromised hosts in phase 1
 *  - Benign-regular (lookalike) hosts in BOTH phases
 *
 * Starts with a random offset in [0, intervalMs) then steps by
 * intervalMs ± uniform(0, noiseMs).
 */
function generateRegularBeacons(
  hostId: string,
  rng: () => number,
  startMs: number,
  endMs: number,
  intervalMs: number,
  noiseMs: number,
): BeaconEvent[] {
  const events: BeaconEvent[] = [];
  // Random start offset so hosts don't all fire at t=0
  let t = startMs + rng() * intervalMs;
  while (t < endMs) {
    events.push({ hostId, timestampMs: Math.round(t) });
    // Noise: uniform in [-noiseMs, +noiseMs]
    const noise = rng() * 2 * noiseMs - noiseMs;
    t += intervalMs + noise;
  }
  return events;
}

/**
 * Fully random beaconing — gap drawn uniformly from [intervalMs/2, intervalMs*2].
 *
 * Used for:
 *  - Plain benign hosts in both phases
 *  - Benign-bursty hosts in phase 1 only
 */
function generateRandomBeacons(
  hostId: string,
  rng: () => number,
  startMs: number,
  endMs: number,
  intervalMs: number,
): BeaconEvent[] {
  const events: BeaconEvent[] = [];
  const minGap = intervalMs / 2;
  const maxGap = intervalMs * 2;
  let t = startMs + randBetween(rng, minGap, maxGap);
  while (t < endMs) {
    events.push({ hostId, timestampMs: Math.round(t) });
    t += randBetween(rng, minGap, maxGap);
  }
  return events;
}

// ─── Phase-2 generators ───────────────────────────────────────────────────────

/**
 * Phase-2 beaconing for a COMPROMISED host.
 *
 * Two independent streams are merged:
 *
 * 1. Coordinated burst stream — once per burst period, all compromised hosts
 *    share the SAME pre-computed slot start (`sharedBurstSlots[k]`).
 *    Each host adds a tiny per-host random offset within the burst window so
 *    events don't land at exactly the same millisecond, but the temporal
 *    cluster is tight and shared across the group.
 *
 * 2. Independent jitter noise stream — gaps drawn uniformly from
 *    [phase2JitterMinMs, phase2JitterMaxMs]. This makes per-host timing look
 *    irregular and hides the burst signal from naive interval analysis.
 */
function generateCompromisedPhase2Beacons(
  hostId: string,
  rng: () => number,
  sharedBurstSlots: number[],
  config: ScenarioConfig,
): BeaconEvent[] {
  const events: BeaconEvent[] = [];
  const phase2End = config.phase1DurationMs + config.phase2DurationMs;

  // Stream 1: coordinated burst — one event per period
  for (const slotStart of sharedBurstSlots) {
    if (slotStart >= phase2End) break;
    const t = slotStart + rng() * config.phase2BurstWindowMs;
    if (t < phase2End) {
      events.push({ hostId, timestampMs: Math.round(t) });
    }
  }

  // Stream 2: independent jitter noise events
  let t =
    config.phase1DurationMs +
    randBetween(rng, config.phase2JitterMinMs, config.phase2JitterMaxMs);
  while (t < phase2End) {
    events.push({ hostId, timestampMs: Math.round(t) });
    t += randBetween(rng, config.phase2JitterMinMs, config.phase2JitterMaxMs);
  }

  return events;
}

/**
 * Phase-2 beaconing for a BENIGN-BURSTY host.
 *
 * Emits one event per burst period, but each host independently picks its OWN
 * slot start (not shared with compromised hosts or other bursty hosts). This
 * produces sparse, bursty-looking traffic that is statistically similar in
 * density to the compromised burst stream, but temporally uncorrelated.
 */
function generateBurstyPhase2Beacons(
  hostId: string,
  rng: () => number,
  config: ScenarioConfig,
): BeaconEvent[] {
  const events: BeaconEvent[] = [];
  const phase2Start = config.phase1DurationMs;
  const phase2End = phase2Start + config.phase2DurationMs;
  const numPeriods = Math.floor(
    config.phase2DurationMs / config.phase2BurstPeriodMs,
  );

  for (let k = 0; k < numPeriods; k++) {
    const periodStart = phase2Start + k * config.phase2BurstPeriodMs;
    // Each host independently picks where in the period its slot lands
    const slotMax = config.phase2BurstPeriodMs - config.phase2BurstWindowMs;
    const slotStart = periodStart + rng() * slotMax;
    const t = slotStart + rng() * config.phase2BurstWindowMs;
    if (t < phase2End) {
      events.push({ hostId, timestampMs: Math.round(t) });
    }
  }

  return events;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Runs the full two-phase beacon simulation for every host defined by `config`.
 *
 * Seeding strategy
 * ────────────────
 * A single "meta-RNG" is seeded from `config.seed` and used exclusively to
 * derive child seeds, called in a fixed deterministic order:
 *
 *   1. coordSeed   — for the shared burst slot positions (compromised phase 2)
 *   2. hostSeed[0] — for host-01
 *   3. hostSeed[1] — for host-02
 *   …  (one per host in getAllHostIds order)
 *
 * Each child seed drives its own isolated Mulberry32 instance, ensuring that
 * adding/removing hosts does not perturb unrelated streams.
 *
 * Determinism guarantee
 * ─────────────────────
 * No Math.random(), Date.now(), or any other non-deterministic source is used.
 * Calling `runSimulation(DEFAULT_SCENARIO)` twice always returns an array
 * with identical `{hostId, timestampMs}` pairs in identical order.
 *
 * @returns Flat array of BeaconEvent sorted by timestampMs ascending.
 */
export function runSimulation(config: ScenarioConfig): BeaconEvent[] {
  // ── Seed derivation ──────────────────────────────────────────────────────
  const metaRng = createRng(config.seed);

  // 1. Coordination RNG — shared burst slot positions for compromised phase 2
  const coordRng = createRng(nextSeed(metaRng));

  // 2. Per-host RNGs — one per host in getAllHostIds() order
  const allHostIds = getAllHostIds(config);
  const hostRngs = new Map<string, () => number>();
  for (const hostId of allHostIds) {
    hostRngs.set(hostId, createRng(nextSeed(metaRng)));
  }

  // ── Pre-compute shared burst slots for compromised phase 2 ───────────────
  const phase2Start = config.phase1DurationMs;
  const phase2End = phase2Start + config.phase2DurationMs;
  const numBurstPeriods = Math.floor(
    config.phase2DurationMs / config.phase2BurstPeriodMs,
  );

  const sharedBurstSlots: number[] = [];
  for (let k = 0; k < numBurstPeriods; k++) {
    const periodStart = phase2Start + k * config.phase2BurstPeriodMs;
    // Ensure the full burst window fits inside the period
    const slotMax = config.phase2BurstPeriodMs - config.phase2BurstWindowMs;
    sharedBurstSlots.push(periodStart + coordRng() * slotMax);
  }

  // ── Category lookup sets ─────────────────────────────────────────────────
  const compromisedSet = new Set(config.compromisedHostIds);
  const benignRegularSet = new Set(config.benignRegularHostIds);
  const benignBurstySet = new Set(config.benignBurstyHostIds);

  // ── Generate events per host ─────────────────────────────────────────────
  const allEvents: BeaconEvent[] = [];

  for (const hostId of allHostIds) {
    const rng = hostRngs.get(hostId)!;

    if (compromisedSet.has(hostId)) {
      // Phase 1: regular interval ± noise (indistinguishable from benign-regular)
      allEvents.push(
        ...generateRegularBeacons(
          hostId, rng,
          0, config.phase1DurationMs,
          config.phase1IntervalMs, config.phase1NoiseMs,
        ),
      );
      // Phase 2: coordinated bursts + independent jitter noise
      allEvents.push(
        ...generateCompromisedPhase2Beacons(
          hostId, rng, sharedBurstSlots, config,
        ),
      );

    } else if (benignRegularSet.has(hostId)) {
      // Both phases: identical regular beaconing — the lookalike trap.
      // A detector that only looks at phase-1 interval regularity will falsely
      // flag these hosts alongside the compromised group.
      allEvents.push(
        ...generateRegularBeacons(
          hostId, rng,
          0, phase2End,
          config.phase1IntervalMs, config.phase1NoiseMs,
        ),
      );

    } else if (benignBurstySet.has(hostId)) {
      // Phase 1: random (uncoordinated)
      allEvents.push(
        ...generateRandomBeacons(
          hostId, rng,
          0, config.phase1DurationMs,
          config.phase1IntervalMs,
        ),
      );
      // Phase 2: independent bursty — similar density to compromised but no
      // shared slot, so bursts don't cluster with the compromised group
      allEvents.push(
        ...generateBurstyPhase2Beacons(hostId, rng, config),
      );

    } else {
      // Plain benign: fully random across both phases
      allEvents.push(
        ...generateRandomBeacons(
          hostId, rng,
          0, phase2End,
          config.phase1IntervalMs,
        ),
      );
    }
  }

  // ── Sort by timestamp ascending ──────────────────────────────────────────
  // JavaScript's Array.sort is stable in all modern engines (V8, SpiderMonkey,
  // JavaScriptCore) and in the ECMAScript 2019+ spec, so relative order of
  // same-timestamp events from different hosts is deterministic.
  allEvents.sort((a, b) => a.timestampMs - b.timestampMs);

  return allEvents;
}

/**
 * Returns the ground-truth labels for a given scenario.
 * Consumed by the evaluator to compute precision / recall against detector output.
 */
export function getGroundTruth(config: ScenarioConfig): GroundTruth {
  return {
    compromisedHostIds: config.compromisedHostIds,
    phase1EndMs: config.phase1DurationMs,
  };
}
