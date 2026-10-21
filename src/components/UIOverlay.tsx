/**
 * UIOverlay.tsx
 * Top bar sensor indicators, VU-meter, live timer, kill counter,
 * Level 3 Boss Scream Meter, crosshair swat reticle, AR mode toggle,
 * and 6DOF Spatial Motion controls & distance indicator.
 */

import React, { useState, useEffect } from 'react';
import {
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
  Move3d,
  RotateCcw,
  Sliders,
} from 'lucide-react';
import { SensorStatus, sensorManager } from '../sensors/SensorManager';
import { GameState } from './ThreeCanvas';
import { buzzManager } from '../audio/SpatialBuzzManager';
import { VirtualJoystick } from './VirtualJoystick';

interface UIOverlayProps {
  gameState: GameState;
  sensorStatus: SensorStatus;
  currentVolume: number;
  isScreaming: boolean;
  onToggleAR: () => void;
  onCalibrateGyro: () => void;
  forwardDistance?: number;
}

export const UIOverlay: React.FC<UIOverlayProps> = ({
  gameState,
  sensorStatus,
  currentVolume,
  isScreaming,
  onToggleAR,
  onCalibrateGyro,
  forwardDistance = 0,
}) => {
  const [isMuted, setIsMuted] = useState(false);
  const [swatEffect, setSwatEffect] = useState<{ x: number; y: number } | null>(null);
  const [sensitivityMode, setSensitivityMode] = useState<'normal' | 'high' | 'ultra'>('normal');
  const [showSensitivityMenu, setShowSensitivityMenu] = useState(false);

  const toggleMute = () => {
    const nextMute = !isMuted;
    setIsMuted(nextMute);
    buzzManager.setMuted(nextMute);
  };

  const handleSetSensitivity = (mode: 'normal' | 'high' | 'ultra') => {
    setSensitivityMode(mode);
    if (mode === 'normal') sensorManager.motionSensitivity = 1.2;
    if (mode === 'high') sensorManager.motionSensitivity = 2.0;
    if (mode === 'ultra') sensorManager.motionSensitivity = 3.0;
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
      {/* --- TOP STATUS BAR --- */}
      <header className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-white/10 bg-slate-900/85 p-2.5 backdrop-blur-md shadow-xl">
        {/* Left: Sensor badges */}
        <div className="flex items-center gap-2">
          {/* Gyroscope & Motion Indicator */}
          <button
            onClick={onCalibrateGyro}
            title="Centrar orientación y posición"
            className="pointer-events-auto flex items-center gap-1.5 rounded-xl border border-cyan-500/30 bg-cyan-950/40 px-2.5 py-1 text-xs font-medium text-cyan-300 transition hover:bg-cyan-900/60 active:scale-95"
          >
            <Move3d className="h-3.5 w-3.5 text-cyan-400 animate-pulse" />
            <span className="hidden sm:inline">Tracking 6DOF</span>
            <span className="text-[10px] text-cyan-300 font-mono font-bold">
              {sensorStatus.motionActive || sensorStatus.gyroscopeActive ? 'ACTIVO' : 'MANUAL'}
            </span>
          </button>

          {/* Spatial forward/backward displacement tag */}
          <div className="hidden xs:flex items-center gap-1 rounded-xl border border-blue-500/30 bg-blue-950/40 px-2 py-1 text-[11px] font-mono text-blue-300">
            <span>Avance:</span>
            <span className={forwardDistance >= 0.1 ? 'text-emerald-400 font-bold' : forwardDistance <= -0.1 ? 'text-amber-400 font-bold' : 'text-slate-300'}>
              {forwardDistance > 0 ? `+${forwardDistance.toFixed(1)}m` : `${forwardDistance.toFixed(1)}m`}
            </span>
          </div>

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

        {/* Right: Controls (Sensitivity, AR Mode & Mute) */}
        <div className="flex items-center gap-2">
          {/* Motion Sensitivity Menu */}
          <div className="relative pointer-events-auto">
            <button
              onClick={() => setShowSensitivityMenu(!showSensitivityMenu)}
              className="flex items-center gap-1 rounded-xl border border-white/10 bg-slate-800/80 px-2 py-1 text-xs text-slate-300 transition hover:bg-slate-700 active:scale-95"
              title="Ajustar sensibilidad de movimiento"
            >
              <Sliders className="h-3 w-3" />
              <span className="text-[10px] uppercase font-bold">{sensitivityMode}</span>
            </button>
            {showSensitivityMenu && (
              <div className="absolute right-0 top-full mt-1 flex flex-col gap-1 rounded-xl border border-slate-700 bg-slate-900 p-1.5 shadow-2xl z-30 min-w-28">
                <span className="text-[10px] text-slate-400 px-2 py-0.5 font-semibold">Sensibilidad</span>
                {(['normal', 'high', 'ultra'] as const).map((mode) => (
                  <button
                    key={mode}
                    onClick={() => {
                      handleSetSensitivity(mode);
                      setShowSensitivityMenu(false);
                    }}
                    className={`rounded-lg px-2 py-1 text-left text-xs font-medium transition capitalize ${
                      sensitivityMode === mode ? 'bg-rose-600 text-white' : 'text-slate-300 hover:bg-slate-800'
                    }`}
                  >
                    {mode === 'normal' ? 'Normal (1.6x)' : mode === 'high' ? 'Alta (2.6x)' : 'Ultra (3.8x)'}
                  </button>
                ))}
              </div>
            )}
          </div>

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

      {/* --- BOTTOM CONTROLS: VIRTUAL JOYSTICK & RECENTER --- */}
      <footer className="flex flex-col gap-2 pb-1 pointer-events-none">
        {/* Main bottom row */}
        <div className="flex items-end justify-between w-full px-1">
          {/* Virtual Joystick for 360-degree touch movement (Bottom Left) */}
          <div className="pointer-events-auto pl-1 pb-1">
            <VirtualJoystick
              size={120}
              onMove={(vec) => {
                sensorManager.setJoystickInput(vec.x, vec.y);
              }}
            />
          </div>

          {/* Right Bottom Actions: Recenter Button & Displacement Badge */}
          <div className="flex flex-col items-end gap-2 pr-1 pb-2 pointer-events-auto">
            {/* Quick Recenter Orientation Button */}
            <button
              onClick={onCalibrateGyro}
              className="flex items-center gap-1.5 rounded-2xl border border-cyan-500/40 bg-slate-900/85 px-3.5 py-2.5 text-xs font-semibold text-cyan-300 hover:text-white hover:bg-slate-800 backdrop-blur-md shadow-xl transition active:scale-95"
              title="Re-centrar orientación y posición al origen"
            >
              <RotateCcw className="h-4 w-4 text-cyan-400" />
              <span>Centrar Giroscopio</span>
            </button>
          </div>
        </div>

        {/* Dynamic Tip */}
        <div className="flex flex-wrap items-center justify-center gap-1.5 rounded-full border border-white/10 bg-black/75 px-4 py-1.5 text-center text-xs text-slate-300 backdrop-blur-md shadow-lg pointer-events-none mx-auto max-w-lg">
          <span className="text-cyan-400 font-semibold flex items-center gap-1">
            🕹️ Usa el mando táctil para moverte • Gira el celular para apuntar
          </span>
          <span className="text-slate-500 hidden sm:inline">•</span>
          <span className="text-slate-300 hidden sm:inline">🎧 Sigue el zumbido 3D y aplasta tocando la pantalla</span>
        </div>
      </footer>
    </div>
  );
};
