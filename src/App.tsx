/**
 * App.tsx
 * Main application controller for Mosquito Attack:
 * orchestrates game state, 30s/25s/20s timers, level progression,
 * Web Audio mic scream tracking, gyroscope, and Three.js canvas.
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { ThreeCanvas, GameState } from './components/ThreeCanvas';
import { UIOverlay } from './components/UIOverlay';
import { PermissionsModal } from './components/PermissionsModal';
import { LevelModal } from './components/LevelModal';
import { sensorManager, SensorStatus } from './sensors/SensorManager';
import { buzzManager } from './audio/SpatialBuzzManager';

const LEVEL_DURATIONS: Record<1 | 2 | 3, number> = {
  1: 60, // 60 seconds for Level 1
  2: 50, // 50 seconds for Level 2 (20 agile mosquitoes across bedroom)
  3: 20, // 20 seconds for Level 3
};

const TARGET_KILLS: Record<1 | 2 | 3, number> = {
  1: 20, // 20 mosquitoes
  2: 20, // 20 mosquitoes
  3: 1,  // Final Boss
};

export default function App() {
  const [showPermissionsModal, setShowPermissionsModal] = useState(true);
  const [activeModal, setActiveModal] = useState<'level_start' | 'level_win' | 'game_over' | 'game_won' | null>(null);
  const [gameOverReason, setGameOverReason] = useState<string>('');

  const [gameState, setGameState] = useState<GameState>({
    currentLevel: 1,
    isPlaying: false,
    timeLeft: LEVEL_DURATIONS[1],
    kills: 0,
    targetKills: TARGET_KILLS[1],
    bossHealthPercent: 100,
    screamSecondsAccumulated: 0,
    isBossDead: false,
    isARMode: true,
  });

  const [sensorStatus, setSensorStatus] = useState<SensorStatus>({
    gyroscopeAllowed: false,
    gyroscopeActive: false,
    motionActive: false,
    micAllowed: false,
    micActive: false,
    cameraAllowed: false,
    cameraActive: false,
  });

  const [currentVolume, setCurrentVolume] = useState(0);
  const [isScreaming, setIsScreaming] = useState(false);
  const [forwardDistance, setForwardDistance] = useState(0);
  const [videoElement, setVideoElement] = useState<HTMLVideoElement | null>(null);

  const videoContainerRef = useRef<HTMLDivElement>(null);
  const timerIntervalRef = useRef<number | null>(null);

  // Poll sensor volume, spatial position and status for UI HUD
  useEffect(() => {
    let animId: number;
    let frameCounter = 0;

    const checkSensors = () => {
      animId = requestAnimationFrame(checkSensors);
      frameCounter++;
      // Poll at ~20Hz for UI HUD smoothness without advancing animation lerp
      if (frameCounter % 3 === 0) {
        const { audio, status, position } = sensorManager.getSnapshot();
        setCurrentVolume(audio.volume);
        setIsScreaming(audio.isScreaming);
        setSensorStatus(status);
        setForwardDistance(position.forwardDistance);
      }
    };

    animId = requestAnimationFrame(checkSensors);
    return () => cancelAnimationFrame(animId);
  }, []);

  // Countdown timer effect
  useEffect(() => {
    if (gameState.isPlaying && gameState.timeLeft > 0) {
      timerIntervalRef.current = window.setInterval(() => {
        setGameState((prev) => {
          if (!prev.isPlaying) return prev;
          if (prev.timeLeft <= 1) {
            // Time ran out!
            clearInterval(timerIntervalRef.current!);
            handleTimeOver(prev);
            return { ...prev, timeLeft: 0, isPlaying: false };
          }
          return { ...prev, timeLeft: prev.timeLeft - 1 };
        });
      }, 1000);
    }

    return () => {
      if (timerIntervalRef.current) {
        clearInterval(timerIntervalRef.current);
      }
    };
  }, [gameState.isPlaying, gameState.currentLevel]);

  const handleTimeOver = (state: GameState) => {
    buzzManager.playDefeatSfx();
    sensorManager.triggerHaptic('gameover');
    if (state.currentLevel === 3) {
      setGameOverReason('¡No lograste gritar los 10 segundos necesarios antes de los 20 segundos!');
    } else {
      setGameOverReason(`Se acabó el tiempo. Solo lograste matar ${state.kills} de los ${state.targetKills} requeridos.`);
    }
    setActiveModal('game_over');
  };

  // Called when user finishes permissions setup
  const handlePermissionsCompleted = (videoEl: HTMLVideoElement | null) => {
    setShowPermissionsModal(false);
    if (videoEl) {
      setVideoElement(videoEl);
    }
    // Show Level 1 briefing
    setActiveModal('level_start');
  };

  // Start the current level countdown
  const startCurrentLevel = () => {
    setActiveModal(null);
    sensorManager.calibrateCenter();
    setGameState((prev) => ({
      ...prev,
      timeLeft: LEVEL_DURATIONS[prev.currentLevel],
      kills: 0,
      targetKills: TARGET_KILLS[prev.currentLevel],
      screamSecondsAccumulated: 0,
      bossHealthPercent: 100,
      isBossDead: false,
      isPlaying: true,
    }));
  };

  // Handle killing normal mosquito
  const handleKill = useCallback((newKills: number) => {
    setGameState((prev) => ({
      ...prev,
      kills: newKills,
    }));
  }, []);

  // Level Win
  const handleLevelComplete = useCallback(() => {
    setGameState((prev) => ({ ...prev, isPlaying: false }));
    if (gameState.currentLevel === 3) {
      setActiveModal('game_won');
    } else {
      setActiveModal('level_win');
    }
  }, [gameState.currentLevel]);

  // Handle advancing to next level
  const handleNextLevel = () => {
    if (gameState.currentLevel < 3) {
      const nextLvl = (gameState.currentLevel + 1) as 1 | 2 | 3;
      setGameState((prev) => ({
        ...prev,
        currentLevel: nextLvl,
        timeLeft: LEVEL_DURATIONS[nextLvl],
        kills: 0,
        targetKills: TARGET_KILLS[nextLvl],
        screamSecondsAccumulated: 0,
        isPlaying: false,
      }));
      setActiveModal('level_start');
    }
  };

  // Restart current level or entire game
  const handleRestart = () => {
    startCurrentLevel();
  };

  // Update scream seconds accumulated for Level 3 Boss
  const handleScreamProgress = useCallback((accumulatedSec: number) => {
    setGameState((prev) => ({
      ...prev,
      screamSecondsAccumulated: Math.min(10, accumulatedSec),
      bossHealthPercent: Math.max(0, 100 - (accumulatedSec / 10) * 100),
    }));
  }, []);

  // Flip camera or reactivate camera in real environment mode
  const handleToggleOrFlipCamera = async () => {
    if (!videoElement) {
      const vid = await sensorManager.requestCamera('environment');
      if (vid) {
        setVideoElement(vid);
        setGameState((prev) => ({ ...prev, isARMode: true }));
      }
    } else {
      const vid = await sensorManager.flipCamera();
      if (vid) {
        setVideoElement(vid);
      }
    }
  };

  const handleCalibrateGyro = () => {
    sensorManager.calibrateCenter();
  };

  return (
    <div className="relative h-full w-full select-none overflow-hidden bg-black font-sans">
      {/* Background Real-World Camera Feed */}
      {videoElement && (
        <div ref={videoContainerRef} className="absolute inset-0 z-0 h-full w-full overflow-hidden">
          <video
            ref={(node) => {
              if (node && videoElement.srcObject) {
                node.srcObject = videoElement.srcObject;
                node.play().catch(() => {});
              }
            }}
            autoPlay
            playsInline
            muted
            className="h-full w-full object-cover"
          />
        </div>
      )}

      {/* Fallback Viewport if camera is not yet connected */}
      {!videoElement && (
        <div className="absolute inset-0 z-0 flex flex-col items-center justify-center bg-radial from-slate-900 to-black p-6 text-center">
          <div className="relative flex h-20 w-20 items-center justify-center rounded-3xl border border-rose-500/30 bg-slate-900/90 shadow-2xl">
            <span className="text-4xl animate-pulse">📷</span>
          </div>
          <h3 className="mt-4 text-lg font-bold text-white">Entorno Real (Cámara en Vivo)</h3>
          <p className="mt-1 max-w-xs text-xs text-slate-300">
            Los mosquitos están en tu habitación real. Conecta la cámara para ver tu entorno físico.
          </p>
          <button
            onClick={handleToggleOrFlipCamera}
            className="mt-4 rounded-xl bg-gradient-to-r from-rose-600 to-red-600 px-5 py-2.5 text-xs font-bold text-white shadow-lg shadow-rose-600/30 transition hover:from-rose-500 active:scale-95"
          >
            Activar Cámara en Vivo
          </button>
        </div>
      )}

      {/* 3D WebGL Canvas Layer */}
      <ThreeCanvas
        gameState={gameState}
        onKill={handleKill}
        onLevelComplete={handleLevelComplete}
        onGameOver={(reason) => {
          setGameOverReason(reason);
          setActiveModal('game_over');
        }}
        onScreamProgress={handleScreamProgress}
        isARMode={gameState.isARMode}
        videoElement={videoElement}
      />

      {/* HUD & Sensor Overlay */}
      <UIOverlay
        gameState={gameState}
        sensorStatus={sensorStatus}
        currentVolume={currentVolume}
        isScreaming={isScreaming}
        onToggleAR={handleToggleOrFlipCamera}
        onCalibrateGyro={handleCalibrateGyro}
        forwardDistance={forwardDistance}
      />

      {/* Onboarding & Sensor Permissions Modal */}
      {showPermissionsModal && (
        <PermissionsModal onPermissionsCompleted={handlePermissionsCompleted} />
      )}

      {/* Level Briefing / Result Modals */}
      {activeModal && (
        <LevelModal
          type={activeModal}
          level={gameState.currentLevel}
          reason={gameOverReason}
          kills={gameState.kills}
          onContinue={activeModal === 'level_win' ? handleNextLevel : startCurrentLevel}
          onRestart={activeModal === 'game_won' ? () => {
            setGameState((prev) => ({ ...prev, currentLevel: 1 }));
            setActiveModal('level_start');
          } : handleRestart}
        />
      )}
    </div>
  );
}
