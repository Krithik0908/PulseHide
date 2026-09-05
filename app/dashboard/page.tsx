'use client';

import React, { useState } from 'react';
import {
  ResponsiveContainer,
  ScatterChart,
  Scatter,
  XAxis,
  YAxis,
  ZAxis,
  Tooltip,
  ReferenceLine,
  CartesianGrid,
  LineChart,
  Line,
  Legend,
} from 'recharts';
import { Activity, Play, RefreshCw, ShieldAlert, ShieldCheck } from 'lucide-react';

interface BeaconEvent {
  hostId: string;
  timestampMs: number;
}

type HostCategory = 'compromised' | 'benignRegular' | 'benignBursty' | 'plainBenign';

interface TimelinePoint {
  timestampMs: number;
  hostId: string;
  score: number;
}

interface ScenarioResponse {
  _id: string;
  scenarioSeed: number;
  phase1DurationMs: number;
  phase2DurationMs: number;
  totalDurationMs: number;
  hostCategories: Record<string, HostCategory>;
  events: BeaconEvent[];
  phase1Timeline: TimelinePoint[];
  phase2Timeline: TimelinePoint[];
  detectionResults: {
    hostId: string;
    phase1Score: number;
    phase2Score: number;
    fusedScore: number;
    contained: boolean;
  }[];
  evaluationResult: {
    truePositives: string[];
    falsePositives: string[];
    falseNegatives: string[];
    trueNegatives: string[];
    passed: boolean;
  };
}

