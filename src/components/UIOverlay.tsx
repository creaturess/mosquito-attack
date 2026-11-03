/**
 * UIOverlay.tsx
 * Clean, distraction-free HUD for AR front-camera mosquito swatting:
 * - Minimal kill counter in top-left corner
 * - Legible countdown timer in top-right corner
 * - Simple, discreet central reticle
 * - Subtle tap feedback effect on swat
 * - Level 3 scream attack button
 */

import React from 'react';
import { Clock } from 'lucide-react';
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

  const isCritical = gameState.timeLeft <= 5;
  const timerTextColor = isCritical
    ? 'text-red-500 animate-pulse font-black'
    : 'text-emerald-400 font-bold';

  const timerBorderColor = isCritical
    ? 'border-red-500/70 shadow-red-950/50'
    : 'border-emerald-500/40 shadow-emerald-950/40';

  return (
    <div className="pointer-events-none absolute inset-0 z-20 flex flex-col justify-between p-3.5 select-none">
      {/* --- TOP ROW: KILL COUNTER (LEFT) & TIMER (RIGHT) --- */}
      <div className="flex items-center justify-between w-full">
        {/* Left: Kill Counter */}
        <div className="flex items-center gap-1.5 rounded-full bg-black/75 px-3.5 py-1.5 backdrop-blur-md border-2 border-emerald-500/40 text-xs font-mono font-bold text-slate-100 shadow-lg shadow-emerald-950/40">
          <span className="text-red-500 text-sm">🦟</span>
          {gameState.currentLevel < 3 ? (
            <span className="tracking-wide">
              <span className="text-emerald-400">{gameState.kills}</span>
              <span className="text-stone-400"> / </span>
              <span className="text-white">{gameState.targetKills}</span>
            </span>
          ) : (
            <span className="text-red-500 font-black tracking-wider">JEFE</span>
          )}
        </div>

        {/* Level 3 Scream Gauge */}
        {gameState.currentLevel === 3 && (
          <div className="w-28 h-2.5 rounded-full bg-black/80 border-2 border-emerald-500/40 overflow-hidden shadow-lg shadow-emerald-950/40">
            <div
              className="h-full bg-gradient-to-r from-emerald-500 via-emerald-400 to-red-600 transition-all duration-100"
              style={{
                width: `${Math.min(100, (gameState.screamSecondsAccumulated / 10) * 100)}%`,
              }}
            />
          </div>
        )}

        {/* Right: Countdown Timer */}
        <div className={`flex items-center gap-1.5 rounded-full bg-black/75 px-3.5 py-1.5 backdrop-blur-md border-2 ${timerBorderColor} text-xs font-mono font-bold shadow-lg`}>
          <Clock className={`h-3.5 w-3.5 ${timerTextColor}`} />
          <span className={timerTextColor}>{gameState.timeLeft}s</span>
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
            className="flex items-center gap-2 rounded-2xl bg-gradient-to-r from-red-600 to-emerald-600 border-2 border-emerald-400/50 px-5 py-3.5 font-black text-white shadow-xl shadow-red-950/50 active:scale-95 text-xs uppercase tracking-wider"
          >
            <span>📢 GRITAR</span>
          </button>
        )}
      </div>
    </div>
  );
};
