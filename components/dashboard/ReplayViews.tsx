'use client';

import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { Play, Pause, RotateCcw } from 'lucide-react';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
  Legend,
} from 'recharts';

export interface BeaconEvent {
  hostId: string;
  timestampMs: number;
}

interface BeaconTimelineReplayProps {
  events: BeaconEvent[];
  hostCategories: Record<string, string>;
  totalDurationMs: number;
  phase1EndMs: number;
}

const CATEGORY_COLORS: Record<string, string> = {
  compromised: '#ef4444',
  benignRegular: '#f97316',
  benignBursty: '#3b82f6',
  plainBenign: '#9ca3af',
};

const CATEGORY_LABELS: Record<string, string> = {
  compromised: 'Compromised (C2)',
  benignRegular: 'Benign-Regular (Trap)',
  benignBursty: 'Benign-Bursty',
  plainBenign: 'Plain Benign',
};

function formatTimeMinutes(ms: number): string {
  const m = Math.floor(ms / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  return `${m}m ${s.toString().padStart(2, '0')}s`;
}

function formatAxisTime(ms: number): string {
  const m = Math.round(ms / 60000);
  return `${m}m`;
}

const CANVAS_PADDING = { top: 25, right: 35, bottom: 40, left: 80 };

/**
 * High-performance, 60fps Canvas-based Beacon Timeline Replay component.
 * Isolates all RAF animation loops inside this subcomponent so the parent DashboardPage
 * never re-renders during playback.
 */
export const BeaconTimelineReplay: React.FC<BeaconTimelineReplayProps> = ({
  events,
  hostCategories,
  totalDurationMs,
  phase1EndMs,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  // Playback state
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentProgress, setCurrentProgress] = useState(0); // 0 to 1
  const [revealedCount, setRevealedCount] = useState(0);
  const [simTimeMs, setSimTimeMs] = useState(0);
  const [playbackSpeed, setPlaybackSpeed] = useState<number>(1); // 1x, 2x, 4x

  // Tooltip state
  const [hoveredEvent, setHoveredEvent] = useState<{
    x: number;
    y: number;
    hostId: string;
    timestampMs: number;
    category: string;
  } | null>(null);

  const REPLAY_BASE_DURATION_MS = 10000; // 10s for full 2h simulation at 1x

  // Pre-process and sort events once
  const sortedEvents = useMemo(() => {
    return [...events].sort((a, b) => a.timestampMs - b.timestampMs);
  }, [events]);

  const hostIds = useMemo(
    () => Array.from({ length: 20 }, (_, i) => `host-${String(i + 1).padStart(2, '0')}`),
    []
  );

  const hostToIndex = useMemo(() => {
    const map: Record<string, number> = {};
    hostIds.forEach((id, idx) => {
      map[id] = idx; // 0 = host-01 (top), 19 = host-20 (bottom)
    });
    return map;
  }, [hostIds]);

  // Animation references
  const rafRef = useRef<number | null>(null);
  const startTimeRef = useRef<number | null>(null);
  const pausedElapsedRef = useRef<number>(0);
  const progressRef = useRef<number>(0);

  // Draw frame on canvas
  const draw = useCallback(
    (progress: number) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      const dpr = window.devicePixelRatio || 1;
      const rect = canvas.getBoundingClientRect();
      const width = rect.width;
      const height = rect.height;

      if (canvas.width !== width * dpr || canvas.height !== height * dpr) {
        canvas.width = width * dpr;
        canvas.height = height * dpr;
      }

      ctx.save();
      ctx.scale(dpr, dpr);
      ctx.clearRect(0, 0, width, height);

      const plotWidth = width - CANVAS_PADDING.left - CANVAS_PADDING.right;
      const plotHeight = height - CANVAS_PADDING.top - CANVAS_PADDING.bottom;

      if (plotWidth <= 0 || plotHeight <= 0) {
        ctx.restore();
        return;
      }

      const currentSimMs = progress * totalDurationMs;
      const rowHeight = plotHeight / 20;

      // 1. Draw horizontal grid tracks & host Y labels
      ctx.lineWidth = 1;
      ctx.strokeStyle = '#27272a';
      ctx.fillStyle = '#a1a1aa';
      ctx.font = '500 11px system-ui, -apple-system, sans-serif';
      ctx.textAlign = 'right';
      ctx.textBaseline = 'middle';

      for (let i = 0; i < 20; i++) {
        const y = CANVAS_PADDING.top + i * rowHeight + rowHeight / 2;
        // Line
        ctx.beginPath();
        ctx.strokeStyle = i % 2 === 0 ? '#1f1f23' : '#27272a';
        ctx.moveTo(CANVAS_PADDING.left, y);
        ctx.lineTo(CANVAS_PADDING.left + plotWidth, y);
        ctx.stroke();

        // Label
        const hostName = hostIds[i];
        ctx.fillStyle = '#a1a1aa';
        ctx.fillText(hostName, CANVAS_PADDING.left - 12, y);
      }

      // 2. Draw X-axis time ticks
      const numXTicks = 8;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      ctx.strokeStyle = '#27272a';
      ctx.fillStyle = '#71717a';
      ctx.font = '11px system-ui, -apple-system, sans-serif';

      for (let i = 0; i <= numXTicks; i++) {
        const tickMs = (i / numXTicks) * totalDurationMs;
        const x = CANVAS_PADDING.left + (i / numXTicks) * plotWidth;

        // Tick line
        ctx.beginPath();
        ctx.moveTo(x, CANVAS_PADDING.top + plotHeight);
        ctx.lineTo(x, CANVAS_PADDING.top + plotHeight + 4);
        ctx.stroke();

        // Tick label
        ctx.fillText(formatAxisTime(tickMs), x, CANVAS_PADDING.top + plotHeight + 8);
      }

      // 3. Draw phase transition line if simulation has reached phase1EndMs
      const phaseTransitionX = CANVAS_PADDING.left + (phase1EndMs / totalDurationMs) * plotWidth;
      if (currentSimMs >= phase1EndMs) {
        ctx.save();
        ctx.strokeStyle = '#f59e0b';
        ctx.lineWidth = 1.5;
        ctx.setLineDash([5, 5]);
        ctx.beginPath();
        ctx.moveTo(phaseTransitionX, CANVAS_PADDING.top);
        ctx.lineTo(phaseTransitionX, CANVAS_PADDING.top + plotHeight);
        ctx.stroke();

        // Label
        ctx.fillStyle = '#fbbf24';
        ctx.font = '600 11px system-ui, -apple-system, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('Phase Transition (1h)', phaseTransitionX, CANVAS_PADDING.top - 16);
        ctx.restore();
      }

      // 4. Draw Playhead scrubber line
      const playheadX = CANVAS_PADDING.left + (currentSimMs / totalDurationMs) * plotWidth;
      ctx.save();
      ctx.strokeStyle = 'rgba(45, 212, 191, 0.4)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(playheadX, CANVAS_PADDING.top);
      ctx.lineTo(playheadX, CANVAS_PADDING.top + plotHeight);
      ctx.stroke();
      ctx.restore();

      // 5. Draw beacon event dots up to currentSimMs (O(N) single-pass canvas draw, ~0.08ms)
      let count = 0;
      const dotRadius = 3.5;

      for (let i = 0; i < sortedEvents.length; i++) {
        const ev = sortedEvents[i];
        if (ev.timestampMs > currentSimMs) break;
        count++;

        const hostIdx = hostToIndex[ev.hostId] ?? 0;
        const x = CANVAS_PADDING.left + (ev.timestampMs / totalDurationMs) * plotWidth;
        const y = CANVAS_PADDING.top + hostIdx * rowHeight + rowHeight / 2;

        const cat = hostCategories[ev.hostId] || 'plainBenign';
        const color = CATEGORY_COLORS[cat] || '#9ca3af';

        ctx.beginPath();
        ctx.arc(x, y, dotRadius, 0, Math.PI * 2);
        ctx.fillStyle = color;
        ctx.fill();
      }

      ctx.restore();
      setRevealedCount(count);
      setSimTimeMs(currentSimMs);
    },
    [hostCategories, hostIds, hostToIndex, phase1EndMs, sortedEvents, totalDurationMs]
  );

  // RAF playback loop
  const animate = useCallback(
    (wallNow: number) => {
      const duration = REPLAY_BASE_DURATION_MS / playbackSpeed;
      const elapsed = (wallNow - (startTimeRef.current ?? wallNow)) + pausedElapsedRef.current;
      const prog = Math.min(elapsed / duration, 1);

      progressRef.current = prog;
      setCurrentProgress(prog);
      draw(prog);

      if (prog < 1) {
        rafRef.current = requestAnimationFrame(animate);
      } else {
        setIsPlaying(false);
      }
    },
    [draw, playbackSpeed]
  );

  const startPlayback = useCallback(() => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    setIsPlaying(true);
    rafRef.current = requestAnimationFrame((t) => {
      startTimeRef.current = t;
      animate(t);
    });
  }, [animate]);

  const pausePlayback = useCallback(() => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    pausedElapsedRef.current +=
      performance.now() - (startTimeRef.current ?? performance.now());
    startTimeRef.current = null;
    setIsPlaying(false);
  }, []);

  const resetPlayback = useCallback(() => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    startTimeRef.current = null;
    pausedElapsedRef.current = 0;
    progressRef.current = 0;
    setCurrentProgress(0);
    draw(0);
    setIsPlaying(false);
    setTimeout(() => startPlayback(), 30);
  }, [draw, startPlayback]);

  // Initial auto-start and resize handler
  useEffect(() => {
    const timer = setTimeout(() => {
      resetPlayback();
    }, 50);

    const handleResize = () => {
      draw(progressRef.current);
    };
    window.addEventListener('resize', handleResize);

    return () => {
      clearTimeout(timer);
      window.removeEventListener('resize', handleResize);
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [draw, resetPlayback]);

  // Mouse hover event detection
  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;

    const plotWidth = rect.width - CANVAS_PADDING.left - CANVAS_PADDING.right;
    const plotHeight = rect.height - CANVAS_PADDING.top - CANVAS_PADDING.bottom;
    const rowHeight = plotHeight / 20;

    if (
      mouseX < CANVAS_PADDING.left ||
      mouseX > CANVAS_PADDING.left + plotWidth ||
      mouseY < CANVAS_PADDING.top ||
      mouseY > CANVAS_PADDING.top + plotHeight
    ) {
      setHoveredEvent(null);
      return;
    }

    const currentSimMs = progressRef.current * totalDurationMs;
    const targetHostIdx = Math.floor((mouseY - CANVAS_PADDING.top) / rowHeight);
    const targetHostId = hostIds[targetHostIdx];

    // Find closest dot on this host row
    let closest: (typeof sortedEvents)[0] | null = null;
    let minDist = 12; // pixel radius tolerance

    for (let i = 0; i < sortedEvents.length; i++) {
      const ev = sortedEvents[i];
      if (ev.timestampMs > currentSimMs) break;
      if (ev.hostId !== targetHostId) continue;

      const evX = CANVAS_PADDING.left + (ev.timestampMs / totalDurationMs) * plotWidth;
      const evY = CANVAS_PADDING.top + targetHostIdx * rowHeight + rowHeight / 2;

      const dist = Math.hypot(mouseX - evX, mouseY - evY);
      if (dist < minDist) {
        minDist = dist;
        closest = ev;
      }
    }

    if (closest) {
      const evX = CANVAS_PADDING.left + (closest.timestampMs / totalDurationMs) * plotWidth;
      const evY = CANVAS_PADDING.top + targetHostIdx * rowHeight + rowHeight / 2;
      setHoveredEvent({
        x: evX,
        y: evY,
        hostId: closest.hostId,
        timestampMs: closest.timestampMs,
        category: hostCategories[closest.hostId] || 'plainBenign',
      });
    } else {
      setHoveredEvent(null);
    }
  };

  const handleMouseLeave = () => {
    setHoveredEvent(null);
  };

  return (
    <div className="flex flex-col gap-3 pt-4 w-full select-none" ref={containerRef}>
      {/* Playback Controls Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-2.5 rounded-xl bg-zinc-950/80 border border-zinc-800 text-xs">
        <div className="flex items-center gap-2">
          {isPlaying ? (
            <button
              onClick={pausePlayback}
              className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-100 font-semibold border border-zinc-700 transition-colors cursor-pointer"
            >
              <Pause className="w-3.5 h-3.5 text-amber-400" /> Pause
            </button>
          ) : (
            <button
              onClick={() => {
                if (currentProgress >= 1) {
                  resetPlayback();
                } else {
                  startPlayback();
                }
              }}
              className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white font-semibold shadow-sm transition-colors cursor-pointer"
            >
              <Play className="w-3.5 h-3.5" /> {currentProgress >= 1 ? 'Replay' : 'Play'}
            </button>
          )}
          <button
            onClick={resetPlayback}
            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-zinc-900 hover:bg-zinc-800 text-zinc-400 hover:text-zinc-200 border border-zinc-800 transition-colors cursor-pointer"
            title="Reset from start"
          >
            <RotateCcw className="w-3.5 h-3.5" /> Reset
          </button>

          {/* Speed Toggle */}
          <div className="flex items-center rounded-lg bg-zinc-900 p-0.5 border border-zinc-800 ml-1">
            {[1, 2, 4].map((spd) => (
              <button
                key={spd}
                onClick={() => {
                  setPlaybackSpeed(spd);
                  if (isPlaying) {
                    pausePlayback();
                    setTimeout(() => startPlayback(), 10);
                  }
                }}
                className={`px-2 py-0.5 rounded text-[11px] font-mono font-medium transition-colors cursor-pointer ${
                  playbackSpeed === spd
                    ? 'bg-cyan-500/20 text-cyan-300 font-bold'
                    : 'text-zinc-500 hover:text-zinc-300'
                }`}
              >
                {spd}x
              </button>
            ))}
          </div>
        </div>

        {/* Live Counters */}
        <div className="flex items-center gap-4 text-zinc-400 font-mono">
          <span>
            <strong className="text-zinc-200 font-semibold">{revealedCount.toLocaleString()}</strong> /{' '}
            {sortedEvents.length.toLocaleString()} beacons
          </span>
          <span className="text-zinc-600">•</span>
          <span className="text-cyan-300 font-semibold">{formatTimeMinutes(simTimeMs)}</span>
        </div>
      </div>

      {/* Canvas Container */}
      <div className="relative w-full h-[650px] bg-zinc-950/40 rounded-xl overflow-hidden border border-zinc-800/40">
        <canvas
          ref={canvasRef}
          onMouseMove={handleMouseMove}
          onMouseLeave={handleMouseLeave}
          className="w-full h-full cursor-crosshair"
        />

        {/* Floating Tooltip */}
        {hoveredEvent && (
          <div
            className="absolute z-20 pointer-events-none p-3 rounded-lg bg-zinc-900/95 backdrop-blur-sm border border-zinc-700 text-zinc-100 text-xs shadow-2xl space-y-1"
            style={{
              left: Math.min(Math.max(hoveredEvent.x + 12, 10), containerRef.current ? containerRef.current.clientWidth - 230 : 500),
              top: Math.max(hoveredEvent.y - 45, 10),
            }}
          >
            <div className="font-bold text-sm text-zinc-100">{hoveredEvent.hostId}</div>
            <div className="text-zinc-400">
              Category:{' '}
              <span className="font-semibold text-zinc-200">
                {CATEGORY_LABELS[hoveredEvent.category] || hoveredEvent.category}
              </span>
            </div>
            <div className="text-zinc-400">
              Timestamp:{' '}
              <span className="font-mono text-zinc-200">{hoveredEvent.timestampMs} ms</span> (
              {formatTimeMinutes(hoveredEvent.timestampMs)})
            </div>
            <div className="text-zinc-400">
              Phase:{' '}
              <span
                className={`font-semibold ${
                  hoveredEvent.timestampMs < phase1EndMs ? 'text-amber-400' : 'text-purple-400'
                }`}
              >
                {hoveredEvent.timestampMs < phase1EndMs
                  ? 'Phase 1 (Regular)'
                  : 'Phase 2 (Coordinated / Jitter)'}
              </span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

interface ConfidenceReplayProps {
  confidenceChartData: Array<{
    timestampMs: number;
    phase1Avg: number | null;
    phase2Avg: number | null;
  }>;
  totalDurationMs: number;
  actualTransitionMs: number;
  detectedTransitionMs: number | null;
}

/**
 * Isolated Confidence Chart Replay component.
 * Slices pre-calculated data points smoothly without triggering parent page re-renders.
 */
export const ConfidenceReplay: React.FC<ConfidenceReplayProps> = ({
  confidenceChartData,
  totalDurationMs,
  actualTransitionMs,
  detectedTransitionMs,
}) => {
  const [isPlaying, setIsPlaying] = useState(false);
  const [revealIndex, setRevealIndex] = useState(0);
  const [playbackSpeed, setPlaybackSpeed] = useState<number>(1);

  const REPLAY_BASE_DURATION_MS = 8000;

  const rafRef = useRef<number | null>(null);
  const startTimeRef = useRef<number | null>(null);
  const pausedElapsedRef = useRef<number>(0);

  const totalPoints = confidenceChartData.length;

  const animate = useCallback(
    (wallNow: number) => {
      const duration = REPLAY_BASE_DURATION_MS / playbackSpeed;
      const elapsed = (wallNow - (startTimeRef.current ?? wallNow)) + pausedElapsedRef.current;
      const progress = Math.min(elapsed / duration, 1);
      const newIdx = Math.max(1, Math.floor(progress * totalPoints));

      setRevealIndex(newIdx);

      if (progress < 1) {
        rafRef.current = requestAnimationFrame(animate);
      } else {
        setIsPlaying(false);
      }
    },
    [playbackSpeed, totalPoints]
  );

  const startPlayback = useCallback(() => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    setIsPlaying(true);
    rafRef.current = requestAnimationFrame((t) => {
      startTimeRef.current = t;
      animate(t);
    });
  }, [animate]);

  const pausePlayback = useCallback(() => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    pausedElapsedRef.current +=
      performance.now() - (startTimeRef.current ?? performance.now());
    startTimeRef.current = null;
    setIsPlaying(false);
  }, []);

  const resetPlayback = useCallback(() => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    startTimeRef.current = null;
    pausedElapsedRef.current = 0;
    setRevealIndex(0);
    setIsPlaying(false);
    setTimeout(() => startPlayback(), 30);
  }, [startPlayback]);

  useEffect(() => {
    const timer = setTimeout(() => {
      resetPlayback();
    }, 50);

    return () => {
      clearTimeout(timer);
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [resetPlayback]);

  const visibleData = useMemo(() => {
    return confidenceChartData.slice(0, revealIndex);
  }, [confidenceChartData, revealIndex]);

  const latestTs = visibleData.length > 0 ? visibleData[visibleData.length - 1].timestampMs : 0;
  const showActual = latestTs >= actualTransitionMs;
  const showDetected = detectedTransitionMs !== null && latestTs >= detectedTransitionMs;

  return (
    <div className="flex flex-col gap-2 w-full select-none">
      {/* Playback Controls Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-2.5 rounded-xl bg-zinc-950/80 border border-zinc-800 text-xs">
        <div className="flex items-center gap-2">
          {isPlaying ? (
            <button
              onClick={pausePlayback}
              className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-100 font-semibold border border-zinc-700 transition-colors cursor-pointer"
            >
              <Pause className="w-3.5 h-3.5 text-amber-400" /> Pause
            </button>
          ) : (
            <button
              onClick={() => {
                if (revealIndex >= totalPoints) {
                  resetPlayback();
                } else {
                  startPlayback();
                }
              }}
              className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-teal-600 hover:bg-teal-500 text-white font-semibold shadow-sm transition-colors cursor-pointer"
            >
              <Play className="w-3.5 h-3.5" /> {revealIndex >= totalPoints ? 'Replay' : 'Play'}
            </button>
          )}
          <button
            onClick={resetPlayback}
            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-zinc-900 hover:bg-zinc-800 text-zinc-400 hover:text-zinc-200 border border-zinc-800 transition-colors cursor-pointer"
            title="Reset from start"
          >
            <RotateCcw className="w-3.5 h-3.5" /> Reset
          </button>

          {/* Speed Toggle */}
          <div className="flex items-center rounded-lg bg-zinc-900 p-0.5 border border-zinc-800 ml-1">
            {[1, 2, 4].map((spd) => (
              <button
                key={spd}
                onClick={() => {
                  setPlaybackSpeed(spd);
                  if (isPlaying) {
                    pausePlayback();
                    setTimeout(() => startPlayback(), 10);
                  }
                }}
                className={`px-2 py-0.5 rounded text-[11px] font-mono font-medium transition-colors cursor-pointer ${
                  playbackSpeed === spd
                    ? 'bg-teal-500/20 text-teal-300 font-bold'
                    : 'text-zinc-500 hover:text-zinc-300'
                }`}
              >
                {spd}x
              </button>
            ))}
          </div>
        </div>

        {/* Live Counters */}
        <div className="flex items-center gap-4 text-zinc-400 font-mono">
          <span>
            <strong className="text-zinc-200 font-semibold">{revealIndex}</strong> / {totalPoints} evaluation points
          </span>
          {latestTs > 0 && (
            <>
              <span className="text-zinc-600">•</span>
              <span className="text-teal-300 font-semibold">{formatTimeMinutes(latestTs)}</span>
            </>
          )}
        </div>
      </div>

      {/* Replay Line Chart */}
      <div className="w-full h-[260px] pt-2">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={visibleData} margin={{ top: 10, right: 65, bottom: 20, left: 15 }}>
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
                            {typeof entry.value === 'number' ? entry.value.toFixed(4) : '—'}
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
              formatter={(value) => <span style={{ color: '#a1a1aa' }}>{value}</span>}
            />
            {showActual && (
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
            )}
            {showDetected && (
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
              isAnimationActive={false}
            />
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
              isAnimationActive={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
};
