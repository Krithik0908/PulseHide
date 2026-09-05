import { runSimulation, getGroundTruth } from '../lib/simulator';
import { DEFAULT_SCENARIO } from '../lib/types';
import { runDetection } from '../lib/detector';
import { evaluate } from '../lib/evaluator';

/**
 * PulseHide End-to-End Pipeline Verification Script
 *
 * Verifies:
 *  1. Simulation Determinism (runSimulation called twice produces byte-identical output)
 *  2. Full Pipeline Execution (Simulator -> Detector -> Evaluator)
 *  3. Containment Accuracy (Exact match against Ground Truth compromised hosts)
 *  4. Evaluator Pass Status (0 False Positives & 0 False Negatives)
 */
function runPipelineVerification(): void {
  console.log('================================================================');
  console.log('            PULSEHIDE PIPELINE INTEGRATION TEST                 ');
  console.log('================================================================\n');

  let allChecksPassed = true;

  // ─── 1. Determinism Check ──────────────────────────────────────────────────
  console.log('1. Checking Simulation Determinism...');
  const run1 = runSimulation(DEFAULT_SCENARIO);
  const run2 = runSimulation(DEFAULT_SCENARIO);

  const run1Json = JSON.stringify(run1);
  const run2Json = JSON.stringify(run2);
  const isDeterministic = run1Json === run2Json;

  if (isDeterministic) {
    console.log(`   ✅ PASS: Both runs produced byte-identical output (${run1.length} events)`);
  } else {
    console.error('   ❌ FAIL: Simulation output is non-deterministic!');
    allChecksPassed = false;
  }

  // ─── 2. Run Detection & Evaluation Pipeline ────────────────────────────────
  console.log('\n2. Running Detection Pipeline & Evaluator on DEFAULT_SCENARIO...');
  const detectionResults = runDetection(run1, DEFAULT_SCENARIO);
  const groundTruth = getGroundTruth(DEFAULT_SCENARIO);
  const evalResult = evaluate(detectionResults, groundTruth);

  // ─── 3. Contained Host Set Comparison ──────────────────────────────────────
  console.log('\n3. Verifying Contained Host Set vs Ground Truth...');
  const containedHosts = detectionResults
    .filter((r) => r.contained)
    .map((r) => r.hostId)
    .sort();

  const expectedCompromised = [...DEFAULT_SCENARIO.compromisedHostIds].sort();

  const isExactSetMatch =
    containedHosts.length === expectedCompromised.length &&
    containedHosts.every((id, idx) => id === expectedCompromised[idx]);

  console.log(`   • Contained Hosts:     [${containedHosts.join(', ')}]`);
  console.log(`   • Ground-Truth Hosts:  [${expectedCompromised.join(', ')}]`);

  if (isExactSetMatch) {
    console.log('   ✅ PASS: Contained hosts exactly match compromisedHostIds');
  } else {
    console.error('   ❌ FAIL: Contained host set does not match ground truth!');
    allChecksPassed = false;
  }

  // ─── 4. Evaluation Metrics Check ───────────────────────────────────────────
  console.log('\n4. Verifying Evaluator Passed Status & Metrics...');
  console.log(`   • True Positives (${evalResult.truePositives.length}):  [${evalResult.truePositives.join(', ')}]`);
  console.log(`   • False Positives (${evalResult.falsePositives.length}): [${evalResult.falsePositives.join(', ')}]`);
  console.log(`   • False Negatives (${evalResult.falseNegatives.length}): [${evalResult.falseNegatives.join(', ')}]`);
  console.log(`   • True Negatives (${evalResult.trueNegatives.length}):  [${evalResult.trueNegatives.join(', ')}]`);
  console.log(`   • Evaluator Passed:     ${evalResult.passed}`);

  if (
    evalResult.passed === true &&
    evalResult.falsePositives.length === 0 &&
    evalResult.falseNegatives.length === 0
  ) {
    console.log('   ✅ PASS: evaluate() passed === true (0 FP, 0 FN)');
  } else {
    console.error('   ❌ FAIL: evaluate() did not pass!');
    allChecksPassed = false;
  }

  // ─── Summary ───────────────────────────────────────────────────────────────
  console.log('\n================================================================');
  if (allChecksPassed) {
    console.log('          🎉 ALL PIPELINE VERIFICATION CHECKS PASSED           ');
    console.log('================================================================\n');
  } else {
    console.error('          ❌ SOME PIPELINE VERIFICATION CHECKS FAILED          ');
    console.log('================================================================\n');
    process.exit(1);
  }
}

runPipelineVerification();
