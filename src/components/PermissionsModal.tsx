/**
 * PermissionsModal.tsx
 * Initial welcome screen and explicit sensor permission request flow
 * conforming to SDD Section 4 (Giroscopio, Micrófono, Cámara).
 */

import React, { useState } from 'react';
import { Compass, Mic, Camera, ShieldCheck, Play, ArrowRight } from 'lucide-react';
import { sensorManager } from '../sensors/SensorManager';
import { buzzManager } from '../audio/SpatialBuzzManager';

interface PermissionsModalProps {
  onPermissionsCompleted: (videoEl: HTMLVideoElement | null) => void;
}

export const PermissionsModal: React.FC<PermissionsModalProps> = ({ onPermissionsCompleted }) => {
  const [step, setStep] = useState<'welcome' | 'permissions'>('welcome');
  const [gyroState, setGyroState] = useState<'pending' | 'granted' | 'denied'>('pending');
  const [micState, setMicState] = useState<'pending' | 'granted' | 'denied'>('pending');
  const [cameraState, setCameraState] = useState<'pending' | 'granted' | 'denied'>('pending');
  const [isRequesting, setIsRequesting] = useState(false);

  const handleStartExperience = () => {
    // Initialize Web Audio Context on user gesture
    buzzManager.init();
    setStep('permissions');
  };

  const handleAuthorizeAll = async () => {
    setIsRequesting(true);

    // 1. AudioContext
    const audioCtx = buzzManager.init();

    // 2. Gyroscope
    try {
      const gyroOk = await sensorManager.requestGyroscope();
      setGyroState(gyroOk ? 'granted' : 'denied');
    } catch {
      setGyroState('denied');
    }

    // 3. Microphone
    try {
      const micOk = await sensorManager.requestMicrophone(audioCtx);
      setMicState(micOk ? 'granted' : 'denied');
    } catch {
      setMicState('denied');
    }

    // 4. Optional Camera
    let videoEl: HTMLVideoElement | null = null;
    try {
      videoEl = await sensorManager.requestCamera();
      setCameraState(videoEl ? 'granted' : 'denied');
    } catch {
      setCameraState('denied');
    }

    setIsRequesting(false);
    setTimeout(() => {
      onPermissionsCompleted(videoEl);
    }, 400);
  };

  const handleSkipOrContinue = () => {
    onPermissionsCompleted(null);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/90 p-4 backdrop-blur-xl">
      <div className="relative w-full max-w-md overflow-hidden rounded-3xl border border-rose-500/20 bg-gradient-to-b from-slate-900 to-slate-950 p-6 text-white shadow-2xl">
        {step === 'welcome' ? (
          <div className="flex flex-col items-center text-center">
            {/* Mosquito Icon Avatar */}
            <div className="relative mb-4 flex h-24 w-24 items-center justify-center rounded-3xl border border-rose-500/40 bg-rose-950/50 shadow-inner">
              <span className="text-5xl animate-bounce">🦟</span>
              <div className="absolute -inset-1 rounded-3xl bg-rose-500/20 blur-lg -z-10" />
            </div>

            <h1 className="text-3xl font-black tracking-tight text-white uppercase">
              Mosquito Attack
            </h1>
            <p className="mt-2 text-sm text-slate-300">
              Experiencia web inmersiva 3D controlada por el <strong className="text-rose-400">movimiento físico de tu teléfono</strong> y <strong className="text-amber-400">niveles de audio</strong>.
            </p>

            <div className="my-5 w-full rounded-2xl border border-slate-800 bg-slate-950/60 p-4 text-left text-xs space-y-2.5 text-slate-300">
              <div className="flex items-start gap-2.5">
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-rose-500/20 text-rose-400 font-bold">1</span>
                <span><strong>Apunta y desplázate con tu celular</strong>: da pasos, empuja o inclina el celular para avanzar/retroceder físicamente (o usa el mando táctil).</span>
              </div>
              <div className="flex items-start gap-2.5">
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-rose-500/20 text-rose-400 font-bold">2</span>
                <span><strong>Toca la pantalla</strong> para aplastarlos con retroalimentación háptica.</span>
              </div>
              <div className="flex items-start gap-2.5">
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-rose-500/20 text-rose-400 font-bold">3</span>
                <span><strong>En el Jefe Final:</strong> ¡deberás <strong className="text-amber-400">GRITAR durante 10 segundos</strong> para destruirlo!</span>
              </div>
            </div>

            <button
              onClick={handleStartExperience}
              className="group flex w-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-rose-600 to-red-600 px-6 py-3.5 font-bold text-white shadow-lg shadow-rose-600/30 transition hover:from-rose-500 hover:to-red-500 active:scale-95"
            >
              <Play className="h-5 w-5 fill-white" />
              <span>INICIAR EXPERIENCIA</span>
              <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
            </button>
          </div>
        ) : (
          <div className="flex flex-col items-center text-center">
            <div className="mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-slate-800 text-rose-400">
              <ShieldCheck className="h-8 w-8" />
            </div>

            <h2 className="text-2xl font-bold tracking-tight">Permisos de Sensores</h2>
            <p className="mt-1 text-xs text-slate-300">
              Para disfrutar la inmersión completa en tu navegador móvil, autoriza los sensores:
            </p>

            <div className="my-5 w-full space-y-3">
              {/* Gyroscope item */}
              <div className="flex items-center justify-between rounded-xl border border-slate-800 bg-slate-900/60 p-3 text-left">
                <div className="flex items-center gap-3">
                  <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-cyan-950/60 text-cyan-400">
                    <Compass className="h-5 w-5" />
                  </div>
                  <div>
                    <h3 className="text-sm font-semibold">Giroscopio y Acelerómetro (6DOF)</h3>
                    <p className="text-[11px] text-slate-400">Rotación 360° y avance/retroceso físico</p>
                  </div>
                </div>
                <span className={`text-xs font-semibold ${gyroState === 'granted' ? 'text-emerald-400' : 'text-slate-400'}`}>
                  {gyroState === 'granted' ? 'Listo' : 'Requerido'}
                </span>
              </div>

              {/* Mic item */}
              <div className="flex items-center justify-between rounded-xl border border-slate-800 bg-slate-900/60 p-3 text-left">
                <div className="flex items-center gap-3">
                  <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-emerald-950/60 text-emerald-400">
                    <Mic className="h-5 w-5" />
                  </div>
                  <div>
                    <h3 className="text-sm font-semibold">Micrófono (Web Audio)</h3>
                    <p className="text-[11px] text-slate-400">Para el ataque sónico al Jefe Final</p>
                  </div>
                </div>
                <span className={`text-xs font-semibold ${micState === 'granted' ? 'text-emerald-400' : 'text-slate-400'}`}>
                  {micState === 'granted' ? 'Listo' : 'Requerido'}
                </span>
              </div>

              {/* Camera item */}
              <div className="flex items-center justify-between rounded-xl border border-slate-800 bg-slate-900/60 p-3 text-left">
                <div className="flex items-center gap-3">
                  <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-indigo-950/60 text-indigo-400">
                    <Camera className="h-5 w-5" />
                  </div>
                  <div>
                    <h3 className="text-sm font-semibold">Cámara (Modo AR)</h3>
                    <p className="text-[11px] text-slate-400">Caza en tu propia habitación (opcional)</p>
                  </div>
                </div>
                <span className={`text-xs font-semibold ${cameraState === 'granted' ? 'text-emerald-400' : 'text-slate-400'}`}>
                  {cameraState === 'granted' ? 'Listo' : 'Opcional'}
                </span>
              </div>
            </div>

            <div className="flex w-full flex-col gap-2">
              <button
                onClick={handleAuthorizeAll}
                disabled={isRequesting}
                className="w-full rounded-2xl bg-gradient-to-r from-emerald-600 to-teal-600 py-3.5 font-bold text-white shadow-lg shadow-emerald-600/30 transition hover:from-emerald-500 hover:to-teal-500 active:scale-95 disabled:opacity-50"
              >
                {isRequesting ? 'SOLICITANDO PERMISOS...' : 'ACTIVAR SENSORES Y JUGAR'}
              </button>

              <button
                onClick={handleSkipOrContinue}
                className="w-full rounded-xl py-2 text-xs text-slate-400 transition hover:text-white"
              >
                Continuar con controles táctiles / modo clásico
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
