/**
 * App.tsx
 * Main application controller for Mosquito Attack:
 * orchestrates game state, 30s/25s/20s timers, level progression,
 * Web Audio mic scream tracking, gyroscope, and Three.js canvas.
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { ThreeCanvas, GameState, NearestMosquitoInfo, DebugNestInfo, EdgeIndicatorInfo } from './components/ThreeCanvas';
import { UIOverlay } from './components/UIOverlay';
import { PermissionsModal } from './components/PermissionsModal';
import { LevelModal } from './components/LevelModal';
import { sensorManager, SensorStatus } from './sensors/SensorManager';
import { buzzManager } from './audio/SpatialBuzzManager';

const LEVEL_DURATIONS: Record<1 | 2 | 3, number> = {
  1: 60, // 60 seconds for Level 1
  2: 30, // 30 seconds for Level 2
  3: 20, // 20 seconds for Level 3
};

const TARGET_KILLS: Record<1 | 2 | 3, number> = {
  1: 20, // 20 mosquitoes
  2: 15, // 15 fast crossing mosquitoes
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
  const [cameraStream, setCameraStream] = useState<MediaStream | null>(() => sensorManager.getCameraStream());
  const [nearestMosquito, setNearestMosquito] = useState<NearestMosquitoInfo | null>(null);
  const [isDebugMode, setIsDebugMode] = useState(false);
  const [debugNests, setDebugNests] = useState<DebugNestInfo[]>([]);
  const [proximityHeat, setProximityHeat] = useState(0);
  const [isAimingNear, setIsAimingNear] = useState(false);
  const [edgeIndicator, setEdgeIndicator] = useState<EdgeIndicatorInfo | null>(null);

  const videoRef = useRef<HTMLVideoElement>(null);
  const timerIntervalRef = useRef<number | null>(null);

  const handleToggleDebug = useCallback(() => {
    setIsDebugMode((prev) => !prev);
  }, []);

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



  // Bind cameraStream to persistent video element once without flickering or re-renders
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    if (cameraStream) {
      if (video.srcObject !== cameraStream) {
        video.srcObject = cameraStream;
        video.play().catch(() => {});
      }
    } else {
      video.srcObject = null;
    }
  }, [cameraStream]);

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

  // Called when user finishes permissions setup with front camera
  const handlePermissionsCompleted = (stream: MediaStream) => {
    setShowPermissionsModal(false);
    setCameraStream(stream);
    setGameState((prev) => ({ ...prev, isARMode: true }));
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

  const handleCalibrateGyro = () => {
    sensorManager.calibrateCenter();
  };

  return (
    <div className="relative h-full w-full select-none overflow-hidden bg-black font-sans">
      {/* Background Real-World Camera Feed or Atmospheric Backdrop */}
      <div className="absolute inset-0 z-0 h-full w-full overflow-hidden bg-gradient-to-b from-slate-950 via-slate-900 to-black pointer-events-none">
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          className={`h-full w-full object-cover transition-opacity duration-500 pointer-events-none ${
            cameraStream ? 'opacity-100' : 'opacity-0'
          }`}
          style={{
            transform: 'scaleX(-1) translateZ(0)',
            backfaceVisibility: 'hidden',
          }}
        />
      </div>



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
        videoElement={null}
        onNearestMosquitoUpdate={setNearestMosquito}
        isDebugMode={isDebugMode}
        onToggleDebug={handleToggleDebug}
        onDebugUpdate={setDebugNests}
        onProximityHeatUpdate={(heat, aiming) => {
          setProximityHeat(heat);
          setIsAimingNear(aiming);
        }}
        onEdgeIndicatorUpdate={setEdgeIndicator}
      />

      {/* HUD & Sensor Overlay */}
      <UIOverlay
        gameState={gameState}
        sensorStatus={sensorStatus}
        currentVolume={currentVolume}
        isScreaming={isScreaming}
        onCalibrateGyro={handleCalibrateGyro}
        forwardDistance={forwardDistance}
        nearestMosquito={nearestMosquito}
        proximityHeat={proximityHeat}
        isAimingNear={isAimingNear}
        edgeIndicator={edgeIndicator}
        isDebugMode={isDebugMode}
        onToggleDebug={handleToggleDebug}
        debugNests={debugNests}
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
