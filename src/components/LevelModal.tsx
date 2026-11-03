/**
 * LevelModal.tsx
 * Dialogs for level briefings, stage victories, game overs, and grand victory
 * styled in high-impact emerald green and blood red palette with exact user copy.
 */

import React from 'react';
import { Play, RotateCcw, Trophy, Skull, Flame, ArrowRight } from 'lucide-react';

interface LevelModalProps {
  type: 'level_start' | 'level_win' | 'game_over' | 'game_won';
  level: 1 | 2 | 3;
  reason?: string;
  kills?: number;
  onContinue: () => void;
  onRestart: () => void;
  onReturnToMenu?: () => void;
}

export const LevelModal: React.FC<LevelModalProps> = ({
  type,
  level,
  onContinue,
  onRestart,
  onReturnToMenu,
}) => {
  if (type === 'level_start') {
    return (
      <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/85 p-4 backdrop-blur-md">
        <div className="w-full max-w-sm rounded-3xl border-2 border-emerald-500/40 bg-gradient-to-b from-stone-950 via-emerald-950/40 to-black p-6 text-center text-white shadow-2xl shadow-emerald-950/60">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-emerald-950/80 border border-emerald-500/50 text-emerald-400 shadow-lg">
            {level === 3 ? (
              <Skull className="h-9 w-9 text-red-500 animate-pulse" />
            ) : (
              <span className="text-3xl">🦟</span>
            )}
          </div>

          <h2 className="text-3xl font-black tracking-wider text-emerald-400 uppercase">
            {level === 1 && 'NIVEL 1'}
            {level === 2 && 'NIVEL 2'}
            {level === 3 && 'JEFE FINAL'}
          </h2>

          {level === 3 && (
            <div className="mt-1 text-sm font-bold text-red-400 tracking-wide">
              El último mosquito
            </div>
          )}

          <div className="my-5 rounded-2xl border border-emerald-500/30 bg-black/60 p-4">
            <p className="text-base font-extrabold text-white leading-relaxed">
              {level === 1 && 'Matá 20 mosquitos'}
              {level === 2 && '15 mosquitos, MENOS TIEMPO y MÁS RÁPIDOS'}
              {level === 3 && '¡GRITÁ para matarlo!'}
            </p>
          </div>

          <button
            onClick={onContinue}
            className="flex w-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-emerald-500 via-emerald-600 to-red-600 py-3.5 font-black text-lg tracking-wider text-white shadow-lg shadow-emerald-900/40 transition hover:from-emerald-400 hover:to-red-500 active:scale-95"
          >
            <Play className="h-5 w-5 fill-white" />
            <span>JUGAR</span>
          </button>
        </div>
      </div>
    );
  }

  if (type === 'level_win') {
    return (
      <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/85 p-4 backdrop-blur-md">
        <div className="w-full max-w-sm rounded-3xl border-2 border-emerald-500/50 bg-gradient-to-b from-stone-950 via-emerald-950/40 to-black p-6 text-center text-white shadow-2xl">
          <div className="mx-auto mb-3 flex h-16 w-16 items-center justify-center rounded-2xl bg-emerald-950/80 border border-emerald-500/40 text-emerald-400">
            <Trophy className="h-8 w-8 text-emerald-400 animate-bounce" />
          </div>

          <h2 className="text-2xl font-black text-emerald-400">¡NIVEL {level} COMPLETADO!</h2>
          <p className="mt-2 text-sm text-emerald-200">
            {level === 1 ? 'Eliminaste los 20 mosquitos.' : 'Eliminaste los 15 mosquitos veloces.'}
          </p>

          <button
            onClick={onContinue}
            className="mt-6 flex w-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-emerald-500 via-emerald-600 to-red-600 py-3.5 font-bold text-white shadow-lg shadow-emerald-600/30 transition hover:from-emerald-400 hover:to-red-500 active:scale-95"
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
      <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/90 p-4 backdrop-blur-md">
        <div className="w-full max-w-sm rounded-3xl border-2 border-emerald-500/50 bg-gradient-to-b from-stone-950 via-emerald-950/50 to-black p-6 text-center text-white shadow-2xl">
          <div className="mx-auto mb-4 flex h-20 w-20 items-center justify-center rounded-3xl bg-emerald-950/80 border-2 border-emerald-400/50 text-emerald-300 shadow-lg shadow-emerald-500/20">
            <Trophy className="h-10 w-10 text-emerald-300 animate-pulse" />
          </div>

          <h2 className="text-3xl font-black text-emerald-400 tracking-tight">
            ¡LOS MATASTE A TODOS!
          </h2>

          <div className="my-6 rounded-2xl border border-red-500/30 bg-red-950/30 p-3 text-sm font-semibold text-red-200 flex items-center justify-center gap-2">
            <Flame className="h-4 w-4 text-red-400" />
            <span>Zona completamente despejada</span>
          </div>

          <div className="flex flex-col gap-2.5">
            <button
              onClick={onRestart}
              className="flex w-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-emerald-500 via-emerald-600 to-red-600 py-3.5 font-black text-white shadow-lg shadow-emerald-600/30 transition hover:from-emerald-400 hover:to-red-500 active:scale-95"
            >
              <RotateCcw className="h-5 w-5" />
              <span>Jugar de nuevo</span>
            </button>

            {onReturnToMenu && (
              <button
                onClick={onReturnToMenu}
                className="w-full rounded-xl border border-white/20 bg-stone-900/80 py-2.5 text-xs font-bold text-stone-300 hover:text-white transition active:scale-95"
              >
                CAMBIAR MODO DE JUEGO
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  // game_over
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/90 p-4 backdrop-blur-md">
      <div className="w-full max-w-sm rounded-3xl border-2 border-red-600/50 bg-gradient-to-b from-stone-950 via-red-950/40 to-black p-6 text-center text-white shadow-2xl shadow-red-950/50">
        <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-red-950/80 border border-red-500/40 text-red-500">
          <Skull className="h-9 w-9 text-red-500 animate-pulse" />
        </div>

        <h2 className="text-3xl font-black tracking-wide text-red-500 uppercase">
          SE ACABÓ EL TIEMPO
        </h2>

        <div className="my-6 rounded-2xl border border-red-500/30 bg-black/60 p-3 text-xs text-red-200">
          ¡Apunta rápido y no dejes que escapen!
        </div>

        <div className="flex flex-col gap-2.5">
          <button
            onClick={onRestart}
            className="flex w-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-red-600 to-emerald-600 py-3.5 font-black text-white shadow-lg shadow-red-600/30 transition hover:from-red-500 hover:to-emerald-500 active:scale-95"
          >
            <RotateCcw className="h-5 w-5" />
            <span>Reintentar</span>
          </button>

          {onReturnToMenu && (
            <button
              onClick={onReturnToMenu}
              className="w-full rounded-xl border border-white/20 bg-stone-900/80 py-2.5 text-xs font-bold text-stone-300 hover:text-white transition active:scale-95"
            >
              CAMBIAR MODO DE JUEGO
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
