/**
 * UIOverlay.tsx
 * Minimal, distraction-free AR interface strictly adhering to user specifications:
 * - Central reticle (simple, discreet)
 * - Minimal kill counter in the corner
 * - Tap feedback effect on swat
 * - All visual hints, banners, arrows, vignettes, and debug text removed or disabled by default
 */

import React, { useState, useEffect } from 'react';
import { Crosshair } from 'lucide-react';
import { GameState, DebugNestInfo, EdgeIndicatorInfo } from './ThreeCanvas';
import { CONFIG } from '../config/gameplayConfig';

interface UIOverlayProps {
  gameState: GameState;
  sensorStatus?: unknown;
  currentVolume?: number;
  isScreaming?: boolean;
  onCalibrateGyro?: () => void;
  forwardDistance?: number;
  nearestMosquito?: unknown;
  proximityHeat?: number;
  isAimingNear?: boolean;
  edgeIndicator?: EdgeIndicatorInfo | null;
  isDebugMode?: boolean;
  onToggleDebug?: () => void;
  debugNests?: DebugNestInfo[];
}

export const UIOverlay: React.FC<UIOverlayProps> = ({
  gameState,
  proximityHeat = 0,
  edgeIndicator = null,
  isDebugMode = false,
  debugNests = [],
}) => {
  const [swatEffect, setSwatEffect] = useState<{ x: number; y: number } | null>(null);

  // Screen click/tap slap visual feedback
  useEffect(() => {
    const handleTap = (e: MouseEvent | TouchEvent) => {
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.closest('[data-no-swat]') ||
          target.closest('button') ||
          target.closest('input'))
      ) {
        return;
      }

      let x = 0;
      let y = 0;
      if ('touches' in e && e.touches.length > 0) {
        x = e.touches[0].clientX;
        y = e.touches[0].clientY;
      } else if ('clientX' in e) {
        x = e.clientX;
        y = e.clientY;
      }
      setSwatEffect({ x, y });
      setTimeout(() => setSwatEffect(null), 200);
    };

    window.addEventListener('click', handleTap);
    return () => window.removeEventListener('click', handleTap);
  }, []);

  return (
    <div className="pointer-events-none absolute inset-0 z-20 flex flex-col justify-between p-4 select-none">
      {/* --- MINIMAL CORNER KILL COUNTER (DISCREET & UNINVASIVE) --- */}
      <div className="flex items-center justify-between w-full">
        <div className="flex items-center gap-1.5 rounded-full bg-black/40 px-3 py-1 backdrop-blur-sm border border-white/10 text-xs font-mono text-slate-200">
          <span className="text-slate-400">🦟</span>
          {gameState.currentLevel < 3 ? (
            <span>
              {gameState.kills} / {gameState.targetKills}
            </span>
          ) : (
            <span className="text-rose-400 font-bold">JEFE</span>
          )}
        </div>

        {/* Level 3 scream gauge minimal indicator */}
        {gameState.currentLevel === 3 && (
          <div className="w-28 h-2 rounded-full bg-black/50 border border-white/15 overflow-hidden">
            <div
              className="h-full bg-rose-500 transition-all duration-100"
              style={{
                width: `${Math.min(100, (gameState.screamSecondsAccumulated / 10) * 100)}%`,
              }}
            />
          </div>
        )}
      </div>

      {/* --- CENTRAL RETICLE: SIMPLE & DISCREET --- */}
      <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
        <div className="h-6 w-6 rounded-full border border-white/40 bg-black/10 flex items-center justify-center">
          <Crosshair className="h-3 w-3 text-white/50" />
        </div>
      </div>

      {/* --- TAP FEEDBACK RETICLE --- */}
      {swatEffect && (
        <div
          className="pointer-events-none fixed -translate-x-1/2 -translate-y-1/2"
          style={{ left: swatEffect.x, top: swatEffect.y }}
        >
          <div className="h-10 w-10 rounded-full border-2 border-white/60 bg-white/10 animate-ping" />
        </div>
      )}

      {/* ==================================================================== */}
      {/* HINTS / DEBUG OVERLAYS: STRICTLY GATED BEHIND CONFIG (OFF BY DEFAULT) */}
      {/* ==================================================================== */}

      {/* Optional Hot/Cold Vignette (Disabled by default) */}
      {CONFIG.showHotColdVignette && proximityHeat > 0.05 && (
        <div
          className="pointer-events-none absolute inset-0 transition-opacity"
          style={{
            boxShadow: `inset 0 0 30px rgba(244, 63, 94, ${(proximityHeat * 0.4).toFixed(2)})`,
          }}
        />
      )}

      {/* Optional Edge Arrow (Disabled by default) */}
      {CONFIG.showEdgeIndicator && edgeIndicator && edgeIndicator.opacity > 0.05 && (
        <div
          className="pointer-events-none absolute inset-0 flex items-center justify-center overflow-hidden"
          style={{ opacity: edgeIndicator.opacity }}
        >
          <div
            className="absolute flex items-center justify-center"
            style={{
              transform: `translate(${edgeIndicator.x * 40}vw, ${-edgeIndicator.y * 38}vh)`,
            }}
          >
            <div className="rounded-full bg-black/60 px-2 py-0.5 text-[10px] text-white">
              ▶
            </div>
          </div>
        </div>
      )}

      {/* Optional Debug Overlay (Disabled by default) */}
      {CONFIG.showDebug && isDebugMode && (
        <div
          data-no-swat="true"
          className="pointer-events-auto absolute top-16 left-4 max-w-xs rounded-lg bg-black/85 p-2 text-[10px] font-mono text-slate-200 border border-white/20"
        >
          <div className="font-bold text-emerald-400 pb-1 border-b border-white/10">DEBUG NIDOS</div>
          <div className="mt-1 space-y-1">
            {debugNests.map((nest, i) => (
              <div key={nest.id} className="flex justify-between">
                <span>Nido {i + 1}: {nest.distance}m</span>
                <span className={nest.aliveCount > 0 ? 'text-emerald-400' : 'text-rose-400'}>
                  {nest.aliveCount > 0 ? `${nest.aliveCount} vivo` : 'respawn'}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
