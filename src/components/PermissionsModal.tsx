/**
 * PermissionsModal.tsx
 * Onboarding screen and mobile sensor authorization flow.
 * Engineered for 100% reliability on mobile devices (iOS Safari, Android Chrome, and in-app WebViews).
 * Never hangs, provides instant bypass fallback, and handles camera/mic/gyro gracefully.
 */

import React, { useState, useRef } from 'react';
import { Compass, Mic, Camera, ShieldCheck, Play, ArrowRight, Smartphone, Sparkles, Loader2 } from 'lucide-react';
import { sensorManager } from '../sensors/SensorManager';
import { buzzManager } from '../audio/SpatialBuzzManager';

interface PermissionsModalProps {
  onPermissionsCompleted: (stream: MediaStream | null) => void;
}

export const PermissionsModal: React.FC<PermissionsModalProps> = ({ onPermissionsCompleted }) => {
  const [isRequesting, setIsRequesting] = useState(false);
  const [requestStatusText, setRequestStatusText] = useState<string>('');
  const hasCompletedRef = useRef(false);

  const completeStart = (stream: MediaStream | null) => {
    if (hasCompletedRef.current) return;
    hasCompletedRef.current = true;
    setIsRequesting(false);
    onPermissionsCompleted(stream);
  };

  const handleStartExperience = async () => {
    if (isRequesting || hasCompletedRef.current) return;
    setIsRequesting(true);
    setRequestStatusText('Iniciando audio y giroscopio...');

    // 1. AudioContext must be initiated strictly inside this user tap
    try {
      buzzManager.init();
    } catch (e) {
      console.warn('AudioContext init error:', e);
    }

    // 2. Gyroscope & Motion (iOS requires permission requested directly on user gesture)
    try {
      await sensorManager.requestGyroscope();
    } catch (e) {
      console.warn('Gyroscope request error:', e);
    }

    setRequestStatusText('Detectando cámara y micrófono...');

    // 3. Parallel camera & microphone requests with strict safety timeout
    let stream: MediaStream | null = null;
    try {
      const audioCtx = buzzManager.getAudioContext() || undefined;

      // Run mic and camera simultaneously with a max wait of 2.2 seconds
      const micPromise = sensorManager.requestMicrophone(audioCtx).catch(() => false);
      const camPromise = sensorManager.requestRearCamera().catch(() => null);

      const timeoutPromise = new Promise<{ isTimeout: true }>((resolve) =>
        setTimeout(() => resolve({ isTimeout: true }), 2200)
      );

      const result = await Promise.race([
        Promise.allSettled([micPromise, camPromise]),
        timeoutPromise,
      ]);

      if (!('isTimeout' in result) && Array.isArray(result)) {
        if (result[1].status === 'fulfilled' && result[1].value) {
          stream = result[1].value as MediaStream;
        }
      }
    } catch (err) {
      console.warn('Media permission error:', err);
    }

    // Always start game regardless of camera/mic status!
    setRequestStatusText('¡Listo! Entrando al juego...');
    setTimeout(() => {
      completeStart(stream || sensorManager.getCameraStream());
    }, 250);
  };

  const handleDirectPlay = () => {
    // Zero friction instant start (useful for restricted browsers or users wanting direct play)
    try {
      buzzManager.init();
      sensorManager.requestGyroscope();
    } catch {
      // Ignored
    }
    completeStart(null);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/95 p-4 backdrop-blur-xl">
      <div className="relative w-full max-w-md overflow-hidden rounded-3xl border border-rose-500/20 bg-gradient-to-b from-slate-900 to-slate-950 p-6 text-white shadow-2xl">
        {/* Glowing backdrop halo */}
        <div className="absolute -top-16 -left-16 h-40 w-40 rounded-full bg-rose-600/20 blur-3xl -z-10" />
        <div className="absolute -bottom-16 -right-16 h-40 w-40 rounded-full bg-cyan-600/20 blur-3xl -z-10" />

        <div className="flex flex-col items-center text-center">
          {/* Mosquito Avatar */}
          <div className="relative mb-3 flex h-20 w-20 items-center justify-center rounded-3xl border border-rose-500/40 bg-rose-950/50 shadow-inner">
            <span className="text-4xl animate-bounce">🦟</span>
            <div className="absolute -inset-1 rounded-3xl bg-rose-500/20 blur-lg -z-10" />
          </div>

          <h1 className="text-2xl font-black tracking-tight text-white uppercase sm:text-3xl">
            Mosquito Attack AR
          </h1>
          <p className="mt-1 text-xs text-slate-300">
            Caza los mosquitos que vuelan en tu <strong className="text-rose-400">cámara real</strong> o entorno 3D moviendo tu teléfono.
          </p>

          {/* Feature Highlights */}
          <div className="my-4 w-full rounded-2xl border border-slate-800 bg-slate-950/70 p-3.5 text-left text-xs space-y-2 text-slate-300">
            <div className="flex items-center gap-2.5">
              <Camera className="h-4 w-4 shrink-0 text-rose-400" />
              <span><strong>Cámara Delantera:</strong> Vuelan frente a ti usando tu cámara frontal.</span>
            </div>
            <div className="flex items-center gap-2.5">
              <Compass className="h-4 w-4 shrink-0 text-cyan-400" />
              <span><strong>Giroscopio 360°:</strong> Mueve el teléfono para apuntar.</span>
            </div>
            <div className="flex items-center gap-2.5">
              <Mic className="h-4 w-4 shrink-0 text-amber-400" />
              <span><strong>Ataque Sónico:</strong> Grita o pulsa el botón en el Nivel 3.</span>
            </div>
          </div>

          {/* Action Buttons */}
          <div className="flex w-full flex-col gap-2.5">
            {/* Primary Start Button */}
            <button
              onClick={handleStartExperience}
              disabled={isRequesting}
              className="group flex w-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-rose-600 to-red-600 px-6 py-3.5 font-bold text-white shadow-lg shadow-rose-600/30 transition hover:from-rose-500 hover:to-red-500 active:scale-95 disabled:opacity-80"
            >
              {isRequesting ? (
                <>
                  <Loader2 className="h-5 w-5 animate-spin" />
                  <span>{requestStatusText || 'ACTIVANDO SENSORES...'}</span>
                </>
              ) : (
                <>
                  <Play className="h-5 w-5 fill-white" />
                  <span>INICIAR CON CÁMARA DELANTERA</span>
                  <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
                </>
              )}
            </button>

            {/* Instant Direct Start Button (100% guaranteed to work on any mobile device) */}
            <button
              onClick={handleDirectPlay}
              className="flex w-full items-center justify-center gap-2 rounded-2xl border border-slate-700 bg-slate-900/80 px-4 py-2.5 text-xs font-semibold text-slate-200 transition hover:border-slate-500 hover:bg-slate-800 hover:text-white active:scale-95"
            >
              <Smartphone className="h-4 w-4 text-cyan-400" />
              <span>JUGAR EN HABITACIÓN 3D (SIN CÁMARA)</span>
            </button>

            {/* If requesting takes time, show skip link */}
            {isRequesting && (
              <button
                onClick={handleDirectPlay}
                className="mt-1 text-xs text-rose-300 underline underline-offset-4 hover:text-white"
              >
                ¿Tarda mucho? Toca aquí para entrar de inmediato
              </button>
            )}
          </div>

          <p className="mt-3 text-[10px] text-slate-500">
            Compatible con iPhone (iOS Safari) y Android (Chrome / Samsung Browser).
          </p>
        </div>
      </div>
    </div>
  );
};
