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
            Caza los mosquitos que vuelan frente a ti usando exclusivamente tu{' '}
            <strong className="text-rose-400">cámara frontal</strong>.
          </p>

          {/* Feature Highlights */}
          <div className="my-4 w-full rounded-2xl border border-slate-800 bg-slate-950/70 p-3.5 text-left text-xs space-y-2.5 text-slate-300">
            <div className="flex items-center gap-2.5">
              <Camera className="h-4 w-4 shrink-0 text-rose-400" />
              <span>
                <strong className="text-white">Cámara Frontal (Obligatoria):</strong> Los mosquitos aparecen flotando en tu entorno real frente a tu rostro.
              </span>
            </div>
            <div className="flex items-center gap-2.5">
              <Compass className="h-4 w-4 shrink-0 text-cyan-400" />
              <span>
                <strong className="text-white">Giroscopio 360°:</strong> Mueve tu dispositivo para apuntar y cazar a los mosquitos en el espacio.
              </span>
            </div>
            <div className="flex items-center gap-2.5">
              <Mic className="h-4 w-4 shrink-0 text-amber-400" />
              <span>
                <strong className="text-white">Ataque Sónico:</strong> Grita en el Nivel 3 o pulsa el botón en pantalla para derrotar al Jefe.
              </span>
            </div>
          </div>

          {/* Camera Error Alert if permission was denied */}
          {cameraError && (
            <div className="mb-4 flex w-full items-start gap-2.5 rounded-2xl border border-red-500/40 bg-red-950/50 p-3 text-left text-xs text-red-200">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-400" />
              <div>
                <p className="font-semibold text-red-100">Cámara frontal requerida</p>
                <p className="mt-0.5 text-[11px] leading-relaxed text-red-200/90">{cameraError}</p>
              </div>
            </div>
          )}

          {/* Action Button */}
          <div className="flex w-full flex-col gap-2.5">
            <button
              onClick={handleStartExperience}
              disabled={isRequesting}
              className="group flex w-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-rose-600 to-red-600 px-6 py-3.5 font-bold text-white shadow-lg shadow-rose-600/30 transition hover:from-rose-500 hover:to-red-500 active:scale-95 disabled:opacity-80"
            >
              {isRequesting ? (
                <>
                  <Loader2 className="h-5 w-5 animate-spin" />
                  <span>{requestStatusText || 'ACTIVANDO CÁMARA FRONTAL...'}</span>
                </>
              ) : cameraError ? (
                <>
                  <RefreshCw className="h-5 w-5 text-white" />
                  <span>REINTENTAR PERMITIR CÁMARA FRONTAL</span>
                </>
              ) : (
                <>
                  <Play className="h-5 w-5 fill-white" />
                  <span>INICIAR CON CÁMARA FRONTAL</span>
                  <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
                </>
              )}
            </button>
          </div>

          <p className="mt-3 text-[10px] text-slate-500">
            Requiere acceso a la cámara frontal para proyectar los mosquitos en Realidad Aumentada.
          </p>
        </div>
      </div>
    </div>
  );
};
