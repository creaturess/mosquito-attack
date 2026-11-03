/**
 * PermissionsModal.tsx
 * Onboarding screen and mobile sensor authorization flow.
 * Exclusively requires Front Camera (selfie camera) for AR gameplay.
 * 3D bedroom / room mode has been completely removed.
 */

import React, { useState, useRef } from 'react';
import { Compass, Mic, Camera, Play, ArrowRight, Loader2, AlertCircle, RefreshCw } from 'lucide-react';
import { sensorManager } from '../sensors/SensorManager';
import { buzzManager } from '../audio/SpatialBuzzManager';

interface PermissionsModalProps {
  onPermissionsCompleted: (stream: MediaStream) => void;
}

export const PermissionsModal: React.FC<PermissionsModalProps> = ({ onPermissionsCompleted }) => {
  const [isRequesting, setIsRequesting] = useState(false);
  const [requestStatusText, setRequestStatusText] = useState<string>('');
  const [cameraError, setCameraError] = useState<string | null>(null);
  const hasCompletedRef = useRef(false);

  const completeStart = (stream: MediaStream) => {
    if (hasCompletedRef.current) return;
    hasCompletedRef.current = true;
    setIsRequesting(false);
    onPermissionsCompleted(stream);
  };

  const handleStartExperience = async () => {
    if (isRequesting || hasCompletedRef.current) return;
    setIsRequesting(true);
    setCameraError(null);
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

    setRequestStatusText('Activando cámara frontal...');

    // 3. Request microphone in background and Front Camera (mandatory)
    let stream: MediaStream | null = null;
    try {
      const audioCtx = buzzManager.getAudioContext() || undefined;
      // Start mic request (non-blocking for gameplay)
      sensorManager.requestMicrophone(audioCtx).catch(() => false);

      // Front camera is strictly required
      stream = await sensorManager.requestFrontCamera();
    } catch (err) {
      console.warn('Front camera permission error:', err);
    }

    // If camera failed or was denied, do NOT proceed to any 3D room.
    if (!stream) {
      setIsRequesting(false);
      setCameraError(
        'Se requiere acceso a la cámara frontal para jugar a Mosquito Attack. Por favor, permite el acceso a la cámara en los permisos de tu navegador.'
      );
      return;
    }

    setRequestStatusText('¡Cámara frontal activada! Entrando...');
    setTimeout(() => {
      completeStart(stream!);
    }, 250);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 p-4 backdrop-blur-xl">
      <div className="relative w-full max-w-md overflow-hidden rounded-3xl border-2 border-emerald-500/40 bg-gradient-to-b from-stone-950 via-emerald-950/30 to-black p-6 text-white shadow-2xl shadow-emerald-950/50">
        {/* Glowing backdrop halos (Green and Red) */}
        <div className="absolute -top-16 -left-16 h-48 w-48 rounded-full bg-emerald-600/25 blur-3xl -z-10" />
        <div className="absolute -bottom-16 -right-16 h-48 w-48 rounded-full bg-red-600/25 blur-3xl -z-10" />

        <div className="flex flex-col items-center text-center">
          {/* Mosquito Avatar with Green & Red ring */}
          <div className="relative mb-3 flex h-20 w-20 items-center justify-center rounded-3xl border-2 border-red-500/60 bg-red-950/50 shadow-inner shadow-red-900/50">
            <span className="text-4xl animate-bounce">🦟</span>
            <div className="absolute -inset-1.5 rounded-3xl border border-emerald-400/30 blur-sm -z-10" />
          </div>

          {/* Exact Requested Title */}
          <h1 className="text-3xl font-black tracking-wider text-emerald-400 uppercase sm:text-4xl drop-shadow-[0_2px_10px_rgba(16,185,129,0.35)]">
            MOSQUITO ATTACK
          </h1>

          {/* Exact Requested Tagline */}
          <p className="mt-2 text-sm font-semibold tracking-wide text-red-300 sm:text-base">
            Escuchá el zumbido , seguilo y matalo
          </p>

          {/* Feature Highlights with Green and Red accents */}
          <div className="my-5 w-full rounded-2xl border border-emerald-900/60 bg-black/70 p-3.5 text-left text-xs space-y-2.5 text-stone-200">
            <div className="flex items-center gap-2.5">
              <Camera className="h-4 w-4 shrink-0 text-emerald-400" />
              <span>
                <strong className="text-emerald-300">Cámara Frontal:</strong> Mirá tu entorno real para encontrar a los mosquitos.
              </span>
            </div>
            <div className="flex items-center gap-2.5">
              <Compass className="h-4 w-4 shrink-0 text-red-400" />
              <span>
                <strong className="text-red-300">Giroscopio 360°:</strong> Movete y apuntá con tu teléfono en el espacio.
              </span>
            </div>
            <div className="flex items-center gap-2.5">
              <Mic className="h-4 w-4 shrink-0 text-emerald-400" />
              <span>
                <strong className="text-emerald-300">Ataque Sónico:</strong> En el Jefe Final vas a tener que gritar para vencerlo.
              </span>
            </div>
          </div>

          {/* Camera Error Alert if permission was denied */}
          {cameraError && (
            <div className="mb-4 flex w-full items-start gap-2.5 rounded-2xl border border-red-500/60 bg-red-950/70 p-3 text-left text-xs text-red-200">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-400" />
              <div>
                <p className="font-bold text-red-100">Permiso de cámara requerido</p>
                <p className="mt-0.5 text-[11px] leading-relaxed text-red-200/90">{cameraError}</p>
              </div>
            </div>
          )}

          {/* Action Button: JUGAR */}
          <div className="flex w-full flex-col gap-2.5">
            <button
              onClick={handleStartExperience}
              disabled={isRequesting}
              className="group relative flex w-full items-center justify-center gap-3 overflow-hidden rounded-2xl border-2 border-emerald-400/50 bg-gradient-to-r from-emerald-600 via-emerald-500 to-red-600 px-8 py-4 text-xl font-black tracking-widest text-white shadow-xl shadow-emerald-950/50 transition hover:from-emerald-500 hover:to-red-500 active:scale-95 disabled:opacity-80"
            >
              {isRequesting ? (
                <>
                  <Loader2 className="h-6 w-6 animate-spin text-white" />
                  <span className="text-sm uppercase tracking-wider">{requestStatusText || 'INICIANDO...'}</span>
                </>
              ) : cameraError ? (
                <>
                  <RefreshCw className="h-5 w-5 text-white" />
                  <span className="text-sm">REINTENTAR ACCESO A CÁMARA</span>
                </>
              ) : (
                <>
                  <Play className="h-6 w-6 fill-white text-white transition-transform group-hover:scale-110" />
                  <span>JUGAR</span>
                  <ArrowRight className="h-5 w-5 transition-transform group-hover:translate-x-1.5" />
                </>
              )}
            </button>
          </div>

          <p className="mt-3 text-[11px] text-stone-400">
            Usá auriculares para ubicar el zumbido en 3D en el espacio.
          </p>
        </div>
      </div>
    </div>
  );
};
