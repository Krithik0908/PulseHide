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
} from 'recharts';
import { Activity, Play, RefreshCw, ShieldAlert, ShieldCheck } from 'lucide-react';

interface BeaconEvent {
  hostId: string;
  timestampMs: number;
}

type HostCategory = 'compromised' | 'benignRegular' | 'benignBursty' | 'plainBenign';

interface ScenarioResponse {
  _id: string;
  scenarioSeed: number;
  phase1DurationMs: number;
  phase2DurationMs: number;
  totalDurationMs: number;
  hostCategories: Record<string, HostCategory>;
  events: BeaconEvent[];
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
        const errJson = await res.json();
        throw new Error(errJson.details || errJson.error || 'Failed to run scenario');
      }
      const json: ScenarioResponse = await res.json();
      setData(json);
    } catch (err: unknown) {
      console.error(err);
      setError(err instanceof Error ? err.message : 'Unknown error occurred');
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
        <div className="p-4 rounded-xl bg-red-950/40 border border-red-800/60 text-red-300 text-sm flex items-center gap-3">
          <ShieldAlert className="w-5 h-5 flex-shrink-0 text-red-400" />
          <span>{error}</span>
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
        </div>
      )}
    </div>
  );
}
