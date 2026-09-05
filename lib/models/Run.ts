import mongoose, { Schema, Document, Model } from 'mongoose';
import { DetectionResult, ConfidenceTimelinePoint } from '../detector';
import { EvaluationResult } from '../evaluator';

/**
 * Interface representing a persisted scenario simulation and detection run in MongoDB.
 */
export interface IRun extends Document {
  createdAt: Date;
  scenarioSeed: number;
  detectionResults: DetectionResult[];
  evaluationResult: EvaluationResult;
  phase1Timeline: ConfidenceTimelinePoint[];
  phase2Timeline: ConfidenceTimelinePoint[];
}

/**
 * Mongoose Schema for Run documents.
 *
 * Design Decision on Raw Events:
 * ──────────────────────────────
 * Raw simulation beacon events (1,934+ events per run) are intentionally
 * omitted from persistence to keep documents lean (<50 KB) and optimize network
 * throughput and MongoDB Atlas storage. Because the PRNG is 100% deterministic,
 * raw events can be re-generated on demand using `scenarioSeed` + `runSimulation()`.
 */
const RunSchema: Schema<IRun> = new Schema<IRun>(
  {
    createdAt: {
      type: Date,
      default: Date.now,
    },
    scenarioSeed: {
      type: Number,
      required: true,
    },
    detectionResults: [
      {
        hostId: { type: String, required: true },
        phase1Score: { type: Number, required: true },
        phase2Score: { type: Number, required: true },
        fusedScore: { type: Number, required: true },
        contained: { type: Boolean, required: true },
      },
    ],
    evaluationResult: {
      truePositives: [{ type: String }],
      falsePositives: [{ type: String }],
      falseNegatives: [{ type: String }],
      trueNegatives: [{ type: String }],
      passed: { type: Boolean, required: true },
    },
    phase1Timeline: [
      {
        timestampMs: { type: Number, required: true },
        hostId: { type: String, required: true },
        score: { type: Number, required: true },
      },
    ],
    phase2Timeline: [
      {
        timestampMs: { type: Number, required: true },
        hostId: { type: String, required: true },
        score: { type: Number, required: true },
      },
    ],
  },
  {
    // Auto-create createdAt / updatedAt if needed, or rely on explicit createdAt
    timestamps: true,
  },
);

const Run: Model<IRun> =
  mongoose.models.Run || mongoose.model<IRun>('Run', RunSchema);

export default Run;