export default function DashboardPage() {
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<ScenarioResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleRunScenario = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/run-scenario', { method: 'POST' });
      if (!res.ok) {
        let errMsg = `Request failed with status ${res.status}`;
        try {
          const errJson = await res.json();
          errMsg = errJson.details || errJson.error || errMsg;
        } catch {
          // If response body is not valid JSON
        }
        throw new Error(errMsg);
      }
      const json: ScenarioResponse = await res.json();
      setData(json);
    } catch (err: unknown) {
      console.error('Scenario execution failed:', err);
      setError(
        err instanceof Error
          ? err.message
          : 'An unexpected network or server error occurred while running the scenario.'
      );
    } finally {
      setLoading(false);
    }
  };

  // Generate 20 host IDs in order (host-01 to host-20)
  const hostIds = Array.from({ length: 20 }, (_, i) => {
    const num = String(i + 1).padStart(2, '0');
    return `host-${num}`;
  });

  // Map each hostId to a y-axis numeric slot:
  // host-01 at top (19) down to host-20 at bottom (0)
  const hostToY = Object.fromEntries(
    hostIds.map((id, index) => [id, hostIds.length - 1 - index])
  );
  const yToHost = Object.fromEntries(
    hostIds.map((id, index) => [hostIds.length - 1 - index, id])
  );

  // Group events by category for customized Scatter series
  const compromisedData: { x: number; y: number; hostId: string; timestampMs: number }[] = [];
  const benignRegularData: { x: number; y: number; hostId: string; timestampMs: number }[] = [];
  const benignBurstyData: { x: number; y: number; hostId: string; timestampMs: number }[] = [];
  const plainBenignData: { x: number; y: number; hostId: string; timestampMs: number }[] = [];

  if (data?.events && data.hostCategories) {
    for (const ev of data.events) {
      const cat = data.hostCategories[ev.hostId] || 'plainBenign';
      const yVal = hostToY[ev.hostId] ?? 0;
      const point = {
        x: ev.timestampMs,
        y: yVal,
        hostId: ev.hostId,
        timestampMs: ev.timestampMs,
      };

      if (cat === 'compromised') compromisedData.push(point);
      else if (cat === 'benignRegular') benignRegularData.push(point);
      else if (cat === 'benignBursty') benignBurstyData.push(point);
      else plainBenignData.push(point);
    }
  }

  // Format timestamp in minutes or HH:MM
  const formatTimeMinutes = (timestampMs: number) => {
    const totalMinutes = Math.round(timestampMs / 60000);
    const hrs = Math.floor(totalMinutes / 60);
    const mins = totalMinutes % 60;
    if (hrs > 0) {
      return `${hrs}h ${mins}m`;
    }
    return `${mins}m`;
  };

  const phase1EndMs = data?.phase1DurationMs ?? 3_600_000;
  const totalDurationMs = data?.totalDurationMs ?? 7_200_000;

  // ── Confidence Timeline: average phase1 & phase2 scores across compromised hosts only ──
  // We group each timeline by timestampMs and compute the mean score across
  // hosts whose category is "compromised", producing one data point per bucket.
  const confidenceChartData: { timestampMs: number; phase1Avg: number | null; phase2Avg: number | null }[] = [];

  if (data?.phase1Timeline && data?.phase2Timeline && data?.hostCategories) {
    // Build per-timestamp average for phase1 (compromised hosts only)
    const p1ByTs = new Map<number, number[]>();
    for (const pt of data.phase1Timeline) {
      if (data.hostCategories[pt.hostId] === 'compromised') {
        if (!p1ByTs.has(pt.timestampMs)) p1ByTs.set(pt.timestampMs, []);
        p1ByTs.get(pt.timestampMs)!.push(pt.score);
      }
    }

    // Build per-timestamp average for phase2 (compromised hosts only)
    const p2ByTs = new Map<number, number[]>();
    for (const pt of data.phase2Timeline) {
      if (data.hostCategories[pt.hostId] === 'compromised') {
        if (!p2ByTs.has(pt.timestampMs)) p2ByTs.set(pt.timestampMs, []);
        p2ByTs.get(pt.timestampMs)!.push(pt.score);
      }
    }

    // Merge all distinct timestamps from both timelines, sorted ascending
    const allTs = Array.from(
      new Set([...p1ByTs.keys(), ...p2ByTs.keys()])
    ).sort((a, b) => a - b);

    for (const ts of allTs) {
      const p1Vals = p1ByTs.get(ts);
      const p2Vals = p2ByTs.get(ts);
      confidenceChartData.push({
        timestampMs: ts,
        phase1Avg: p1Vals && p1Vals.length > 0
          ? p1Vals.reduce((s, v) => s + v, 0) / p1Vals.length
          : null,
        phase2Avg: p2Vals && p2Vals.length > 0
          ? p2Vals.reduce((s, v) => s + v, 0) / p2Vals.length
          : null,
      });
    }
  }

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 p-6 md:p-10 flex flex-col gap-6 font-sans">
      {/* Top Header & Action */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-zinc-800/80 pb-6">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400">
            <Activity className="w-6 h-6" />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-zinc-100 flex items-center gap-2">
              PulseHide
              <span className="text-xs px-2.5 py-0.5 rounded-full bg-zinc-800 text-zinc-400 border border-zinc-700/50">
                Beacon Timeline
              </span>
            </h1>
            <p className="text-sm text-zinc-400">
              C2 Beacon Simulation, Interval Analysis & Multi-Host Coordinated Burst Detection
            </p>
          </div>
        </div>

        <button
          onClick={handleRunScenario}
          disabled={loading}
          className="inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl bg-red-600 hover:bg-red-500 disabled:bg-zinc-800 disabled:text-zinc-500 text-white font-medium text-sm transition-all shadow-lg shadow-red-950/40 hover:shadow-red-900/50 disabled:shadow-none cursor-pointer disabled:cursor-not-allowed"
        >
          {loading ? (
            <>
              <RefreshCw className="w-4 h-4 animate-spin" />
              Running Simulation...
            </>
          ) : (
            <>
              <Play className="w-4 h-4 fill-current" />
              Run Scenario
            </>
          )}
        </button>
      </div>

      {/* Error state */}
      {error && (
        <div className="p-4 sm:p-5 rounded-2xl bg-red-950/30 border border-red-900/60 text-red-200 text-sm flex flex-col sm:flex-row sm:items-center justify-between gap-4 shadow-lg shadow-red-950/20">
          <div className="flex items-start sm:items-center gap-3">
            <div className="p-2 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 flex-shrink-0 mt-0.5 sm:mt-0">
              <ShieldAlert className="w-5 h-5" />
            </div>
            <div className="flex flex-col gap-0.5">
              <span className="font-semibold text-red-300 text-xs uppercase tracking-wider">
                Simulation Execution Failed
              </span>
              <span className="text-zinc-300 text-sm">{error}</span>
            </div>
          </div>
          <button
            onClick={handleRunScenario}
            disabled={loading}
            className="inline-flex items-center justify-center gap-2 px-4 py-2 rounded-xl bg-red-600/80 hover:bg-red-500 text-white font-medium text-xs transition-all border border-red-500/30 shadow-sm cursor-pointer disabled:cursor-not-allowed disabled:opacity-50 self-start sm:self-auto flex-shrink-0"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            Retry
          </button>
        </div>
      )}

      {/* Initial Empty State */}
      {!data && !loading && !error && (
        <div className="flex flex-col items-center justify-center py-24 px-4 rounded-2xl bg-zinc-900/40 border border-zinc-800/60 text-center">
          <div className="p-4 rounded-2xl bg-zinc-900 border border-zinc-800 text-zinc-500 mb-4">
            <Activity className="w-10 h-10" />
          </div>
          <h2 className="text-lg font-semibold text-zinc-200 mb-1">No Scenario Active</h2>
          <p className="text-sm text-zinc-400 max-w-md mb-6">
            Click &ldquo;Run Scenario&rdquo; to execute the deterministic beacon simulation and visualize
            per-host traffic patterns across both phases.
          </p>
          <button
            onClick={handleRunScenario}
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-100 font-medium text-sm transition-colors border border-zinc-700"
          >
            <Play className="w-4 h-4 fill-current" />
            Launch Default Simulation (Seed 42)
          </button>
        </div>
      )}

      {/* Main Timeline Chart Container */}
      {data && (
        <div className="flex flex-col gap-4 rounded-2xl bg-zinc-900/60 border border-zinc-800/80 p-6 shadow-xl">
          {/* Legend & Summary Info */}
          <div className="flex flex-wrap items-center justify-between gap-4 pb-4 border-b border-zinc-800/60 text-xs">
            <div className="flex flex-wrap items-center gap-4">
              <span className="font-semibold text-zinc-400 uppercase tracking-wider">Host Categories:</span>
              <div className="flex items-center gap-1.5">
                <span className="w-3 h-3 rounded-full bg-red-500 shadow-sm shadow-red-500/50" />
                <span className="text-zinc-200">Compromised (host-01 – 05)</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="w-3 h-3 rounded-full bg-orange-500 shadow-sm shadow-orange-500/50" />
                <span className="text-zinc-200">Benign-Regular (host-06 – 08)</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="w-3 h-3 rounded-full bg-blue-500 shadow-sm shadow-blue-500/50" />
                <span className="text-zinc-200">Benign-Bursty (host-09 – 11)</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="w-3 h-3 rounded-full bg-zinc-400" />
                <span className="text-zinc-300">Plain Benign (host-12 – 20)</span>
              </div>
            </div>

            <div className="flex items-center gap-3 text-zinc-400">
              <span>Seed: <strong className="text-zinc-200">{data.scenarioSeed}</strong></span>
              <span>•</span>
              <span>Total Beacons: <strong className="text-zinc-200">{data.events.length}</strong></span>
              <span>•</span>
              <span className="flex items-center gap-1">
                Evaluator:{' '}
                {data.evaluationResult?.passed ? (
                  <span className="inline-flex items-center gap-1 text-emerald-400 font-semibold">
                    <ShieldCheck className="w-3.5 h-3.5" /> PASSED
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 text-red-400 font-semibold">
                    <ShieldAlert className="w-3.5 h-3.5" /> FAILED
                  </span>
                )}
              </span>
            </div>
          </div>

          {/* Scatter Chart */}
          <div className="w-full h-[650px] pt-4">
            <ResponsiveContainer width="100%" height="100%">
              <ScatterChart
                margin={{ top: 20, right: 30, bottom: 30, left: 30 }}
              >
                <CartesianGrid
                  strokeDasharray="3 3"
                  stroke="#27272a"
                  horizontal={true}
                  vertical={false}
                />
                
                {/* Time X-Axis */}
                <XAxis
                  type="number"
                  dataKey="x"
                  name="Time"
                  domain={[0, totalDurationMs]}
                  tickFormatter={formatTimeMinutes}
                  stroke="#71717a"
                  tick={{ fill: '#a1a1aa', fontSize: 12 }}
                  unit=""
                />

                {/* Host Y-Axis (20 rows) */}
                <YAxis
                  type="number"
                  dataKey="y"
                  name="Host"
                  domain={[-0.5, 19.5]}
                  ticks={Array.from({ length: 20 }, (_, i) => i)}
                  tickFormatter={(val) => yToHost[val] ?? ''}
                  stroke="#71717a"
                  tick={{ fill: '#a1a1aa', fontSize: 12, fontWeight: 500 }}
                  interval={0}
                  width={75}
                />

                <ZAxis type="number" range={[20, 20]} />

                {/* Custom Tooltip */}
                <Tooltip
                  cursor={{ strokeDasharray: '3 3', stroke: '#52525b' }}
                  content={({ payload }) => {
                    if (!payload || payload.length === 0) return null;
                    const p = payload[0].payload;
                    const cat = data.hostCategories[p.hostId] || 'plainBenign';
                    return (
                      <div className="p-3 rounded-lg bg-zinc-900 border border-zinc-700 text-zinc-100 text-xs shadow-xl space-y-1">
                        <div className="font-bold text-sm text-zinc-100">{p.hostId}</div>
                        <div className="text-zinc-400">
                          Category:{' '}
                          <span className="font-semibold text-zinc-200 capitalize">
                            {cat === 'compromised'
                              ? 'Compromised (C2)'
                              : cat === 'benignRegular'
                              ? 'Benign-Regular (Trap)'
                              : cat === 'benignBursty'
                              ? 'Benign-Bursty'
                              : 'Plain Benign'}
                          </span>
                        </div>
                        <div className="text-zinc-400">
                          Timestamp: <span className="font-mono text-zinc-200">{p.timestampMs} ms</span> ({formatTimeMinutes(p.timestampMs)})
                        </div>
                        <div className="text-zinc-400">
                          Phase:{' '}
                          <span
                            className={`font-semibold ${
                              p.timestampMs < phase1EndMs ? 'text-amber-400' : 'text-purple-400'
                            }`}
                          >
                            {p.timestampMs < phase1EndMs ? 'Phase 1 (Regular)' : 'Phase 2 (Coordinated / Jitter)'}
                          </span>
                        </div>
                      </div>
                    );
                  }}
                />

                {/* Phase Transition Vertical Reference Line */}
                <ReferenceLine
                  x={phase1EndMs}
                  stroke="#f59e0b"
                  strokeDasharray="5 5"
                  strokeWidth={2}
                  label={{
                    value: 'Phase Transition (1h)',
                    position: 'top',
                    fill: '#fbbf24',
                    fontSize: 12,
                    fontWeight: 600,
                  }}
                />

                {/* 4 Scatter Series with designated colors */}
                <Scatter
                  name="Compromised"
                  data={compromisedData}
                  fill="#ef4444"
                  shape="circle"
                />
                <Scatter
                  name="Benign-Regular"
                  data={benignRegularData}
                  fill="#f97316"
                  shape="circle"
                />
                <Scatter
                  name="Benign-Bursty"
                  data={benignBurstyData}
                  fill="#3b82f6"
                  shape="circle"
                />
                <Scatter
                  name="Plain Benign"
                  data={plainBenignData}
                  fill="#9ca3af"
                  shape="circle"
                />
              </ScatterChart>
            </ResponsiveContainer>
          </div>

          {/* ── Detection Confidence Over Time ── */}
          {confidenceChartData.length > 0 && (
            <div className="flex flex-col gap-3 rounded-2xl bg-zinc-900/60 border border-zinc-800/80 p-6 shadow-xl mt-2">
              {/* Title */}
              <div>
                <h2 className="text-base font-semibold text-zinc-100 tracking-tight flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-teal-400 shadow-sm shadow-teal-400/60" />
                  Detection Confidence Over Time
                </h2>
                <p className="text-xs text-zinc-500 mt-1">
                  Phase-1 and Phase-2 use independent scales (see axis labels) — raw values are unchanged from detection.
                </p>
              </div>

              {/* Line Chart */}
              <div className="w-full h-[260px] pt-2">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart
                    data={confidenceChartData}
                    margin={{ top: 10, right: 65, bottom: 20, left: 15 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />

                    <XAxis
                      type="number"
                      dataKey="timestampMs"
                      domain={[0, totalDurationMs]}
                      scale="linear"
                      tickFormatter={formatTimeMinutes}
                      stroke="#71717a"
                      tick={{ fill: '#a1a1aa', fontSize: 12 }}
                    />

                    {/* Left axis — Phase-1 Regularity, fixed [0, 1] */}
                    <YAxis
                      yAxisId="left"
                      orientation="left"
                      domain={[0, 1]}
                      stroke="#f97316"
                      tick={{ fill: '#fdba74', fontSize: 11 }}
                      tickFormatter={(v: number) => v.toFixed(1)}
                      label={{
                        value: 'Phase-1 Regularity',
                        angle: -90,
                        position: 'insideLeft',
                        fill: '#f97316',
                        fontSize: 11,
                        dy: 50,
                      }}
                      width={45}
                    />

                    {/* Right axis — Phase-2 Correlation, auto-scale */}
                    <YAxis
                      yAxisId="right"
                      orientation="right"
                      domain={[0, 'auto']}
                      stroke="#2dd4bf"
                      tick={{ fill: '#5eead4', fontSize: 11 }}
                      tickFormatter={(v: number) => v.toFixed(3)}
                      label={{
                        value: 'Phase-2 Correlation',
                        angle: 90,
                        position: 'insideRight',
                        fill: '#2dd4bf',
                        fontSize: 11,
                        dy: 50,
                      }}
                      width={55}
                    />

                    <Tooltip
                      content={({ payload, label }) => {
                        if (!payload || payload.length === 0) return null;
                        return (
                          <div className="p-3 rounded-lg bg-zinc-900 border border-zinc-700 text-xs shadow-xl space-y-1">
                            <div className="text-zinc-400 font-medium">
                              {formatTimeMinutes(label as number)}
                            </div>
                            {payload.map((entry) => (
                              <div
                                key={entry.dataKey as string}
                                className="flex items-center gap-2"
                                style={{ color: entry.color }}
                              >
                                <span
                                  className="w-2 h-2 rounded-full flex-shrink-0"
                                  style={{ background: entry.color as string }}
                                />
                                <span className="text-zinc-300">
                                  {entry.name}:{' '}
                                  <span className="font-mono font-semibold">
                                    {typeof entry.value === 'number'
                                      ? entry.value.toFixed(4)
                                      : '—'}
                                  </span>
                                </span>
                              </div>
                            ))}
                          </div>
                        );
                      }}
                    />

                    <Legend
                      verticalAlign="top"
                      align="right"
                      wrapperStyle={{ fontSize: '12px', paddingBottom: '8px' }}
                      formatter={(value) => (
                        <span style={{ color: '#a1a1aa' }}>{value}</span>
                      )}
                    />

                    {/* Phase transition reference line */}
                    <ReferenceLine
                      yAxisId="left"
                      x={phase1EndMs}
                      stroke="#f59e0b"
                      strokeDasharray="5 5"
                      strokeWidth={2}
                      label={{
                        value: 'Phase Transition',
                        position: 'insideTopRight',
                        fill: '#fbbf24',
                        fontSize: 11,
                        fontWeight: 600,
                      }}
                    />

                    {/* Phase-1 regularity signal — orange, left axis */}
                    <Line
                      yAxisId="left"
                      type="monotone"
                      dataKey="phase1Avg"
                      name="Phase-1 Signal (regularity)"
                      stroke="#f97316"
                      strokeWidth={2}
                      dot={false}
                      activeDot={{ r: 4, strokeWidth: 0 }}
                      connectNulls
                    />

                    {/* Phase-2 correlation signal — teal, right axis */}
                    <Line
                      yAxisId="right"
                      type="monotone"
                      dataKey="phase2Avg"
                      name="Phase-2 Signal (correlation)"
                      stroke="#2dd4bf"
                      strokeWidth={2}
                      dot={false}
                      activeDot={{ r: 4, strokeWidth: 0 }}
                      connectNulls
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}

          {/* ── Containment Results Section ── */}
          {data.detectionResults && (
            <div className="flex flex-col gap-6 rounded-2xl bg-zinc-900/60 border border-zinc-800/80 p-6 shadow-xl mt-2">
              {/* Section Header */}
              <div className="flex flex-col gap-1 border-b border-zinc-800/60 pb-4">
                <h2 className="text-lg font-bold text-zinc-100 tracking-tight flex items-center gap-2">
                  <ShieldAlert className="w-5 h-5 text-red-400" />
                  Containment Results
                </h2>
                <p className="text-xs text-zinc-400">
                  Per-host fused detection scores, categorization, and automated containment actions.
                </p>
              </div>

              {/* Summary Banner */}
              <div className="flex flex-col lg:flex-row items-stretch lg:items-center justify-between gap-4 p-4 rounded-xl bg-zinc-950/70 border border-zinc-800">
                {/* Large PASS/FAIL Badge */}
                <div className="flex items-center gap-4">
                  {data.evaluationResult?.passed ? (
                    <div className="inline-flex items-center gap-2.5 px-5 py-3 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-400">
                      <ShieldCheck className="w-7 h-7 flex-shrink-0" />
                      <div>
                        <div className="text-xs font-semibold uppercase tracking-wider text-emerald-500">Evaluation</div>
                        <div className="text-xl font-black tracking-wide">PASS</div>
                      </div>
                    </div>
                  ) : (
                    <div className="inline-flex items-center gap-2.5 px-5 py-3 rounded-xl bg-red-500/10 border border-red-500/30 text-red-400">
                      <ShieldAlert className="w-7 h-7 flex-shrink-0" />
                      <div>
                        <div className="text-xs font-semibold uppercase tracking-wider text-red-500">Evaluation</div>
                        <div className="text-xl font-black tracking-wide">FAIL</div>
                      </div>
                    </div>
                  )}

                  {/* 4 Counters */}
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                    <div className="px-3.5 py-2 rounded-lg bg-zinc-900 border border-zinc-800 flex flex-col">
                      <span className="text-[10px] uppercase font-semibold text-zinc-400">True Positives</span>
                      <span className="text-lg font-bold text-emerald-400">
                        {data.evaluationResult?.truePositives?.length ?? 0}
                      </span>
                    </div>
                    <div className="px-3.5 py-2 rounded-lg bg-zinc-900 border border-zinc-800 flex flex-col">
                      <span className="text-[10px] uppercase font-semibold text-zinc-400">False Positives</span>
                      <span className={`text-lg font-bold ${
                        (data.evaluationResult?.falsePositives?.length ?? 0) > 0 ? 'text-red-400' : 'text-zinc-200'
                      }`}>
                        {data.evaluationResult?.falsePositives?.length ?? 0}
                      </span>
                    </div>
                    <div className="px-3.5 py-2 rounded-lg bg-zinc-900 border border-zinc-800 flex flex-col">
                      <span className="text-[10px] uppercase font-semibold text-zinc-400">False Negatives</span>
                      <span className={`text-lg font-bold ${
                        (data.evaluationResult?.falseNegatives?.length ?? 0) > 0 ? 'text-red-400' : 'text-zinc-200'
                      }`}>
                        {data.evaluationResult?.falseNegatives?.length ?? 0}
                      </span>
                    </div>
                    <div className="px-3.5 py-2 rounded-lg bg-zinc-900 border border-zinc-800 flex flex-col">
                      <span className="text-[10px] uppercase font-semibold text-zinc-400">True Negatives</span>
                      <span className="text-lg font-bold text-zinc-200">
                        {data.evaluationResult?.trueNegatives?.length ?? 0}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Narrative Note Callout */}
                <div className="text-xs text-zinc-400 bg-zinc-900/90 border border-zinc-800 rounded-xl px-4 py-3 max-w-md">
                  <span className="text-amber-400 font-semibold">Note:&nbsp;</span>
                  Detection uses adaptive phase-2 correlation once phase-1 regularity becomes uninformative (see confidence chart above).
                </div>
              </div>

              {/* Table */}
              <div className="overflow-x-auto rounded-xl border border-zinc-800">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="bg-zinc-950/80 border-b border-zinc-800 text-zinc-400 font-semibold uppercase tracking-wider text-[11px]">
                      <th className="py-3 px-4">Host ID</th>
                      <th className="py-3 px-4">Category</th>
                      <th className="py-3 px-4 text-right">Phase-1 Score</th>
                      <th className="py-3 px-4 text-right">Phase-2 Score</th>
                      <th className="py-3 px-4 text-right">Fused Score</th>
                      <th className="py-3 px-4 text-center">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-800/60 bg-zinc-900/30">
                    {(() => {
                      const categoryPriority: Record<HostCategory, number> = {
                        compromised: 0,
                        benignRegular: 1,
                        benignBursty: 2,
                        plainBenign: 3,
                      };

                      const sorted = [...data.detectionResults].sort((a, b) => {
                        const catA = data.hostCategories[a.hostId] || 'plainBenign';
                        const catB = data.hostCategories[b.hostId] || 'plainBenign';
                        const prioA = categoryPriority[catA] ?? 99;
                        const prioB = categoryPriority[catB] ?? 99;
                        if (prioA !== prioB) {
                          return prioA - prioB;
                        }
                        return b.fusedScore - a.fusedScore;
                      });

                      return sorted.map((row) => {
                        const category = data.hostCategories[row.hostId] || 'plainBenign';
                        return (
                          <tr
                            key={row.hostId}
                            className="hover:bg-zinc-800/40 transition-colors"
                          >
                            <td className="py-2.5 px-4 font-mono font-semibold text-zinc-200">
                              {row.hostId}
                            </td>
                            <td className="py-2.5 px-4">
                              {category === 'compromised' && (
                                <span className="inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-medium bg-red-500/10 text-red-400 border border-red-500/20">
                                  Compromised
                                </span>
                              )}
                              {category === 'benignRegular' && (
                                <span className="inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-medium bg-orange-500/10 text-orange-400 border border-orange-500/20">
                                  Benign-Regular
                                </span>
                              )}
                              {category === 'benignBursty' && (
                                <span className="inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-medium bg-blue-500/10 text-blue-400 border border-blue-500/20">
                                  Benign-Bursty
                                </span>
                              )}
                              {category === 'plainBenign' && (
                                <span className="inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-medium bg-zinc-800 text-zinc-300 border border-zinc-700/60">
                                  Plain Benign
                                </span>
                              )}
                            </td>
                            <td className="py-2.5 px-4 text-right font-mono text-zinc-300">
                              {row.phase1Score.toFixed(4)}
                            </td>
                            <td className="py-2.5 px-4 text-right font-mono text-zinc-300">
                              {row.phase2Score.toFixed(4)}
                            </td>
                            <td className="py-2.5 px-4 text-right font-mono font-bold text-zinc-100">
                              {row.fusedScore.toFixed(4)}
                            </td>
                            <td className="py-2.5 px-4 text-center">
                              {row.contained ? (
                                <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-red-500/15 text-red-400 border border-red-500/30">
                                  <span className="w-1.5 h-1.5 rounded-full bg-red-400" />
                                  Contained
                                </span>
                              ) : (
                                <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">
                                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                                  Reachable
                                </span>
                              )}
                            </td>
                          </tr>
                        );
                      });
                    })()}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
