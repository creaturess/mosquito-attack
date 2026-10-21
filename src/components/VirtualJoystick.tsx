/**
 * VirtualJoystick.tsx
 * High-performance, touch-isolated 360-degree analog virtual joystick
 * for fluid walking and strafing inside the 3D room.
 *
 * Features:
 * - Dedicated touch identifier tracking (multitouch-safe: swatting with other hand works seamlessly)
 * - StopPropagation prevents accidental mosquito swats or misses
 * - Cyberpunk/gamer aesthetic with glowing neon thumbstick & cardinal indicators
 * - Smooth spring-back on release
 */

import React, { useState, useRef, useEffect, useCallback } from 'react';

export interface JoystickVector {
  x: number; // -1.0 (left strafe) to 1.0 (right strafe)
  y: number; // -1.0 (backward) to 1.0 (forward)
}

interface VirtualJoystickProps {
  onMove: (vector: JoystickVector) => void;
  className?: string;
  size?: number; // Outer base size in px (default 124)
}

export const VirtualJoystick: React.FC<VirtualJoystickProps> = ({
  onMove,
  className = '',
  size = 124,
}) => {
  const baseRef = useRef<HTMLDivElement>(null);
  const [knobPos, setKnobPos] = useState({ x: 0, y: 0 });
  const [isActive, setIsActive] = useState(false);
  const activeTouchIdRef = useRef<number | null>(null);
  const isPointerDownRef = useRef(false);

  const maxRadius = (size / 2) - 16; // Maximum knob travel radius in px

  const updatePosition = useCallback((clientX: number, clientY: number) => {
    if (!baseRef.current) return;
    const rect = baseRef.current.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;

    const deltaX = clientX - centerX;
    const deltaY = clientY - centerY;

    const distance = Math.sqrt(deltaX * deltaX + deltaY * deltaY);
    const clampedDist = Math.min(distance, maxRadius);
    const angle = Math.atan2(deltaY, deltaX);

    const knobX = Math.cos(angle) * clampedDist;
    const knobY = Math.sin(angle) * clampedDist;

    setKnobPos({ x: knobX, y: knobY });

    // Normalized vector:
    // x: -1 (left) to 1 (right)
    // y: 1 (forward/up) to -1 (backward/down)
    const normX = clampedDist > 4 ? knobX / maxRadius : 0;
    const normY = clampedDist > 4 ? -(knobY / maxRadius) : 0;

    onMove({ x: normX, y: normY });
  }, [maxRadius, onMove]);

  const resetJoystick = useCallback(() => {
    setKnobPos({ x: 0, y: 0 });
    setIsActive(false);
    activeTouchIdRef.current = null;
    isPointerDownRef.current = false;
    onMove({ x: 0, y: 0 });
  }, [onMove]);

  // Touch handlers
  const handleTouchStart = (e: React.TouchEvent<HTMLDivElement>) => {
    e.stopPropagation();
    if (activeTouchIdRef.current !== null) return;

    const touch = e.changedTouches[0];
    activeTouchIdRef.current = touch.identifier;
    setIsActive(true);
    updatePosition(touch.clientX, touch.clientY);
  };

  const handleTouchMove = (e: React.TouchEvent<HTMLDivElement>) => {
    e.stopPropagation();
    if (activeTouchIdRef.current === null) return;

    for (let i = 0; i < e.changedTouches.length; i++) {
      const touch = e.changedTouches[i];
      if (touch.identifier === activeTouchIdRef.current) {
        updatePosition(touch.clientX, touch.clientY);
        break;
      }
    }
  };

  const handleTouchEnd = (e: React.TouchEvent<HTMLDivElement>) => {
    e.stopPropagation();
    for (let i = 0; i < e.changedTouches.length; i++) {
      if (e.changedTouches[i].identifier === activeTouchIdRef.current) {
        resetJoystick();
        break;
      }
    }
  };

  // Pointer / Mouse handlers (desktop testing & non-touch support)
  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.pointerType === 'touch') return; // Handled by touch events
    e.stopPropagation();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    isPointerDownRef.current = true;
    setIsActive(true);
    updatePosition(e.clientX, e.clientY);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.pointerType === 'touch') return;
    if (!isPointerDownRef.current) return;
    e.stopPropagation();
    updatePosition(e.clientX, e.clientY);
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.pointerType === 'touch') return;
    if (isPointerDownRef.current) {
      e.stopPropagation();
      resetJoystick();
    }
  };

  useEffect(() => {
    const handleWindowTouchEnd = (e: TouchEvent) => {
      if (activeTouchIdRef.current !== null) {
        for (let i = 0; i < e.changedTouches.length; i++) {
          if (e.changedTouches[i].identifier === activeTouchIdRef.current) {
            resetJoystick();
            break;
          }
        }
      }
    };

    window.addEventListener('touchend', handleWindowTouchEnd);
    window.addEventListener('touchcancel', handleWindowTouchEnd);
    return () => {
      window.removeEventListener('touchend', handleWindowTouchEnd);
      window.removeEventListener('touchcancel', handleWindowTouchEnd);
    };
  }, [resetJoystick]);

  const knobSize = 50;

  return (
    <div
      data-no-swat="true"
      className={`relative select-none pointer-events-auto touch-none ${className}`}
      style={{ width: size, height: size }}
    >
      {/* Outer Glow / Base Ring */}
      <div
        ref={baseRef}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        onTouchCancel={handleTouchEnd}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        className={`relative flex items-center justify-center rounded-full border-2 transition-all duration-150 ${
          isActive
            ? 'border-cyan-400/80 bg-slate-950/85 shadow-[0_0_24px_rgba(6,182,212,0.4)]'
            : 'border-white/20 bg-slate-950/65 shadow-[0_0_15px_rgba(0,0,0,0.5)] backdrop-blur-md hover:border-cyan-500/40'
        }`}
        style={{ width: size, height: size }}
      >
        {/* Cardinal Direction Notches */}
        {/* North (Forward) */}
        <div className="absolute top-1.5 flex flex-col items-center">
          <div className="h-1.5 w-0.5 rounded-full bg-cyan-400/60" />
          <span className="text-[9px] font-bold tracking-tighter text-cyan-300/80">▲</span>
        </div>
        {/* South (Backward) */}
        <div className="absolute bottom-1.5 flex flex-col items-center">
          <span className="text-[9px] font-bold tracking-tighter text-cyan-300/80">▼</span>
          <div className="h-1.5 w-0.5 rounded-full bg-cyan-400/60" />
        </div>
        {/* West (Left) */}
        <div className="absolute left-1.5 flex items-center gap-0.5">
          <div className="h-0.5 w-1.5 rounded-full bg-cyan-400/60" />
          <span className="text-[8px] font-bold text-cyan-300/80">◀</span>
        </div>
        {/* East (Right) */}
        <div className="absolute right-1.5 flex items-center gap-0.5">
          <span className="text-[8px] font-bold text-cyan-300/80">▶</span>
          <div className="h-0.5 w-1.5 rounded-full bg-cyan-400/60" />
        </div>

        {/* Center Crosshair Ring */}
        <div className="pointer-events-none absolute h-8 w-8 rounded-full border border-white/10" />

        {/* Floating Thumbstick Knob */}
        <div
          className={`absolute rounded-full border-2 transition-shadow duration-150 flex items-center justify-center ${
            isActive
              ? 'border-white bg-gradient-to-tr from-cyan-500 via-blue-600 to-indigo-500 shadow-[0_0_18px_rgba(6,182,212,0.8)] scale-105'
              : 'border-cyan-300/50 bg-gradient-to-tr from-slate-800 to-slate-700 shadow-[0_0_10px_rgba(0,0,0,0.5)]'
          }`}
          style={{
            width: knobSize,
            height: knobSize,
            transform: `translate(${knobPos.x}px, ${knobPos.y}px)`,
            transition: isActive ? 'box-shadow 0.15s, transform 0.02s' : 'all 0.22s cubic-bezier(0.175, 0.885, 0.32, 1.275)',
          }}
        >
          {/* Inner Glowing Core */}
          <div
            className={`h-4 w-4 rounded-full transition-colors ${
              isActive ? 'bg-cyan-200 shadow-[0_0_8px_#ffffff]' : 'bg-cyan-400/70'
            }`}
          />
        </div>
      </div>

      {/* Label under joystick */}
      <div className="pointer-events-none mt-1 text-center">
        <span className="rounded-full bg-black/60 px-2 py-0.5 text-[10px] font-semibold tracking-wider text-cyan-300/90 backdrop-blur-sm">
          MOVER
        </span>
      </div>
    </div>
  );
};
