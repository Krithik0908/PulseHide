import { NextResponse } from 'next/server';
import dbConnect from '@/lib/db';
import Run from '@/lib/models/Run';
import { runSimulation, getGroundTruth } from '@/lib/simulator';
import { DEFAULT_SCENARIO, getAllHostIds } from '@/lib/types';
import {
  runDetection,
  getPhase1ConfidenceTimeline,
  getPhase2ConfidenceTimeline,
} from '@/lib/detector';
import { evaluate } from '@/lib/evaluator';

/**
 * POST /api/run-scenario
 *
 * Runs the end-to-end beacon simulation, multi-phase detection, evaluation,
 * and temporal timeline generators on DEFAULT_SCENARIO, persisting the resulting
 * run into MongoDB and returning the document augmented with raw events and
 * categorized host metadata for frontend visual rendering.
 */
export async function POST() {
  try {
    // 1. Establish cached MongoDB connection
    await dbConnect();

    // 2. Run deterministic simulation & detection pipeline
    const events = runSimulation(DEFAULT_SCENARIO);
    const detectionResults = runDetection(events, DEFAULT_SCENARIO);
    const groundTruth = getGroundTruth(DEFAULT_SCENARIO);
    const evaluationResult = evaluate(detectionResults, groundTruth);

    // 3. Compute confidence timelines
    // Timeline window parameters:
    // • windowSizeMs = 300,000 ms (5 minutes): captures ~5 base beacon cycles for stable variance estimation.
    // • stepMs = 60,000 ms (1 minute): creates 1-minute step increments for high-fidelity time-series charting.
    const allHostIds = getAllHostIds(DEFAULT_SCENARIO);
    const windowSizeMs = 300_000;
    const stepMs = 60_000;

    const phase1Timeline = getPhase1ConfidenceTimeline(
      events,
      allHostIds,
      DEFAULT_SCENARIO,
      windowSizeMs,
      stepMs,
    );

    const phase2Timeline = getPhase2ConfidenceTimeline(
      events,
      allHostIds,
      DEFAULT_SCENARIO,
      windowSizeMs,
      stepMs,
    );

    // 4. Derive host categories lookup for frontend rendering
    const compromisedSet = new Set(DEFAULT_SCENARIO.compromisedHostIds);
    const benignRegularSet = new Set(DEFAULT_SCENARIO.benignRegularHostIds);
    const benignBurstySet = new Set(DEFAULT_SCENARIO.benignBurstyHostIds);

    const hostCategories: Record<
      string,
      'compromised' | 'benignRegular' | 'benignBursty' | 'plainBenign'
    > = {};

    for (const hostId of allHostIds) {
      if (compromisedSet.has(hostId)) {
        hostCategories[hostId] = 'compromised';
      } else if (benignRegularSet.has(hostId)) {
        hostCategories[hostId] = 'benignRegular';
      } else if (benignBurstySet.has(hostId)) {
        hostCategories[hostId] = 'benignBursty';
      } else {
        hostCategories[hostId] = 'plainBenign';
      }
    }

    // 5. Persist run document to MongoDB
    // Note: raw events (1,934 items) are omitted from MongoDB to keep document size lean (<50 KB)
    const runDoc = await Run.create({
      scenarioSeed: DEFAULT_SCENARIO.seed,
      detectionResults,
      evaluationResult,
      phase1Timeline,
      phase2Timeline,
    });

    // 6. Return persisted document augmented with events & categories in the response JSON
    return NextResponse.json(
      {
        ...runDoc.toObject(),
        events,
        hostCategories,
        phase1DurationMs: DEFAULT_SCENARIO.phase1DurationMs,
        phase2DurationMs: DEFAULT_SCENARIO.phase2DurationMs,
        totalDurationMs:
          DEFAULT_SCENARIO.phase1DurationMs + DEFAULT_SCENARIO.phase2DurationMs,
      },
      { status: 201 },
    );
  } catch (error: unknown) {
    console.error('Error running scenario API:', error);
    const errorMessage =
      error instanceof Error ? error.message : 'Unknown server error';
    return NextResponse.json(
      {
        error: 'Failed to execute and persist scenario run',
        details: errorMessage,
      },
      { status: 500 },
    );
  }
}
