// ─── Core domain types ───────────────────────────────────────────────────────

/** A single host that participated in the simulation. */
export interface Host {
  id: string;
  isCompromised: boolean;
}

/** A single network beacon event emitted by a host. */
export interface BeaconEvent {
  hostId: string;
  /** Absolute simulation time in milliseconds from t=0. */
  timestampMs: number;
}

// ─── Scenario configuration ──────────────────────────────────────────────────

/**
 * Full configuration for one simulation run.
 *
 * Host categories
 * ───────────────
 * • compromisedHostIds      – C2-beaconing hosts; regular in phase 1, burst-
 *                             coordinated in phase 2.
 * • benignRegularHostIds    – Benign "lookalike" hosts that also beacon on a
 *                             fixed interval (intentional trap for detectors).
 * • benignBurstyHostIds     – Benign hosts that go sparse/bursty but whose
 *                             bursts are uncoordinated with each other or the
 *                             compromised set.
 * • All remaining hosts up to totalHosts are plain random-benign and are not
 *   listed explicitly in any of the above arrays.
 */
export interface ScenarioConfig {
  /** PRNG seed for reproducible runs. */
  seed: number;

  /** Total number of hosts in the simulation (host-01 … host-N). */
  totalHosts: number;

  /** IDs of hosts running C2 beacon software. */
  compromisedHostIds: string[];

  /**
   * Benign hosts that beacon on a fixed interval — intentional lookalike trap
   * to stress-test the detector's false-positive rate.
   */
  benignRegularHostIds: string[];

  /**
   * Benign hosts whose traffic goes sparse/bursty but whose bursts are
   * uncoordinated with each other or the compromised set.
   */
  benignBurstyHostIds: string[];

  // ── Phase durations ──────────────────────────────────────────────────────

  /** Duration of phase 1 (regular beaconing) in milliseconds. */
  phase1DurationMs: number;

  /** Duration of phase 2 (jittered / burst beaconing) in milliseconds. */
  phase2DurationMs: number;

  // ── Phase 1 parameters ───────────────────────────────────────────────────

  /** Base beacon interval for compromised hosts during phase 1 (ms). */
  phase1IntervalMs: number;

  /**
   * Maximum random noise added to / subtracted from phase1IntervalMs each
   * tick, producing an interval in the range
   * [phase1IntervalMs - phase1NoiseMs, phase1IntervalMs + phase1NoiseMs].
   */
  phase1NoiseMs: number;

  // ── Phase 2 parameters ───────────────────────────────────────────────────

  /** Minimum random jitter between beacons for compromised hosts in phase 2 (ms). */
  phase2JitterMinMs: number;

  /** Maximum random jitter between beacons for compromised hosts in phase 2 (ms). */
  phase2JitterMaxMs: number;

  /**
   * Width of the shared time window (ms) within which all compromised hosts
   * emit a coordinated burst beacon during each burst opportunity.
   */
  phase2BurstWindowMs: number;

  /**
   * How often (ms) a burst opportunity occurs during phase 2.
   * Every phase2BurstPeriodMs, compromised hosts burst within the same
   * phase2BurstWindowMs window.
   */
  phase2BurstPeriodMs: number;
}

// ─── Ground truth (used by the evaluator) ────────────────────────────────────

/** Ground-truth labels produced by the simulator for evaluator consumption. */
export interface GroundTruth {
  /** IDs of hosts that are truly compromised. */
  compromisedHostIds: string[];

  /** Absolute simulation timestamp (ms) at which phase 1 ends / phase 2 begins. */
  phase1EndMs: number;
}

// ─── Default scenario ─────────────────────────────────────────────────────────

/**
 * Canonical, reproducible scenario config used as the default for development,
 * testing, and benchmarking.
 *
 * Host layout (20 total):
 *   host-01 … host-05   compromised C2 beacons
 *   host-06 … host-08   benign-regular lookalikes
 *   host-09 … host-11   benign-bursty
 *   host-12 … host-20   plain random-benign (not listed in any special array)
 */
export const DEFAULT_SCENARIO: ScenarioConfig = {
  seed: 42,
  totalHosts: 20,

  compromisedHostIds: [
    'host-01',
    'host-02',
    'host-03',
    'host-04',
    'host-05',
  ],

  benignRegularHostIds: [
    'host-06',
    'host-07',
    'host-08',
  ],

  benignBurstyHostIds: [
    'host-09',
    'host-10',
    'host-11',
  ],

  // Phase durations
  phase1DurationMs: 3_600_000, // 1 hour
  phase2DurationMs: 3_600_000, // 1 hour

  // Phase 1 — regular beaconing
  phase1IntervalMs: 60_000,   // 60 s base interval
  phase1NoiseMs:     3_000,   // ±3 s noise

  // Phase 2 — jittered + coordinated burst beaconing
  phase2JitterMinMs:   20_000,  //  20 s minimum inter-beacon jitter
  phase2JitterMaxMs:  180_000,  // 180 s maximum inter-beacon jitter
  phase2BurstWindowMs: 10_000,  //  10 s shared burst window
  phase2BurstPeriodMs: 300_000, //   5 min between burst opportunities
};

// ─── Helper ───────────────────────────────────────────────────────────────────

/**
 * Returns the full list of host IDs for a given scenario config.
 *
 * IDs are generated as zero-padded strings: "host-01", "host-02", …, "host-N".
 * The order is ascending and the list always has exactly `config.totalHosts`
 * elements regardless of which hosts appear in the category arrays.
 *
 * @example
 * getAllHostIds(DEFAULT_SCENARIO)
 * // => ["host-01", "host-02", ..., "host-20"]
 */
export function getAllHostIds(config: ScenarioConfig): string[] {
  const padWidth = String(config.totalHosts).length; // e.g. 2 for totalHosts ≤ 99
  return Array.from({ length: config.totalHosts }, (_, i) => {
    const n = String(i + 1).padStart(padWidth, '0');
    return `host-${n}`;
  });
}
