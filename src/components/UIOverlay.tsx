/**
 * UIOverlay.tsx
 * Clean, distraction-free HUD for AR front-camera mosquito swatting:
 * - Minimal kill counter in top-left corner
 * - Legible countdown timer in top-right corner
 * - Simple, discreet central reticle
 * - Subtle tap feedback effect on swat
 * - Level 3 scream attack button
 */

import React, { useState, useEffect } from 'react';
import { Crosshair, Clock } from 'lucide-react';
import { GameState } from './ThreeCanvas';
import { sensorManager } from '../sensors/SensorManager';

interface NearestMosquitoData {
  direction: 'left' | 'right' | 'behind' | 'center';
  distance: number;
}

interface UIOverlayProps {
  gameState: GameState;
  sensorStatus?: unknown;
  currentVolume?: number;
  isScreaming?: boolean;
  onCalibrateGyro?: () => void;
  forwardDistance?: number;
  nearestMosquito?: NearestMosquitoData | null;
  proximityHeat?: number;
  isAimingNear?: boolean;
  edgeIndicator?: unknown;
  isDebugMode?: boolean;
  onToggleDebug?: () => void;
  debugNests?: unknown;
}

export const UIOverlay: React.FC<UIOverlayProps> = ({
  gameState,
}) => {

  const timerColor =
    gameState.timeLeft <= 5
      ? 'text-red-500 animate-pulse font-extrabold'
      : gameState.timeLeft <= 10
      ? 'text-amber-400'
      : 'text-white';

  return (
    <div className="pointer-events-none absolute inset-0 z-20 flex flex-col justify-between p-3.5 select-none">
      {/* --- TOP ROW: KILL COUNTER (LEFT) & TIMER (RIGHT) --- */}
      <div className="flex items-center justify-between w-full">
        {/* Left: Kill Counter */}
        <div className="flex items-center gap-1.5 rounded-full bg-black/65 px-3 py-1 backdrop-blur-md border border-white/20 text-xs font-mono font-bold text-slate-100 shadow-lg">
          <span className="text-amber-400 text-sm">🦟</span>
          {gameState.currentLevel < 3 ? (
            <span>
              {gameState.kills} / {gameState.targetKills}
            </span>
          ) : (
            <span className="text-rose-400 font-bold">JEFE</span>
          )}
        </div>

        {/* Level 3 Scream Gauge */}
        {gameState.currentLevel === 3 && (
          <div className="w-28 h-2 rounded-full bg-black/70 border border-white/20 overflow-hidden shadow-lg">
            <div
              className="h-full bg-gradient-to-r from-amber-500 to-rose-600 transition-all duration-100"
              style={{
                width: `${Math.min(100, (gameState.screamSecondsAccumulated / 10) * 100)}%`,
              }}
            />
          </div>
        )}

        {/* Right: Countdown Timer */}
        <div className="flex items-center gap-1.5 rounded-full bg-black/65 px-3 py-1 backdrop-blur-md border border-white/20 text-xs font-mono font-bold shadow-lg">
          <Clock className={`h-3.5 w-3.5 ${timerColor}`} />
          <span className={timerColor}>{gameState.timeLeft}s</span>
        </div>
      </div>

      {/* --- CENTRAL RETICLE --- */}
      <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
        <div className="h-6 w-6 rounded-full border border-white/40 bg-black/10 flex items-center justify-center shadow-sm">
          <Crosshair className="h-3.5 w-3.5 text-white/60" />
        </div>
      </div>


      {/* --- BOTTOM ROW: SCREAM BUTTON (LEVEL 3) --- */}
      <div className="flex items-end justify-end w-full pointer-events-auto">
        {/* Level 3 Scream Action Button */}
        {gameState.currentLevel === 3 && (
          <button
            data-no-swat="true"
            onPointerDown={() => sensorManager.simulateScream(true)}
            onPointerUp={() => sensorManager.simulateScream(false)}
            onPointerLeave={() => sensorManager.simulateScream(false)}
            className="flex items-center gap-2 rounded-2xl bg-gradient-to-r from-red-600 to-rose-600 px-5 py-3.5 font-bold text-white shadow-lg shadow-rose-600/40 active:scale-95 text-xs uppercase tracking-wider"
          >
            <span>📢 GRITAR</span>
          </button>
        )}
      </div>
    </div>
  );
};
