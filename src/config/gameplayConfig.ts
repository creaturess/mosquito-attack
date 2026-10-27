/**
 * gameplayConfig.ts
 * Configuración central del juego y parámetros de jugabilidad.
 * Editá estos valores para calibrar la dificultad, física y distancias.
 */

export const CONFIG = {
  // ==========================================
  // 1. CONTROL DE AYUDAS VISUALES (Desactivadas por defecto)
  // ==========================================
  showHints: false,           // Sin carteles, flechas ni avisos
  showDebug: false,           // Sin textos de debug ni mallas wireframe

  // ==========================================
  // 2. VISIBILIDAD, ESCALADO Y TAMAÑO (OPACIDAD 100% SIEMPRE)
  // ==========================================
  visibility: {
    /** Distancia más allá de la cual el mosquito se oculta (visible = false) */
    maxVisibleDistance: 9.0,

    /** Distancia a partir de la cual tiene escala máxima 1.0 (entre 9m y 6m escala de 0.6 a 1.0) */
    fullScaleDistance: 6.0,

    /** Escala mínima a 9m de distancia */
    minScaleRatio: 0.6,

    /** Escala base del mosquito 3D (garantiza >= 50px en pantalla a 5m de distancia) */
    baseScale: 2.8,

    /** Escala del jefe gigante (Nivel 3) */
    bossScale: 5.2,

    /** Color de cuerpo oscuro y 100% opaco */
    bodyColor: 0x1a1a1a,

    /** Reborde fino claro para contraste contra cualquier fondo */
    outlineColor: 0x94a3b8,
  },

  // ==========================================
  // 3. NIDOS Y DISTRIBUCIÓN ESPACIAL (LEJOS DE LA CÁMARA)
  // ==========================================
  nests: {
    /** Cantidad de nidos en el mundo */
    count: 6,

    /** Distancia mínima de los nidos a la cámara (metros) */
    nestMinDistance: 5.0,

    /** Distancia máxima de los nidos a la cámara (metros) */
    nestMaxDistance: 12.0,

    /** Separación angular mínima entre nidos vistos desde la cámara (grados) */
    nestMinSeparationAngleDeg: 50,

    /** Distancia espacial mínima entre dos nidos cualesquiera (metros) */
    nestMinSeparationDist: 4.0,

    /** Rango de altura de los nidos respecto al jugador (metros) */
    minHeight: -1.0,
    maxHeight: 3.0,

    /** Máximo de mosquitos activos al mismo tiempo en total */
    maxActive: 3,

    /** Radio de patrullaje alrededor del nido (metros) */
    patrolRadius: 2.0,

    /** Tiempo de espera en segundos para reaparecer en su nido al ser eliminado */
    respawnDelaySec: 4.0,
  },

  // ==========================================
  // 4. FÍSICA Y STEERING DE VUELO SEGUIBLE
  // ==========================================
  physics: {
    /** Velocidad máxima en vuelo normal (m/s) */
    maxSpeed: 1.2,

    /** Aceleración máxima (m/s²) para que los cambios de dirección sean curvos y suaves */
    maxAcceleration: 2.0,

    /** Velocidad angular máxima de giro de la dirección (grados/segundo) */
    maxTurnRateDeg: 90,

    /** Límite de velocidad angular aparente en pantalla vista desde la cámara (grados/s) */
    maxScreenAngularSpeed: 40,

    /** Distancia mínima NUNCA permitida a la cámara (metros) */
    cameraRepelDistance: 3.0,

    /** Fuerza de repulsión suave si se acerca a menos de 3m */
    cameraRepelStrength: 3.5,

    /** Damping de fricción suave para evitar oscilaciones */
    dampingPerSec: 0.25,

    /** Ángulo máximo con la dirección actual al elegir nuevo objetivo (grados, evita giros en U) */
    maxHeadingAngleDeg: 70,

    // Pausas ocasionales (se posa o flota casi quieto de 0.5s a 1.2s para poder apuntar)
    pauseMinInterval: 5.0,
    pauseMaxInterval: 9.0,
    pauseDurationMin: 0.5,
    pauseDurationMax: 1.2,

    // Zigzags sutiles poco frecuentes
    zigzagMinInterval: 8.0,
    zigzagMaxInterval: 12.0,
    zigzagDuration: 0.28,      // <= 0.3s
    zigzagAmplitude: 0.35,     // < 0.4m
  },

  // ==========================================
  // 5. COMBATE Y TOLERANCIA
  // ==========================================
  combat: {
    /** Hitbox generosa: esfera de ~0.45m a 0.5m alrededor del mosquito */
    hitboxRadius: 0.48,

    /** Tolerancia de toque o click en pantalla (píxeles) */
    screenTouchTolerancePx: 85,
  },
};
