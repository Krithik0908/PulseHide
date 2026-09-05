'use client';

import React, { useState, useEffect, useMemo } from 'react';
import Image from 'next/image';
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
import { Play, RefreshCw, ShieldAlert, ShieldCheck, ArrowLeft } from 'lucide-react';
import KineticMatrix from '@/components/ui/kinetic-matrix';

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
  detectedTransitionMs?: number | null;
  actualTransitionMs?: number;
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
    detectedTransitionMs?: number | null;
  }[];
  evaluationResult: {
    truePositives: string[];
    falsePositives: string[];
    falseNegatives: string[];
    trueNegatives: string[];
    passed: boolean;
  };
}

const LOADING_STEPS = [
  'Simulating 20-host network traffic...',
  'Analyzing beacon timing & entropy...',
  'Correlating cross-host phase transitions...',
  'Computing containment decisions...',
];

export default function DashboardPage() {
  const [initialLoading, setInitialLoading] = useState(true);
  const [loadingFadeOut, setLoadingFadeOut] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loadingStepIndex, setLoadingStepIndex] = useState(0);
  const [data, setData] = useState<ScenarioResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [activeSection, setActiveSection] = useState<string>('beacon-timeline');

  // Initial presentational reveal loading screen (runs once on first load only)
  useEffect(() => {
    const fadeTimer = setTimeout(() => {
      setLoadingFadeOut(true);
    }, 1200);
    const unmountTimer = setTimeout(() => {
      setInitialLoading(false);
    }, 1600);
    return () => {
      clearTimeout(fadeTimer);
      clearTimeout(unmountTimer);
    };
  }, []);

  // Cycling status messages during scenario data fetch
  useEffect(() => {
    if (!loading) {
      setLoadingStepIndex(0);
      return;
    }
    const interval = setInterval(() => {
      setLoadingStepIndex((prev) => (prev + 1) % LOADING_STEPS.length);
    }, 1000);
    return () => clearInterval(interval);
  }, [loading]);

  // Lightweight IntersectionObserver for scrollspy without main-thread scroll listener overhead
  useEffect(() => {
    if (!data) return;

    const sectionIds = ['beacon-timeline', 'confidence', 'results'];

    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter((e) => e.isIntersecting);
        if (visible.length > 0) {
          visible.sort(
            (a, b) =>
              Math.abs(a.boundingClientRect.top - 140) -
              Math.abs(b.boundingClientRect.top - 140)
          );
          const topVisibleId = visible[0].target.id;
          setActiveSection((prev) => (prev === topVisibleId ? prev : topVisibleId));
        }
      },
      {
        rootMargin: '-80px 0px -50% 0px',
        threshold: [0, 0.1, 0.25, 0.5, 0.75, 1],
      }
    );

    sectionIds.forEach((id) => {
      const el = document.getElementById(id);
      if (el) observer.observe(el);
    });

    // Throttled bottom-of-page edge case check via requestAnimationFrame
    let ticking = false;
    const handleScroll = () => {
      if (!ticking) {
        window.requestAnimationFrame(() => {
          if (
            window.innerHeight + window.scrollY >=
            document.documentElement.scrollHeight - 50
          ) {
            setActiveSection((prev) => (prev === 'results' ? prev : 'results'));
          }
          ticking = false;
        });
        ticking = true;
      }
    };

    window.addEventListener('scroll', handleScroll, { passive: true });

    return () => {
      observer.disconnect();
      window.removeEventListener('scroll', handleScroll);
    };
  }, [data]);

  const handleReset = () => {
    setData(null);
    setError(null);
    setActiveSection('beacon-timeline');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

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
  const hostIds = useMemo(
    () => Array.from({ length: 20 }, (_, i) => `host-${String(i + 1).padStart(2, '0')}`),
    []
  );

  // Map each hostId to a y-axis numeric slot
  const { hostToY, yToHost } = useMemo(() => {
    const toY: Record<string, number> = {};
    const toHost: Record<number, string> = {};
    hostIds.forEach((id, index) => {
      const y = hostIds.length - 1 - index;
      toY[id] = y;
      toHost[y] = id;
    });
    return { hostToY: toY, yToHost: toHost };
  }, [hostIds]);

  // Group events by category for Scatter series (memoized to avoid recomputation during scroll / activeSection changes)
  const { compromisedData, benignRegularData, benignBurstyData, plainBenignData } = useMemo(() => {
    const compromised: { x: number; y: number; hostId: string; timestampMs: number }[] = [];
    const benignRegular: { x: number; y: number; hostId: string; timestampMs: number }[] = [];
    const benignBursty: { x: number; y: number; hostId: string; timestampMs: number }[] = [];
    const plainBenign: { x: number; y: number; hostId: string; timestampMs: number }[] = [];

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

        if (cat === 'compromised') compromised.push(point);
        else if (cat === 'benignRegular') benignRegular.push(point);
        else if (cat === 'benignBursty') benignBursty.push(point);
        else plainBenign.push(point);
      }
    }

    return {
      compromisedData: compromised,
      benignRegularData: benignRegular,
      benignBurstyData: benignBursty,
      plainBenignData: plainBenign,
    };
  }, [data, hostToY]);

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

  // Confidence Timeline data (memoized to eliminate frame drops during activeSection re-renders)
  const confidenceChartData = useMemo(() => {
    const chartData: { timestampMs: number; phase1Avg: number | null; phase2Avg: number | null }[] = [];

    if (data?.phase1Timeline && data?.phase2Timeline && data?.hostCategories) {
      const p1ByTs = new Map<number, number[]>();
      for (const pt of data.phase1Timeline) {
        if (data.hostCategories[pt.hostId] === 'compromised') {
          if (!p1ByTs.has(pt.timestampMs)) p1ByTs.set(pt.timestampMs, []);
          p1ByTs.get(pt.timestampMs)!.push(pt.score);
        }
      }

      const p2ByTs = new Map<number, number[]>();
      for (const pt of data.phase2Timeline) {
        if (data.hostCategories[pt.hostId] === 'compromised') {
          if (!p2ByTs.has(pt.timestampMs)) p2ByTs.set(pt.timestampMs, []);
          p2ByTs.get(pt.timestampMs)!.push(pt.score);
        }
      }

      const allTs = Array.from(
        new Set([...Array.from(p1ByTs.keys()), ...Array.from(p2ByTs.keys())])
      ).sort((a, b) => a - b);

      for (const ts of allTs) {
        const p1Vals = p1ByTs.get(ts);
        const p2Vals = p2ByTs.get(ts);
        chartData.push({
          timestampMs: ts,
          phase1Avg:
            p1Vals && p1Vals.length > 0
              ? p1Vals.reduce((s, v) => s + v, 0) / p1Vals.length
              : null,
          phase2Avg:
            p2Vals && p2Vals.length > 0
              ? p2Vals.reduce((s, v) => s + v, 0) / p2Vals.length
              : null,
        });
      }
    }

    return chartData;
  }, [data]);

  const detectedTransitionMs =
    data?.detectedTransitionMs ??
    data?.detectionResults?.[0]?.detectedTransitionMs ??
    null;
  const actualTransitionMs =
    data?.actualTransitionMs ?? data?.phase1DurationMs ?? 3_600_000;
  const detectedMin =
    detectedTransitionMs !== null ? detectedTransitionMs / 60000 : null;
  const actualMin = actualTransitionMs / 60000;
  const deltaMin =
    detectedMin !== null ? detectedMin - actualMin : null;
  const deltaSign = deltaMin !== null && deltaMin > 0 ? '+' : '';

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 font-sans">
      {/* ══ INITIAL APP REVEAL LOADING OVERLAY (First mount only) ══ */}
      {initialLoading && (
        <div
          className={`fixed inset-0 z-[100] flex flex-col items-center justify-center bg-zinc-950 pointer-events-none transition-opacity duration-400 ease-out ${
            loadingFadeOut ? 'opacity-0' : 'opacity-100'
          }`}
        >
          {/* Logo with Heartbeat Pulse Animation */}
          <div className="flex flex-col items-center animate-heartbeat select-none">
            <div className="relative w-20 h-20 sm:w-24 sm:h-24 bg-white rounded-3xl p-3 shadow-2xl shadow-cyan-500/20 border border-zinc-200/90 flex items-center justify-center overflow-hidden mb-6">
              <Image
                src="/logo/pulsehide-icon.png"
                alt="PulseHide Logo"
                width={96}
                height={96}
                className="w-full h-full object-contain"
                priority
              />
            </div>
            <div className="flex items-center gap-2">
              <span className="text-2xl sm:text-3xl font-black tracking-tight text-white">
                PulseHide
              </span>
              <span className="text-xs px-2 py-0.5 rounded-full bg-cyan-500/10 text-cyan-400 border border-cyan-500/30 font-semibold tracking-wider">
                DEFENSE
              </span>
            </div>
          </div>

          {/* Animated ECG / Pulse Waveform Motif */}
          <div className="w-56 h-10 mt-6 flex items-center justify-center overflow-hidden">
            <svg className="w-full h-full" viewBox="0 0 200 40" fill="none">
              <path
                d="M 0 20 L 55 20 L 70 6 L 82 34 L 94 12 L 104 26 L 115 20 L 200 20"
                stroke="url(#pulseLineGrad)"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="animate-pulse-wave"
              />
              <defs>
                <linearGradient id="pulseLineGrad" x1="0%" y1="0%" x2="100%" y2="0%">
                  <stop offset="0%" stopColor="#22d3ee" />
                  <stop offset="50%" stopColor="#ef4444" />
                  <stop offset="100%" stopColor="#22d3ee" />
                </linearGradient>
              </defs>
            </svg>
          </div>
          <p className="mt-2 text-xs font-mono text-zinc-500 tracking-widest uppercase">
            Initializing Detection Engine
          </p>
        </div>
      )}

      {/* ══ STICKY NAVBAR (Solid opaque background to prevent scroll compositor redraws) ══════════════════════════════ */}
      <nav className="sticky top-0 z-50 flex items-center justify-between px-6 md:px-10 h-16 bg-zinc-950 border-b border-zinc-800">
        {/* Left: logo + wordmark */}
        <div className="flex items-center gap-3">
          <div className="relative w-9 h-9 flex-shrink-0 bg-white rounded-xl p-1 shadow-md shadow-black/50 border border-zinc-200/80 flex items-center justify-center overflow-hidden">
            <Image
              src="/logo/pulsehide-icon.png"
              alt="PulseHide logo"
              width={36}
              height={36}
              className="w-full h-full object-contain"
              priority
            />
          </div>
          <span className="text-base font-bold tracking-tight text-zinc-100 select-none">
            PulseHide
          </span>
          <span className="hidden sm:inline text-[10px] px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-500 border border-zinc-700/50 font-medium tracking-wider ml-0.5">
            BETA
          </span>
        </div>
      </nav>

      {/* ══ SECONDARY SECTION NAVBAR (Sticky solid background below main navbar in results view) ══ */}
      {data && (
        <div className="sticky top-16 z-40 bg-zinc-950 border-b border-zinc-800 px-6 md:px-10 py-2.5 flex items-center justify-between shadow-md">
          <div className="flex items-center gap-2 sm:gap-3">
            {/* New Scenario / Return to Landing Button */}
            <button
              onClick={handleReset}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-zinc-900 hover:bg-zinc-800 text-zinc-200 hover:text-white border border-zinc-700 transition-colors duration-75 cursor-pointer shadow-sm group"
              title="Return to Landing and Run New Scenario"
            >
              <ArrowLeft className="w-3.5 h-3.5 transition-transform group-hover:-translate-x-0.5" />
              <span className="hidden sm:inline">New Scenario</span>
              <span className="sm:hidden">Back</span>
            </button>

            <span className="h-4 w-px bg-zinc-800 hidden sm:block" />

            <span className="text-[11px] font-semibold text-zinc-400 uppercase tracking-wider hidden md:inline">
              Sections:
            </span>
            {[
              { id: 'beacon-timeline', label: 'Beacon Timeline' },
              { id: 'confidence', label: 'Confidence' },
              { id: 'results', label: 'Results' },
            ].map((item) => {
              const isActive = activeSection === item.id;
              return (
                <button
                  key={item.id}
                  onClick={() => {
                    const el = document.getElementById(item.id);
                    if (el) {
                      el.scrollIntoView({ behavior: 'smooth' });
                    }
                  }}
                  className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold cursor-pointer transition-colors duration-75 ${
                    isActive
                      ? 'bg-zinc-100 text-zinc-950 font-bold shadow-md ring-1 ring-white/40'
                      : 'text-zinc-200 hover:text-white hover:bg-zinc-800/80 bg-zinc-900/40 border border-zinc-800/50'
                  }`}
                >
                  {item.label}
                </button>
              );
            })}
          </div>

          <div className="flex items-center gap-3 text-xs text-zinc-400">
            <span className="hidden md:inline">
              Seed: <strong className="text-zinc-200 font-mono">{data.scenarioSeed}</strong>
            </span>
            <span className="hidden md:inline">•</span>
            <span>
              Contained:{' '}
              <strong className="text-red-400 font-mono">
                {data.detectionResults?.filter((r) => r.contained).length ?? 0}
              </strong>
              /20
            </span>
            <span>•</span>
            {data.evaluationResult?.passed ? (
              <span className="inline-flex items-center gap-1 text-emerald-400 font-semibold">
                <ShieldCheck className="w-3.5 h-3.5" /> PASS
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 text-red-400 font-semibold">
                <ShieldAlert className="w-3.5 h-3.5" /> FAIL
              </span>
            )}
          </div>
        </div>
      )}

      {/* ══ HERO SECTION (with KineticMatrix interactive topology background) — Rendered only on landing view ══ */}
      {!data && !loading && (
        <section className="relative w-full min-h-[calc(100vh-4rem)] flex flex-col justify-center overflow-hidden border-b border-zinc-800/50 bg-zinc-950">
          <KineticMatrix className="w-full min-h-[calc(100vh-4rem)] bg-zinc-950 flex flex-col justify-center items-center py-12 sm:py-16 px-4 sm:px-6 md:px-8" showControls={false} showTitle={false}>
            <div className="relative z-20 w-full max-w-5xl mx-auto flex flex-col items-center text-center gap-6 my-auto">
              {/* Logo mark — transparent background, revealing network lattice */}
              <div className="relative inline-flex items-center justify-center p-1 transition-transform hover:scale-105 duration-200 bg-transparent">
                <Image
                  src="/logo/pulsehide-logo-dark.png"
                  alt="PulseHide"
                  width={260}
                  height={80}
                  className="h-12 sm:h-14 w-auto object-contain drop-shadow-[0_4px_16px_rgba(0,0,0,0.8)]"
                  priority
                />
              </div>

              {/* Tagline pill */}
              <span className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-zinc-900/80 border border-zinc-700/60 text-[11px] font-semibold uppercase tracking-[0.18em] text-zinc-400 backdrop-blur-sm">
                <span className="w-1.5 h-1.5 rounded-full bg-cyan-400" />
                Detect · Correlate · Contain
                <span className="w-1.5 h-1.5 rounded-full bg-red-400" />
              </span>

              {/* Headline */}
              <h1 className="text-4xl md:text-5xl lg:text-[3.4rem] font-black tracking-tight leading-[1.1] text-zinc-50 max-w-4xl">
                Catch attackers even when they{' '}
                <span
                  style={{
                    background: 'linear-gradient(90deg, #22d3ee 0%, #ef4444 100%)',
                    WebkitBackgroundClip: 'text',
                    WebkitTextFillColor: 'transparent',
                    backgroundClip: 'text',
                  }}
                >
                  stop looking suspicious.
                </span>
              </h1>

              {/* Subheadline */}
              <p className="max-w-3xl text-base md:text-lg text-zinc-400 leading-relaxed">
                PulseHide detects evasive C2 beaconing across hosts — adapting from timing
                analysis to cross-host correlation when attackers change tactics, without
                falsely blocking innocent machines.
              </p>

              {/* Hero CTA — Run Scenario */}
              <button
                onClick={handleRunScenario}
                disabled={loading}
                className="inline-flex items-center justify-center gap-2.5 px-8 py-3.5 rounded-2xl bg-red-600 hover:bg-red-500 disabled:bg-zinc-800 disabled:text-zinc-500 text-white font-semibold text-base transition-all shadow-xl shadow-red-950/50 hover:shadow-red-900/60 hover:scale-[1.02] active:scale-100 disabled:shadow-none cursor-pointer disabled:cursor-not-allowed"
                style={{
                  boxShadow: '0 0 32px -4px rgba(239,68,68,0.35), 0 4px 24px -4px rgba(239,68,68,0.2)',
                }}
              >
                <Play className="w-5 h-5 fill-current" />
                Run Scenario
              </button>

              {/* Micro-hint below CTA */}
              <p className="text-xs text-zinc-500 -mt-2">
                Deterministic · Seed 42 · 20 hosts · 2-phase simulation
              </p>
            </div>
          </KineticMatrix>
        </section>
      )}

      {/* ══ LOADING VIEW (Simulation in progress — branded, with cycling status & ECG) ══ */}
      {loading && !data && (
        <div className="flex flex-col items-center justify-center min-h-[calc(100vh-4rem)] gap-0 bg-zinc-950">
          {/* Logo with heartbeat animation — matches intro loading screen */}
          <div className="flex flex-col items-center animate-heartbeat select-none mb-4">
            <div className="relative w-20 h-20 sm:w-24 sm:h-24 bg-white rounded-3xl p-3 shadow-2xl shadow-cyan-500/20 border border-zinc-200/90 flex items-center justify-center overflow-hidden mb-6">
              <Image
                src="/logo/pulsehide-icon.png"
                alt="PulseHide"
                width={96}
                height={96}
                className="w-full h-full object-contain"
                priority
              />
            </div>
            <div className="flex items-center gap-2">
              <span className="text-2xl sm:text-3xl font-black tracking-tight text-white">
                PulseHide
              </span>
              <span className="text-xs px-2 py-0.5 rounded-full bg-cyan-500/10 text-cyan-400 border border-cyan-500/30 font-semibold tracking-wider">
                ANALYSIS
              </span>
            </div>
          </div>

          {/* Animated ECG / Pulse Waveform */}
          <div className="w-56 h-10 flex items-center justify-center overflow-hidden">
            <svg className="w-full h-full" viewBox="0 0 200 40" fill="none">
              <path
                d="M 0 20 L 55 20 L 70 6 L 82 34 L 94 12 L 104 26 L 115 20 L 200 20"
                stroke="url(#runPulseLineGrad)"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="animate-pulse-wave"
              />
              <defs>
                <linearGradient id="runPulseLineGrad" x1="0%" y1="0%" x2="100%" y2="0%">
                  <stop offset="0%" stopColor="#22d3ee" />
                  <stop offset="50%" stopColor="#ef4444" />
                  <stop offset="100%" stopColor="#22d3ee" />
                </linearGradient>
              </defs>
            </svg>
          </div>

          {/* Cycling status message */}
          <p
            key={loadingStepIndex}
            className="mt-3 text-sm font-mono text-cyan-400/80 tracking-wide animate-in fade-in duration-300"
          >
            {LOADING_STEPS[loadingStepIndex]}
          </p>

          {/* Subtle sub-hint */}
          <p className="mt-2 text-xs text-zinc-600 tracking-widest uppercase font-medium">
            20 hosts · seed 42 · 2-phase simulation
          </p>
        </div>
      )}

      {/* ══ MAIN CONTENT AREA (Results View with subtle ambient background lattice) ══ */}
      {(data || error) && (
        <div className="relative w-full min-h-[calc(100vh-8rem)] bg-zinc-950 animate-in fade-in duration-500">
          <KineticMatrix
            className="w-full h-full bg-zinc-950"
            opacity={0.16}
            showControls={false}
            showTitle={false}
          >
            <div className="relative z-20 flex flex-col gap-8 px-6 md:px-10 pb-16 pt-6">

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
              <div className="flex items-center gap-2">
                <button
                  onClick={handleReset}
                  className="inline-flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-xs font-medium transition-all cursor-pointer"
                >
                  <ArrowLeft className="w-3.5 h-3.5" />
                  Back
                </button>
                <button
                  onClick={handleRunScenario}
                  disabled={loading}
                  className="inline-flex items-center justify-center gap-2 px-4 py-2 rounded-xl bg-red-600/80 hover:bg-red-500 text-white font-medium text-xs transition-all border border-red-500/30 shadow-sm cursor-pointer disabled:cursor-not-allowed disabled:opacity-50 flex-shrink-0"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
                  Retry
                </button>
              </div>
            </div>
          )}

        {/* ══ SECTION 1: BEACON TIMELINE CHART ══ */}
        {data && (
          <div id="beacon-timeline" className="scroll-mt-32 flex flex-col gap-4 rounded-2xl bg-zinc-900/60 border border-zinc-800/80 p-6 shadow-xl">
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

        {/* ══ SECTION 2: DETECTION CONFIDENCE OVER TIME ══ */}
        {data && confidenceChartData.length > 0 && (
          <div id="confidence" className="scroll-mt-32 flex flex-col gap-3 rounded-2xl bg-zinc-900/60 border border-zinc-800/80 p-6 shadow-xl">
            {/* Title & Self-Detection Callout */}
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 border-b border-zinc-800/60 pb-3">
              <div>
                <h2 className="text-base font-semibold text-zinc-100 tracking-tight flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-teal-400 shadow-sm shadow-teal-400/60" />
                  Detection Confidence Over Time
                </h2>
                <p className="text-xs text-zinc-500 mt-1">
                  Phase-1 and Phase-2 use independent scales (see axis labels) — raw values are unchanged from detection.
                </p>
              </div>

              {detectedMin !== null && (
                <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-xl bg-purple-950/40 border border-purple-800/60 text-xs text-purple-200 shadow-sm self-start md:self-auto flex-shrink-0">
                  <span className="w-2 h-2 rounded-full bg-purple-400 shadow-sm shadow-purple-400/60 flex-shrink-0" />
                  <span>
                    System self-detected the phase change at{' '}
                    <strong className="font-mono text-purple-300 font-semibold">{detectedMin.toFixed(1)}m</strong> — actual transition was at{' '}
                    <strong className="font-mono text-zinc-200 font-semibold">{actualMin.toFixed(1)}m</strong>{' '}
                    {deltaMin !== null && (
                      <>(delta: <strong className="font-mono text-purple-300 font-semibold">{deltaSign}{deltaMin.toFixed(1)}m</strong>).</>
                    )}
                  </span>
                </div>
              )}
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

                  {/* Ground-truth Phase transition reference line (amber dashed) */}
                  <ReferenceLine
                    yAxisId="left"
                    x={actualTransitionMs}
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

                  {/* Self-detected Phase transition reference line (dotted violet/magenta) */}
                  {detectedTransitionMs !== null && (
                    <ReferenceLine
                      yAxisId="left"
                      x={detectedTransitionMs}
                      stroke="#c084fc"
                      strokeDasharray="2 3"
                      strokeWidth={2}
                      label={{
                        value: 'Self-Detected',
                        position: 'insideBottomLeft',
                        fill: '#d8b4fe',
                        fontSize: 11,
                        fontWeight: 600,
                      }}
                    />
                  )}

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

        {/* ══ SECTION 3: CONTAINMENT RESULTS SECTION ══ */}
        {data && data.detectionResults && (
          <div id="results" className="scroll-mt-32 flex flex-col gap-6 rounded-2xl bg-zinc-900/60 border border-zinc-800/80 p-6 shadow-xl">
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
          </KineticMatrix>
        </div>
      )}
    </div>
  );
}
