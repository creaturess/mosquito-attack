/**
 * PermissionsModal.tsx
 * Initial screen for MOSQUITO ATTACK with mode selection:
 * - JUGAR CON CÁMARA: Launches the original front-camera AR mode (100% untouched)
 * - JUGAR EN EL CAMPO: Launches the new 3D meadow exploration mode
 */

import React, { useState, useRef } from 'react';
import { Compass, Mic, Camera, Trees, ArrowRight, Loader2, AlertCircle, RefreshCw } from 'lucide-react';
import { sensorManager } from '../sensors/SensorManager';
import { buzzManager } from '../audio/SpatialBuzzManager';

interface PermissionsModalProps {
  onPermissionsCompleted: (stream: MediaStream) => void;
  onStartFieldMode: () => void;
}

export const PermissionsModal: React.FC<PermissionsModalProps> = ({
  onPermissionsCompleted,
  onStartFieldMode,
}) => {
  const [isRequesting, setIsRequesting] = useState(false);
  const [requestStatusText, setRequestStatusText] = useState<string>('');
  const [cameraError, setCameraError] = useState<string | null>(null);
  const hasCompletedRef = useRef(false);

  const completeStartCamera = (stream: MediaStream) => {
    if (hasCompletedRef.current) return;
    hasCompletedRef.current = true;
    setIsRequesting(false);
    onPermissionsCompleted(stream);
  };

  // Flow for "JUGAR CON CÁMARA" (Original AR Mode)
  const handleStartCameraMode = async () => {
    if (isRequesting || hasCompletedRef.current) return;
    setIsRequesting(true);
    setCameraError(null);
    setRequestStatusText('Iniciando audio y giroscopio...');

    // 1. AudioContext
    try {
      buzzManager.init();
    } catch (e) {
      console.warn('AudioContext init error:', e);
    }

    // 2. Gyroscope & Motion
    try {
      await sensorManager.requestGyroscope();
    } catch (e) {
      console.warn('Gyroscope request error:', e);
    }

    setRequestStatusText('Activando cámara frontal...');

    // 3. Microphone & Front Camera
    let stream: MediaStream | null = null;
    try {
      const audioCtx = buzzManager.getAudioContext() || undefined;
      sensorManager.requestMicrophone(audioCtx).catch(() => false);
      stream = await sensorManager.requestFrontCamera();
    } catch (err) {
      console.warn('Front camera permission error:', err);
    }

    if (!stream) {
      setIsRequesting(false);
      setCameraError(
        'Se requiere acceso a la cámara frontal para jugar a Mosquito Attack. Por favor, permite el acceso a la cámara en los permisos de tu navegador.'
      );
      return;
    }

    setRequestStatusText('¡Cámara frontal activada! Entrando...');
    setTimeout(() => {
      completeStartCamera(stream!);
    }, 250);
  };

  // Flow for "JUGAR EN EL CAMPO" (Field Mode)
  const handleStartFieldMode = async () => {
    if (isRequesting || hasCompletedRef.current) return;
    setIsRequesting(true);
    setRequestStatusText('Preparando el campo...');

    try {
      buzzManager.init();
    } catch (e) {
      console.warn('AudioContext init error:', e);
    }

    // Request microphone for Level 3 boss scream
    try {
      const audioCtx = buzzManager.getAudioContext() || undefined;
      sensorManager.requestMicrophone(audioCtx).catch(() => false);
    } catch (e) {
      console.warn('Microphone request error:', e);
    }

    setTimeout(() => {
      hasCompletedRef.current = true;
      setIsRequesting(false);
      onStartFieldMode();
    }, 200);
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

          {/* Camera Error Alert if permission was denied */}
          {cameraError && (
            <div className="mt-4 flex w-full items-start gap-2.5 rounded-2xl border border-red-500/60 bg-red-950/70 p-3 text-left text-xs text-red-200">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-400" />
              <div>
                <p className="font-bold text-red-100">Permiso de cámara requerido</p>
                <p className="mt-0.5 text-[11px] leading-relaxed text-red-200/90">{cameraError}</p>
              </div>
            </div>
          )}

          {/* DOS BOTONES GRANDES */}
          <div className="my-6 flex w-full flex-col gap-3.5">
            {/* Botón 1: JUGAR CON CÁMARA */}
            <button
              onClick={handleStartCameraMode}
              disabled={isRequesting}
              className="group relative flex w-full items-center justify-between overflow-hidden rounded-2xl border-2 border-emerald-400/50 bg-gradient-to-r from-emerald-600 via-emerald-500 to-red-600 px-6 py-4 text-left font-black tracking-wider text-white shadow-xl shadow-emerald-950/50 transition hover:from-emerald-500 hover:to-red-500 active:scale-95 disabled:opacity-80"
            >
              <div className="flex items-center gap-3">
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-black/30 border border-white/20">
                  <Camera className="h-6 w-6 text-emerald-200 group-hover:scale-110 transition-transform" />
                </div>
                <div>
                  <div className="text-lg font-black tracking-wide text-white">JUGAR CON CÁMARA</div>
                  <div className="text-[11px] font-normal text-emerald-100">Cámara frontal y GIROSCOPIO real</div>
                </div>
              </div>
              <ArrowRight className="h-5 w-5 text-white/80 group-hover:translate-x-1 transition-transform" />
            </button>

            {/* Botón 2: JUGAR EN EL CAMPO */}
            <button
              onClick={handleStartFieldMode}
              disabled={isRequesting}
              className="group relative flex w-full items-center justify-between overflow-hidden rounded-2xl border-2 border-emerald-500/50 bg-gradient-to-r from-stone-900 via-emerald-950 to-stone-900 px-6 py-4 text-left font-black tracking-wider text-white shadow-xl shadow-emerald-950/40 transition hover:border-emerald-400 hover:bg-emerald-950/70 active:scale-95 disabled:opacity-80"
            >
              <div className="flex items-center gap-3">
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-emerald-900/60 border border-emerald-400/40">
                  <Trees className="h-6 w-6 text-emerald-300 group-hover:scale-110 transition-transform" />
                </div>
                <div>
                  <div className="text-lg font-black tracking-wide text-emerald-300">JUGAR EN EL CAMPO</div>
                  <div className="text-[11px] font-normal text-stone-300">Explorar y CAMINAR en pradera 3D</div>
                </div>
              </div>
              <ArrowRight className="h-5 w-5 text-emerald-300 group-hover:translate-x-1 transition-transform" />
            </button>
          </div>

          {/* Loader status if requesting */}
          {isRequesting && (
            <div className="mb-2 flex items-center justify-center gap-2 text-xs font-semibold text-emerald-300">
              <Loader2 className="h-4 w-4 animate-spin text-emerald-400" />
              <span>{requestStatusText}</span>
            </div>
          )}

          <p className="text-[11px] text-stone-400">
            Usá auriculares para ubicar el zumbido en 3D en el espacio.
          </p>
        </div>
      </div>
    </div>
  );
};
