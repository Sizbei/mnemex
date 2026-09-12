"use client";

import { useEffect, useState } from "react";

/**
 * True only once `active` has held for `delayMs`. A loading state that flashes
 * for 80ms reads as a glitch, so fast responses should render no skeleton at
 * all; warm recall is under 300ms here and cold recall is around 2.4s.
 */
export function useDelayed(active: boolean, delayMs = 300): boolean {
  const [elapsed, setElapsed] = useState(false);

  useEffect(() => {
    if (!active) return;
    const id = setTimeout(() => setElapsed(true), delayMs);
    // Resetting on the way out keeps the next wait honest about its own 300ms.
    return () => { clearTimeout(id); setElapsed(false); };
  }, [active, delayMs]);

  return active && elapsed;
}
