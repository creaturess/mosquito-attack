/**
 * gameplayConfig.ts
 * Configuración central del juego y parámetros de jugabilidad.
 * Editá estos valores para calibrar la dificultad, física y ayudas.
 */

export const CONFIG = {
  // ==========================================
  // AYUDAS VISUALES Y ELEMENTOS DE INTERFAZ (PROBLEMA A)
  // Desactivadas por defecto según las reglas
  // ==========================================
  showHints: false,           // Por defecto: ninguna ayuda visual o cartel
  showDebug: false,           // Por defecto: modo debug desactivado
  showEdgeIndicator: false,   // Por defecto: sin flechas direccionales al salir de pantalla
  showHotColdVignette: false, // Por defecto: sin viñeta caliente/frío

  // ==========================================
  // VISIBILIDAD, OPACIDAD Y TAMAÑO (PROBLEMA B)
  // ==========================================
  visibility: {
    /** Distancia d >= 7.0m: opacidad 0 (invisible) */
    invisibleDistance: 7.0,

    /** Distancia d <= 4.5m: opacidad 1.0 exacto (100% sólido) */
    solidDistance: 4.5,

    /** Escala base del mosquito 3D (garantiza tamaño visible y legible) */
    baseScale: 2.3,

    /** Escala mínima garantizada para que nunca se vuelva un puntito invisible */
    minScaleFactor: 0.8,

    /** Escala del jefe gigante (Nivel 3) */
    bossScale: 4.8,

    /** Color de cuerpo oscuro y opaco */
    bodyColor: 0x181a1d,

    /** Reborde fino claro para contraste sobre cualquier fondo */
    outlineColor: 0x94a3b8,
  },

  // ==========================================
  // FÍSICA Y STEERING DE MOVIMIENTO (PROBLEMA C)
  // ==========================================
  physics: {
    /** Velocidad máxima en vuelo normal (m/s) */
    maxSpeed: 1.6,

    /** Aceleración máxima (m/s²) para que los cambios de dirección sean curvos */
    maxAcceleration: 3.0,

    /** Velocidad angular máxima de giro de la dirección (grados/segundo) */
    maxTurnRateDeg: 120,

    /** Límite de velocidad angular aparente en pantalla vista desde la cámara (grados/s) */
    maxScreenAngularSpeed: 70,

    /** Radio de la zona del nido para elegir puntos objetivo wanderTarget (metros) */
    nestWanderRadius: 1.5,

    /** Distancia al wanderTarget para seleccionar uno nuevo (metros) */
    targetArrivalThreshold: 0.4,

    /** Distancia a la cámara para iniciar evasión suave (metros) */
    cameraRepelDistance: 1.5,

    /** Fuerza progresiva de repulsión de la cámara */
    cameraRepelStrength: 4.5,

    /** Damping de fricción por segundo (0.98 a 60fps) */
    dampingPerSec: 0.3,

    // Zigzags rápidos ocasionales (breves y poco frecuentes)
    zigzagDuration: 0.22,      // Segundos (<= 0.25s)
    zigzagMinInterval: 4.5,    // Segundos mínimos entre zigzags
    zigzagMaxInterval: 7.5,    // Segundos máximos entre zigzags
    zigzagStrength: 2.2,       // Fuerza lateral del zigzag
  },

  // ==========================================
  // ESTELA DE MOVIMIENTO (MOTION TRAIL)
  // ==========================================
  trail: {
    enabled: true,
    maxPoints: 10,
    lifetimeSec: 0.38,
    opacity: 0.45,
    color: 0x38bdf8,
  },

  // ==========================================
  // TOLERANCIA DE IMPACTO / COMBATE
  // ==========================================
  combat: {
    hitboxRadius: 2.0,            // Radio de la esfera de impacto 3D en metros
    screenTouchTolerancePx: 100,  // Tolerancia de toque en pantalla en píxeles
    respawnDelaySec: 4.0,         // Segundos para reaparecer en su nido al morir
  },

  // ==========================================
  // NIDOS EN EL MUNDO
  // ==========================================
  nests: {
    count: 6,
    minDistance: 3.6,
    maxDistance: 7.2,
    minHeight: 0.9,
    maxHeight: 3.1,
  },
};
