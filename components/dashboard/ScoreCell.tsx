'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * useCountUp — RAF-based count-up from 0 to target.
 *
 * @param target      Final numeric value to count up to.
 * @param animKey     Non-empty string triggers animation (changes per run).
 *                    Empty string skips animation; shows final value instantly.
 * @param rowIndex    Row position for staggered start (40ms per row).
 * @param duration    Animation duration in ms (default 650ms).
 * @param decimals    Fixed decimal places (default 4).
 */
function useCountUp(
  target: number,
  animKey: string,
  rowIndex: number,
  duration = 650,
  decimals = 4,
): string {
  // Start at final value so cells never flash 0 before the observer fires.
  const [display, setDisplay] = useState<string>(target.toFixed(decimals));
  const rafRef = useRef<number | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hasRunRef = useRef<string>('');

  useEffect(() => {
    // Empty key = observer not yet fired; just show the final value.
    if (!animKey) {
      setDisplay(target.toFixed(decimals));
      return;
    }
    // Animate only once per animKey (once per scenario run).
    if (hasRunRef.current === animKey) {
      return;
    }
    hasRunRef.current = animKey;

    const staggerMs = rowIndex * 40;

    // Snap to 0 right before count-up begins.
    setDisplay((0).toFixed(decimals));

    timerRef.current = setTimeout(() => {
      const startTime = performance.now();

      const tick = (now: number) => {
        const elapsed = now - startTime;
        const progress = Math.min(elapsed / duration, 1);

        // Ease-out cubic.
        const eased = 1 - Math.pow(1 - progress, 3);
        const current = eased * target;

        if (progress < 1) {
          setDisplay(current.toFixed(decimals));
          rafRef.current = requestAnimationFrame(tick);
        } else {
          // Snap to exact value; no floating-point drift.
          setDisplay(target.toFixed(decimals));
        }
      };

      rafRef.current = requestAnimationFrame(tick);
    }, staggerMs);

    return () => {
      if (timerRef.current !== null) clearTimeout(timerRef.current);
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [animKey]);

  return display;
}

// ─────────────────────────────────────────────────────────────────────────────

interface ScoreCellProps {
  value: number;
  /** Non-empty = animate this run; empty = display final value instantly. */
  animKey: string;
  rowIndex: number;
  className?: string;
  decimals?: number;
}

/**
 * ScoreCell — numeric score cell with scroll-triggered one-shot count-up.
 * Caller passes animKey='' until IntersectionObserver fires, then a non-empty
 * runId string. The hook animates exactly once per unique non-empty animKey.
 */
export function ScoreCell({
  value,
  animKey,
  rowIndex,
  className = '',
  decimals = 4,
}: ScoreCellProps) {
  const display = useCountUp(value, animKey, rowIndex, 650, decimals);
  return <span className={className}>{display}</span>;
}

