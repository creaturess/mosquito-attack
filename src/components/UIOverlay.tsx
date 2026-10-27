/**
 * UIOverlay.tsx
 * Clean, distraction-free AR combat HUD:
 * - Subtle "caliente/frío" perimeter vignette that intensifies when close to a mosquito
 * - Reactive center aim reticle with target lock animation when pointing at a mosquito
 * - Subtle screen edge exit indicator (arrow/tag) showing where a mosquito just exited for ~1.5s
 * - Top header with audio mute control & interactive Debug toggle button
 * - Game HUD (Level badge, kills/target counter, countdown timer, Boss scream gauge)
 * - Optional Debug HUD window showing all fixed world nests, 3D distances, and alive counts
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
  Eye,
  Crosshair,
} from 'lucide-react';
import { SensorStatus } from '../sensors/SensorManager';
import {
  GameState,
  NearestMosquitoInfo,
  DebugNestInfo,
  EdgeIndicatorInfo,
} from './ThreeCanvas';
import { buzzManager } from '../audio/SpatialBuzzManager';

interface UIOverlayProps {
  gameState: GameState;
  sensorStatus?: SensorStatus;
  currentVolume: number;
  isScreaming: boolean;
  onCalibrateGyro?: () => void;
  forwardDistance?: number;
  nearestMosquito?: NearestMosquitoInfo | null;
  proximityHeat?: number;
  isAimingNear?: boolean;
  edgeIndicator?: EdgeIndicatorInfo | null;
  isDebugMode?: boolean;
  onToggleDebug?: () => void;
  debugNests?: DebugNestInfo[];
}

export const UIOverlay: React.FC<UIOverlayProps> = ({
  gameState,
  currentVolume,
  isScreaming,
  proximityHeat = 0,
  isAimingNear = false,
  edgeIndicator = null,
  isDebugMode = false,
  onToggleDebug,
  debugNests = [],
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

  // Subtle hot/cold vignette intensity calculation
  const vignetteAlpha = Math.min(0.55, proximityHeat * 0.55);
  const vignetteSpread = Math.round(18 + proximityHeat * 50);

  return (
    <div className="pointer-events-none absolute inset-0 z-20 flex flex-col justify-between p-3 select-none">
      {/* --- SUBTLE HOT/COLD PERIMETER VIGNETTE (CALIENTE / FRÍO) --- */}
      {proximityHeat > 0.05 && (
        <div
          className="pointer-events-none absolute inset-0 transition-all duration-300 ease-out"
          style={{
            boxShadow: `inset 0 0 ${vignetteSpread}px rgba(244, 63, 94, ${vignetteAlpha.toFixed(2)})`,
          }}
        />
      )}

      {/* --- SUBTLE SCREEN EDGE EXIT INDICATOR (Fades over ~1.5s when losing sight) --- */}
      {edgeIndicator && edgeIndicator.opacity > 0.05 && (
        <div
          className="pointer-events-none absolute inset-0 flex items-center justify-center overflow-hidden transition-opacity duration-150"
          style={{ opacity: edgeIndicator.opacity }}
        >
          <div
            className="absolute flex items-center justify-center"
            style={{
              transform: `translate(${Math.max(-42, Math.min(42, edgeIndicator.x * 40))}vw, ${Math.max(-40, Math.min(40, -edgeIndicator.y * 38))}vh) rotate(${-Math.atan2(edgeIndicator.y, edgeIndicator.x)}rad)`,
            }}
          >
            <div className="flex items-center gap-1.5 rounded-full border border-sky-400/80 bg-slate-950/85 px-3 py-1 text-sky-300 shadow-xl shadow-sky-500/40 backdrop-blur-md animate-pulse">
              <span className="text-xs font-bold">▶</span>
              <span className="text-[10px] font-black tracking-widest uppercase">MOSQUITO</span>
            </div>
          </div>
        </div>
      )}

      {/* --- REACTIVE CENTER AIM RETICLE --- */}
      <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
        <div
          className={`flex items-center justify-center rounded-full transition-all duration-200 ${
            isAimingNear
              ? 'scale-135 border-2 border-amber-400 bg-amber-400/25 shadow-xl shadow-amber-500/60 ring-2 ring-amber-300/40'
              : 'border border-white/30 bg-black/15 shadow-sm'
          } h-9 w-9`}
        >
          <Crosshair
            className={`h-4 w-4 transition-all duration-200 ${
              isAimingNear ? 'text-amber-300 scale-110' : 'text-white/50'
            }`}
          />
        </div>
        {isAimingNear && (
          <div className="absolute -translate-y-8 flex items-center gap-1 rounded bg-black/70 px-1.5 py-0.5 text-[9px] font-bold text-amber-300 backdrop-blur-sm border border-amber-400/50 animate-bounce">
            OBJETIVO A LA VISTA
          </div>
        )}
      </div>

      {/* --- TOP ROW: CONTROLS & HUD --- */}
      <div className="flex flex-col gap-2 w-full">
        {/* Top bar buttons */}
        <div className="flex items-center justify-between w-full">
          {/* Debug Toggle Button */}
          <button
            onClick={onToggleDebug}
            data-no-swat="true"
            aria-label="Alternar modo depuración"
            className={`pointer-events-auto flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold backdrop-blur-md transition shadow-lg active:scale-95 ${
              isDebugMode
                ? 'border-emerald-400 bg-emerald-950/80 text-emerald-300'
                : 'border-white/15 bg-black/60 text-slate-300 hover:text-white hover:bg-black/80'
            }`}
          >
            <Eye className="h-3.5 w-3.5" />
            <span>DEBUG {isDebugMode ? 'ON' : 'OFF'}</span>
          </button>

          {/* Sound Mute Button */}
          <button
            onClick={toggleMute}
            data-no-swat="true"
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

      {/* --- DEBUG MODE OVERLAY PANEL --- */}
      {isDebugMode && (
        <div
          data-no-swat="true"
          className="pointer-events-auto absolute top-20 left-3 max-w-xs rounded-xl border border-emerald-500/40 bg-black/85 p-3 text-xs backdrop-blur-lg shadow-2xl text-slate-200 overflow-y-auto max-h-[60vh]"
        >
          <div className="flex items-center justify-between pb-1.5 border-b border-white/10 font-bold text-emerald-400">
            <span>MODO DEBUG (NIDOS 3D)</span>
            <span className="text-[10px] text-slate-400">Tecla &apos;D&apos; para alternar</span>
          </div>

          <div className="mt-2 space-y-1.5">
            {debugNests.map((nest, idx) => (
              <div
                key={nest.id}
                className="flex items-center justify-between rounded bg-white/5 px-2 py-1"
              >
                <div>
                  <span className="font-bold text-slate-100">Nido {idx + 1}:</span>{' '}
                  <span className="font-mono text-emerald-300">{nest.distance}m</span>
                  <div className="text-[10px] text-slate-400 font-mono">
                    [{nest.x}, {nest.y}, {nest.z}]
                  </div>
                </div>
                <div className="text-right">
                  <span
                    className={`inline-block rounded px-1.5 py-0.5 text-[10px] font-bold ${
                      nest.aliveCount > 0 ? 'bg-emerald-900/80 text-emerald-300' : 'bg-rose-900/80 text-rose-300'
                    }`}
                  >
                    {nest.aliveCount > 0 ? `${nest.aliveCount} vivo` : 'reapareciendo...'}
                  </span>
                </div>
              </div>
            ))}
          </div>

          <div className="mt-2 pt-1 border-t border-white/10 text-[10px] text-slate-400">
            Calor proximidad: <span className="font-mono text-amber-300">{Math.round(proximityHeat * 100)}%</span>
            {isAimingNear && <span className="ml-1 text-emerald-300 font-bold">| ¡Apuntando a mosquito!</span>}
          </div>
        </div>
      )}

      {/* --- RETICLE / TAP SQUISH FEEDBACK --- */}
      {swatEffect && (
        <div
          className="pointer-events-none fixed -translate-x-1/2 -translate-y-1/2"
          style={{ left: swatEffect.x, top: swatEffect.y }}
        >
          <div className="h-16 w-16 rounded-full border-4 border-rose-500/80 bg-rose-500/20 animate-ping" />
        </div>
      )}
    </div>
  );
};
