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
 * run into MongoDB and returning the saved document.
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

    // 4. Persist run document to MongoDB
    // Note: raw events (1,934 items) are omitted to keep document size lean (<50 KB)
    const runDoc = await Run.create({
      scenarioSeed: DEFAULT_SCENARIO.seed,
      detectionResults,
      evaluationResult,
      phase1Timeline,
      phase2Timeline,
    });

    // 5. Return persisted document
    return NextResponse.json(runDoc, { status: 201 });
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
