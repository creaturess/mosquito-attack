/**
 * LevelModal.tsx
 * Dialogs for level briefings, stage victories, game overs, and grand victory.
 */

import React from 'react';
import { Play, RotateCcw, Trophy, Skull, Flame, ArrowRight, Clock, Target } from 'lucide-react';

interface LevelModalProps {
  type: 'level_start' | 'level_win' | 'game_over' | 'game_won';
  level: 1 | 2 | 3;
  reason?: string;
  kills?: number;
  onContinue: () => void;
  onRestart: () => void;
}

export const LevelModal: React.FC<LevelModalProps> = ({
  type,
  level,
  reason,
  kills,
  onContinue,
  onRestart,
}) => {
  if (type === 'level_start') {
    return (
      <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/80 p-4 backdrop-blur-md">
        <div className="w-full max-w-sm rounded-3xl border border-white/10 bg-slate-900 p-6 text-center text-white shadow-2xl">
          <div className="mx-auto mb-3 flex h-16 w-16 items-center justify-center rounded-2xl bg-rose-950/60 border border-rose-500/30 text-rose-400">
            {level === 3 ? <Skull className="h-9 w-9 text-red-500 animate-pulse" /> : <Target className="h-8 w-8 text-rose-400" />}
          </div>

          <span className="rounded-full bg-rose-500/20 px-3 py-1 text-xs font-bold tracking-wider text-rose-400 uppercase">
            Nivel {level} de 3
          </span>

          <h2 className="mt-2 text-2xl font-black">
            {level === 1 && 'Climatización'}
            {level === 2 && 'Mosquitos Ágiles'}
            {level === 3 && 'FINAL BOSS: Mosquito Gigante'}
          </h2>

          <p className="mt-2 text-xs text-slate-300">
            {level === 1 &&
              'Aclimatación: Mosquitos dispersos en tu entorno real volando calmadamente. Apunta con la cámara y guíate por su zumbido 3D para encontrarlos.'}
            {level === 2 &&
              'Los mosquitos son un poco más pequeños y se mueven más rápido en tu espacio físico. Sigue su zumbido agudo y elimínalos con rapidez.'}
            {level === 3 &&
              '¡El Mosquito Gigante ha aparecido frente a ti en tu cámara! Se moverá solo hacia adelante y hacia atrás mirándote de frente en silencio. ¡GRITA lo más fuerte posible durante 10 segundos para destruirlo!'}
          </p>

          <div className="my-4 grid grid-cols-2 gap-2 rounded-2xl border border-slate-800 bg-slate-950/70 p-3 text-left">
            <div className="flex items-center gap-2">
              <Clock className="h-4 w-4 text-amber-400" />
              <div>
                <div className="text-[10px] text-slate-400 uppercase">Tiempo Límite</div>
                <div className="font-mono text-sm font-bold text-amber-300">
                  {level === 1 ? '60 seg' : level === 2 ? '50 seg' : '20 seg'}
                </div>
              </div>
            </div>

            <div className="flex items-center gap-2">
              {level === 3 ? <Flame className="h-4 w-4 text-rose-400" /> : <Target className="h-4 w-4 text-rose-400" />}
              <div>
                <div className="text-[10px] text-slate-400 uppercase">Objetivo</div>
                <div className="font-mono text-sm font-bold text-rose-300">
                  {level === 3 ? 'Gritar 10s' : '20 mosquitos'}
                </div>
              </div>
            </div>
          </div>

          <button
            onClick={onContinue}
            className="flex w-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-rose-600 to-red-600 py-3.5 font-bold text-white shadow-lg shadow-rose-600/30 transition hover:from-rose-500 hover:to-red-500 active:scale-95"
          >
            <Play className="h-4 w-4 fill-white" />
            <span>¡COMENZAR NIVEL {level}!</span>
          </button>
        </div>
      </div>
    );
  }

  if (type === 'level_win') {
    return (
      <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/80 p-4 backdrop-blur-md">
        <div className="w-full max-w-sm rounded-3xl border border-emerald-500/30 bg-slate-900 p-6 text-center text-white shadow-2xl">
          <div className="mx-auto mb-3 flex h-16 w-16 items-center justify-center rounded-2xl bg-emerald-950/60 border border-emerald-500/40 text-emerald-400">
            <Trophy className="h-8 w-8 text-emerald-400 animate-bounce" />
          </div>

          <h2 className="text-2xl font-black text-emerald-400">¡NIVEL {level} COMPLETADO!</h2>
          <p className="mt-1 text-xs text-slate-300">
            Excelente puntería. Has eliminado los 20 mosquitos a tiempo.
          </p>

          <button
            onClick={onContinue}
            className="mt-6 flex w-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-emerald-600 to-teal-600 py-3.5 font-bold text-white shadow-lg shadow-emerald-600/30 transition hover:from-emerald-500 active:scale-95"
          >
            <span>PASAR AL NIVEL {level + 1}</span>
            <ArrowRight className="h-4 w-4" />
          </button>
        </div>
      </div>
    );
  }

  if (type === 'game_won') {
    return (
      <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/85 p-4 backdrop-blur-md">
        <div className="w-full max-w-sm rounded-3xl border-2 border-amber-400/50 bg-gradient-to-b from-slate-900 via-slate-900 to-amber-950/40 p-6 text-center text-white shadow-2xl">
          <div className="mx-auto mb-3 flex h-20 w-20 items-center justify-center rounded-3xl bg-amber-500/20 border border-amber-400/40 text-amber-300 shadow-lg">
            <Trophy className="h-10 w-10 text-amber-300 animate-pulse" />
          </div>

          <h2 className="text-3xl font-black text-amber-300">¡VICTORIA TOTAL!</h2>
          <p className="mt-2 text-sm text-slate-200">
            ¡Tu grito ha desintegrado al <strong className="text-rose-400">Mosquito Gigante</strong>! Has liberado tu entorno de la plaga.
          </p>

          <div className="my-5 rounded-2xl border border-amber-500/30 bg-black/50 p-3 text-xs text-amber-200 font-mono">
            🏆 Experiencia completada al 100%
          </div>

          <button
            onClick={onRestart}
            className="flex w-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-amber-500 to-orange-600 py-3.5 font-bold text-slate-950 shadow-lg shadow-amber-500/30 transition hover:from-amber-400 hover:to-orange-500 active:scale-95"
          >
            <RotateCcw className="h-4 w-4" />
            <span>JUGAR DE NUEVO</span>
          </button>
        </div>
      </div>
    );
  }

  // game_over
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/85 p-4 backdrop-blur-md">
      <div className="w-full max-w-sm rounded-3xl border border-rose-600/40 bg-slate-900 p-6 text-center text-white shadow-2xl">
        <div className="mx-auto mb-3 flex h-16 w-16 items-center justify-center rounded-2xl bg-rose-950/60 border border-rose-500/30 text-rose-500">
          <Skull className="h-9 w-9 text-rose-500" />
        </div>

        <h2 className="text-2xl font-black text-rose-400">TIEMPO AGOTADO</h2>
        <p className="mt-2 text-xs text-slate-300">
          {reason || 'Los mosquitos te han vencido antes de cumplir el objetivo.'}
        </p>

        {kills !== undefined && level < 3 && (
          <div className="my-4 rounded-xl bg-slate-950/60 p-3 font-mono text-xs text-slate-400">
            Eliminaste {kills} de 20 mosquitos requeridos
          </div>
        )}

        <button
          onClick={onRestart}
          className="mt-4 flex w-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-rose-600 to-red-600 py-3.5 font-bold text-white shadow-lg shadow-rose-600/30 transition hover:from-rose-500 active:scale-95"
        >
          <RotateCcw className="h-4 w-4" />
          <span>REINTENTAR NIVEL {level}</span>
        </button>
      </div>
    </div>
  );
};
