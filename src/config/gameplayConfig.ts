/**
 * gameplayConfig.ts
 * Configuración central del juego ajustada para ESCALA DE CUARTO (2m a 5m).
 * Todos los parámetros clave comentados en español para fácil calibración.
 */

export const CONFIG = {
  // ==========================================
  // 1. ESCALA DE CUARTO Y NIDOS
  // ==========================================
  nests: {
    /** Cantidad total de nidos distribuidos en 360° */
    count: 8,

    /** Distancia mínima de los nidos a la cámara (metros) */
    nestMinDistance: 2.0,

    /** Distancia máxima de los nidos a la cámara (metros) */
    nestMaxDistance: 5.0,

    /** Separación angular mínima entre nidos (grados) */
    nestMinSeparationAngleDeg: 45,

    /** Rango de altura de los nidos respecto a la cámara (metros) */
    minHeight: -0.5,
    maxHeight: 2.0,

    /** Cantidad mínima garantizada de mosquitos vivos en juego */
    minActive: 4,

    /** Cantidad máxima de mosquitos activos simultáneos */
    maxActive: 6,

    /** Radio de patrullaje habitual alrededor del nido (metros) */
    patrolRadius: 1.5,

    /** Radio máximo antes de forzar el retorno hacia el nido (metros) */
    leashRadius: 2.2,

    /** Tiempo de espera tras una muerte antes de permitir respawn (segundos) */
    respawnDelaySec: 1.5,

    /** Cantidad inicial de mosquitos activos al comenzar la partida (entre 4 y 6) */
    initialActive: 5,
  },

  /** Opciones de interfaz y debug (desactivadas por defecto) */
  showDebug: false,
  showHints: false,

  // ==========================================
  // 2. FÍSICA Y MOVIMIENTO DE VUELO (STEERING ÚNICO)
  // ==========================================
  physics: {
    /** Velocidad máxima de vuelo (m/s) */
    maxSpeed: 1.0,

    /** Aceleración máxima (m/s²) para curvas suaves sin tirones */
    maxAcceleration: 1.8,

    /** Giro máximo de dirección (grados/segundo) */
    maxTurnRateDeg: 100,

    /** Ángulo máximo con la dirección actual al elegir nuevo objetivo (≤ 70° evita giros en U) */
    maxHeadingAngleDeg: 70,

    /** Distancia mínima permitida a la cámara (metros) */
    cameraRepelDistance: 1.5,

    /** Fuerza de repulsión suave si se acerca a menos de 1.5m */
    cameraRepelStrength: 2.8,

    /** Damping suave para evitar oscilaciones */
    dampingPerSec: 0.2,

    // Pausas de flotación (se posa o flota casi quieto para permitir apuntar)
    pauseMinInterval: 4.0,
    pauseMaxInterval: 7.0,
    pauseDurationMin: 0.6,
    pauseDurationMax: 1.2,
  },

  // ==========================================
  // 3. VISIBILIDAD Y TAMAÑO
  // ==========================================
  visibility: {
    /** Escala base del mosquito para que sea bien visible a 2-5m (~50-65px) */
    baseScale: 2.6,

    /** Escala del jefe gigante (Nivel 3) */
    bossScale: 4.8,

    /** Color de cuerpo oscuro y 100% sólido */
    bodyColor: 0x1a1a1a,

    /** Color del reborde claro para contraste */
    outlineColor: 0x94a3b8,
  },

  // ==========================================
  // 4. COMBATE Y TOLERANCIA
  // ==========================================
  combat: {
    /** Hitbox generosa: esfera de ~0.5m alrededor del mosquito */
    hitboxRadius: 0.5,

    /** Tolerancia de toque o click en pantalla (píxeles) */
    screenTouchTolerancePx: 85,
  },

  // ==========================================
  // 5. PARÁMETROS DE AUDIO (ESCALA DE CUARTO)
  // ==========================================
  audio: {
    refDistance: 0.8,
    rolloffFactor: 1.2,
    maxDistance: 12.0,
    distanceModel: 'inverse' as DistanceModelType,
    panningModel: 'HRTF' as PanningModelType,
  },
};
