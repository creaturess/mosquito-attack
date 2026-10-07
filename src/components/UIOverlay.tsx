/**
 * UIOverlay.tsx
 * Top bar sensor indicators, VU-meter, live timer, kill counter,
 * Level 3 Boss Scream Meter, crosshair swat reticle, and AR mode toggle.
 */

import React, { useState, useEffect } from 'react';
import {
  Compass,
  Mic,
  MicOff,
  Camera,
  Volume2,
  VolumeX,
  Clock,
  Target,
  Skull,
  Flame,
  Radio,
} from 'lucide-react';
import { SensorStatus } from '../sensors/SensorManager';
import { GameState } from './ThreeCanvas';
import { buzzManager } from '../audio/SpatialBuzzManager';

interface UIOverlayProps {
  gameState: GameState;
  sensorStatus: SensorStatus;
  currentVolume: number;
  isScreaming: boolean;
  onToggleAR: () => void;
  onCalibrateGyro: () => void;
}

export const UIOverlay: React.FC<UIOverlayProps> = ({
  gameState,
  sensorStatus,
  currentVolume,
  isScreaming,
  onToggleAR,
  onCalibrateGyro,
}) => {
  const [isMuted, setIsMuted] = useState(false);
  const [swatEffect, setSwatEffect] = useState<{ x: number; y: number } | null>(null);

  const toggleMute = () => {
    const nextMute = !isMuted;
    setIsMuted(nextMute);
    buzzManager.setMuted(nextMute);
  };

  // Listen to screen taps to show brief slap animation
  useEffect(() => {
    const handleTap = (e: MouseEvent | TouchEvent) => {
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
      {/* --- TOP STATUS BAR --- */}
      <header className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-white/10 bg-slate-900/80 p-2.5 backdrop-blur-md shadow-xl">
        {/* Left: Sensor badges */}
        <div className="flex items-center gap-2">
          {/* Gyroscope Indicator */}
          <button
            onClick={onCalibrateGyro}
            title="Centrar Giroscopio"
            className="pointer-events-auto flex items-center gap-1.5 rounded-xl border border-cyan-500/30 bg-cyan-950/40 px-2.5 py-1 text-xs font-medium text-cyan-300 transition hover:bg-cyan-900/60 active:scale-95"
          >
            <Compass className="h-3.5 w-3.5 animate-spin" style={{ animationDuration: '6s' }} />
            <span className="hidden sm:inline">Giroscopio</span>
            <span className="text-[10px] text-cyan-400 font-mono">
              {sensorStatus.gyroscopeActive ? 'ACTIVO' : 'MANUAL'}
            </span>
          </button>

          {/* Mic VU-Meter */}
          <div className="flex items-center gap-1.5 rounded-xl border border-emerald-500/30 bg-emerald-950/40 px-2.5 py-1 text-xs text-emerald-300">
            {sensorStatus.micActive ? (
              <Mic className="h-3.5 w-3.5 text-emerald-400" />
            ) : (
              <MicOff className="h-3.5 w-3.5 text-red-400" />
            )}
            <span className="hidden sm:inline">Mic</span>
            {/* Realtime VU Bar */}
            <div className="flex h-2.5 w-12 items-center gap-0.5 rounded bg-slate-950/60 p-0.5">
              {[0.15, 0.35, 0.55, 0.75, 0.9].map((thresh, idx) => (
                <div
                  key={idx}
                  className={`h-full flex-1 rounded-xs transition-colors duration-75 ${
                    currentVolume >= thresh
                      ? idx >= 3
                        ? 'bg-rose-500 animate-pulse'
                        : idx >= 2
                        ? 'bg-amber-400'
                        : 'bg-emerald-400'
                      : 'bg-slate-700/50'
                  }`}
                />
              ))}
            </div>
          </div>
        </div>

        {/* Right: Controls (AR Mode & Mute) */}
        <div className="flex items-center gap-2">
          <button
            onClick={onToggleAR}
            className={`pointer-events-auto flex items-center gap-1.5 rounded-xl border px-2.5 py-1 text-xs font-semibold transition active:scale-95 ${
              gameState.isARMode
                ? 'border-indigo-400 bg-indigo-600 text-white shadow-lg shadow-indigo-500/20'
                : 'border-white/10 bg-slate-800/80 text-slate-300 hover:bg-slate-700'
            }`}
          >
            <Camera className="h-3.5 w-3.5" />
            <span>{gameState.isARMode ? 'AR ON' : '3D Noche'}</span>
          </button>

          <button
            onClick={toggleMute}
            className="pointer-events-auto rounded-xl border border-white/10 bg-slate-800/80 p-1.5 text-slate-300 transition hover:bg-slate-700 active:scale-95"
          >
            {isMuted ? <VolumeX className="h-4 w-4 text-rose-400" /> : <Volume2 className="h-4 w-4 text-emerald-400" />}
          </button>
        </div>
      </header>

      {/* --- LEVEL OBJECTIVE & TIMER HUD --- */}
      <div className="flex flex-col items-center gap-2">
        <div className="flex items-center justify-between gap-4 rounded-full border border-white/15 bg-black/70 px-5 py-2 backdrop-blur-md shadow-2xl">
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

      {/* --- RETICLE / TAP SQUISH FEEDBACK --- */}
      {swatEffect && (
        <div
          className="pointer-events-none fixed -translate-x-1/2 -translate-y-1/2"
          style={{ left: swatEffect.x, top: swatEffect.y }}
        >
          <div className="h-16 w-16 rounded-full border-4 border-rose-500/80 bg-rose-500/20 animate-ping" />
        </div>
      )}

      {/* Bottom helper tip */}
      <footer className="flex justify-center pb-2">
        <div className="flex items-center gap-2 rounded-full border border-white/10 bg-black/50 px-3.5 py-1 text-center text-xs text-slate-300 backdrop-blur-sm">
          <span>🎧 Usa auriculares para escuchar la posición 3D del zumbido</span>
          <span className="text-slate-500">•</span>
          <span>Toca la pantalla para aplastarlo</span>
        </div>
      </footer>
    </div>
  );
};
