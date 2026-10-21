/**
 * UIOverlay.tsx
 * Clean, distraction-free AR combat HUD:
 * - Top header with audio mute control
 * - Game HUD (Level badge, kills/target counter, countdown timer, Boss scream gauge)
 * - Subtle screen edge guidance arrows
 * - Virtual joystick for movement
 * - Instant tap/swat feedback reticle
 */

import React, { useState, useEffect } from 'react';
import {
  Volume2,
  VolumeX,
  Clock,
  Target,
  Skull,
  Flame,
  Radio,
} from 'lucide-react';
import { SensorStatus, sensorManager } from '../sensors/SensorManager';
import { GameState, NearestMosquitoInfo } from './ThreeCanvas';
import { buzzManager } from '../audio/SpatialBuzzManager';
import { VirtualJoystick } from './VirtualJoystick';

interface UIOverlayProps {
  gameState: GameState;
  sensorStatus?: SensorStatus;
  currentVolume: number;
  isScreaming: boolean;
  onCalibrateGyro?: () => void;
  forwardDistance?: number;
  nearestMosquito?: NearestMosquitoInfo | null;
}

export const UIOverlay: React.FC<UIOverlayProps> = ({
  gameState,
  currentVolume,
  isScreaming,
  nearestMosquito,
}) => {
  const [isMuted, setIsMuted] = useState(false);
  const [swatEffect, setSwatEffect] = useState<{ x: number; y: number } | null>(null);

  const toggleMute = () => {
    const nextMute = !isMuted;
    setIsMuted(nextMute);
    buzzManager.setMuted(nextMute);
  };

  // Screen click/tap slap visual feedback
  useEffect(() => {
    const handleTap = (e: MouseEvent | TouchEvent) => {
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.closest('[data-no-swat]') ||
          target.closest('button') ||
          target.closest('input') ||
          target.closest('.pointer-events-auto'))
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
      setTimeout(() => setSwatEffect(null), 250);
    };

    window.addEventListener('click', handleTap);
    return () => window.removeEventListener('click', handleTap);
  }, []);

  const timerColor =
    gameState.timeLeft <= 5
      ? 'text-red-500 animate-pulse font-extrabold'
      : gameState.timeLeft <= 10
      ? 'text-amber-400'
      : 'text-white';

  const screamPercent = Math.min(100, (gameState.screamSecondsAccumulated / 10) * 100);

  return (
    <div className="pointer-events-none absolute inset-0 z-20 flex flex-col justify-between p-3 select-none">
      {/* --- TOP ROW: AUDIO CONTROLS & HUD --- */}
      <div className="flex flex-col gap-2 w-full">
        {/* Top bar right control */}
        <div className="flex items-center justify-end w-full">
          <button
            onClick={toggleMute}
            aria-label={isMuted ? 'Activar sonido' : 'Silenciar'}
            className="pointer-events-auto flex items-center justify-center rounded-full border border-white/15 bg-black/60 p-2.5 text-slate-200 transition hover:bg-black/80 hover:text-white active:scale-95 backdrop-blur-md shadow-xl"
          >
            {isMuted ? (
              <VolumeX className="h-5 w-5 text-rose-400" />
            ) : (
              <Volume2 className="h-5 w-5 text-emerald-400" />
            )}
          </button>
        </div>

        {/* --- LEVEL OBJECTIVE & TIMER HUD --- */}
        <div className="flex flex-col items-center gap-2">
          <div className="flex items-center justify-between gap-4 rounded-full border border-white/15 bg-black/75 px-5 py-2 backdrop-blur-md shadow-2xl">
            {/* Level Badge */}
            <div className="flex items-center gap-1.5">
              <span className="rounded-md bg-rose-600/90 px-2 py-0.5 text-xs font-bold tracking-wider text-white">
                NIVEL {gameState.currentLevel}
              </span>
            </div>

            <div className="h-4 w-[1px] bg-white/20" />

            {/* Kill Progress or Boss Status */}
            {gameState.currentLevel < 3 ? (
              <div className="flex items-center gap-1.5 text-sm font-bold text-slate-100">
                <Target className="h-4 w-4 text-rose-400" />
                <span>
                  {gameState.kills} / {gameState.targetKills}
                </span>
                <span className="text-xs text-slate-400 font-normal hidden sm:inline">mosquitos</span>
              </div>
            ) : (
              <div className="flex items-center gap-1.5 text-sm font-black text-rose-400 animate-pulse">
                <Skull className="h-4 w-4 text-red-500" />
                <span>MOSQUITO GIGANTE</span>
              </div>
            )}

            <div className="h-4 w-[1px] bg-white/20" />

            {/* Timer */}
            <div className="flex items-center gap-1.5 font-mono text-sm font-bold">
              <Clock className={`h-4 w-4 ${timerColor}`} />
              <span className={timerColor}>{gameState.timeLeft}s</span>
            </div>
          </div>

          {/* BOSS SCREAM GAUGE (Level 3 only) */}
          {gameState.currentLevel === 3 && (
            <div className="w-full max-w-sm rounded-2xl border-2 border-rose-500/40 bg-black/85 p-3 backdrop-blur-xl shadow-2xl">
              <div className="flex items-center justify-between text-xs font-bold text-rose-300">
                <span className="flex items-center gap-1.5">
                  <Flame className="h-4 w-4 text-amber-400 animate-bounce" />
                  ¡GRITA LO MÁS FUERTE POSIBLE!
                </span>
                <span className="font-mono text-amber-300">
                  {gameState.screamSecondsAccumulated.toFixed(1)}s / 10s
                </span>
              </div>

              {/* Scream Progress Bar */}
              <div className="mt-2 h-4 w-full overflow-hidden rounded-full bg-slate-900 border border-rose-900/60 p-0.5">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-amber-500 via-rose-500 to-purple-600 transition-all duration-100"
                  style={{ width: `${screamPercent}%` }}
                />
              </div>

              {/* Live scream status badge */}
              <div className="mt-1.5 flex items-center justify-center gap-1 text-[11px]">
                {isScreaming ? (
                  <span className="font-bold text-amber-400 animate-pulse flex items-center gap-1">
                    <Radio className="h-3 w-3" /> ¡DAÑANDO AL MOSQUITO GIGANTE!
                  </span>
                ) : (
                  <span className="text-slate-400">
                    Volumen actual: {Math.round(currentVolume * 100)}% (necesitas &gt; 62% para grito)
                  </span>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* --- RETICLE / TAP SQUISH FEEDBACK --- */}
      {swatEffect && (
        <div
          className="pointer-events-none fixed -translate-x-1/2 -translate-y-1/2"
          style={{ left: swatEffect.x, top: swatEffect.y }}
        >
          <div className="h-16 w-16 rounded-full border-4 border-rose-500/80 bg-rose-500/20 animate-ping" />
        </div>
      )}



      {/* --- BOTTOM CONTROLS: VIRTUAL JOYSTICK ONLY --- */}
      <footer className="pb-3 pl-2 pointer-events-none">
        <div className="flex items-end justify-between w-full">
          {/* Virtual Joystick for touch movement (Bottom Left) */}
          <div className="pointer-events-auto">
            <VirtualJoystick
              size={120}
              onMove={(vec) => {
                sensorManager.setJoystickInput(vec.x, vec.y);
              }}
            />
          </div>
        </div>
      </footer>
    </div>
  );
};
