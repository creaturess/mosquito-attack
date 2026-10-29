/**
 * gameplayConfig.ts
 * Configuración central del juego y parámetros de jugabilidad.
 * Editá estos valores para calibrar la dificultad de seguimiento visual,
 * distancias de aparición, tamaños, velocidades y tolerancias.
 */

export const GAMEPLAY_CONFIG = {
  // ==========================================
  // 1. VISIBILIDAD, OPACIDAD Y TAMAÑO
  // ==========================================
  visibility: {
    /** Distancia máxima en metros donde el mosquito es visible */
    maxVisibleDistance: 99.0,

    /** Distancia en metros para opacidad 100% (siempre 1.0 sólido a toda distancia) */
    fullOpacityDistance: 99.0,

    /** Escala base del mosquito en Nivel 1 (más pequeño, realista como insecto volador) */
    lvl1Scale: 1.05,

    /** Escala base del mosquito en Nivel 2 */
    lvl2Scale: 1.3,

    /** Escala base por defecto */
    baseScale: 1.05,

    /** Escala del jefe gigante (Nivel 3) */
    bossScale: 4.8,

    /** Escala mínima garantizada (clamp) a cualquier distancia visible: evita que se vuelva un puntito */
    minScaleFactor: 0.85,

    /** Grosor y brillo del reborde/silueta para contraste contra fondos oscuros y claros */
    outlineScale: 1.14,
    outlineColor: 0x94a3b8, // Gris claro / azul metálico de alto contraste
  },

  // ==========================================
  // 2. VELOCIDAD Y MOVIMIENTO (REVOLOTEO REALISTA DE INSECTO)
  // ==========================================
  movement: {
    /** Velocidad base de vuelo en m/s en Nivel 1 */
    baseSpeedLvl1: 0.42,

    /** Velocidad base de vuelo en m/s en Nivel 2 */
    baseSpeedLvl2: 0.55,

    /** Límite de velocidad angular cuando está a la vista del jugador (grados por segundo en pantalla) */
    maxAngularSpeedDeg: 85,

    /** Suavizado de giro */
    turnSmoothing: 4.5,

    /** Reducción de velocidad cuando el mosquito está dentro del campo de visión */
    inViewSpeedDamp: 0.88,

    /** Frecuencia de micro-revoloteo/vibración de vuelo (Hz) */
    flutterFreq: 15.0,

    /** Amplitud de micro-revoloteo en metros (pequeños temblores y oscilaciones realistas de vuelo) */
    flutterAmp: 0.05,

    /** Intervalo mínimo entre quiebres erráticos de dirección (segundos) */
    dartMinInterval: 0.5,

    /** Intervalo máximo entre quiebres erráticos de dirección (segundos) */
    dartMaxInterval: 1.3,

    /** Multiplicador de velocidad durante un pique o quiebre errático */
    dartSpeedMultiplier: 1.65,

    /** Duración del pique errático (segundos) */
    dartDuration: 0.22,

    /** Distancia mínima de seguridad a la cámara para que nunca se pegue a la pantalla */
    cameraRepelDistance: 2.8,

    /** Distancia mínima de separación entre mosquitos para evitar que aparezcan o vuelen juntos */
    minMosquitoSeparation: 2.6,
  },

  // ==========================================
  // 3. ESTELA DE MOVIMIENTO / MOTION TRAIL
  // ==========================================
  trail: {
    /** Habilitar o deshabilitar estela */
    enabled: true,

    /** Cantidad de puntos en la estela */
    maxPoints: 14,

    /** Duración en segundos que tarda en desvanecerse la estela (0.3s a 0.5s) */
    lifetimeSec: 0.45,

    /** Opacidad máxima de la estela */
    opacity: 0.65,

    /** Color de la estela (cian eléctrico tenue para contraste sobre cualquier fondo) */
    color: 0x38bdf8,
  },

  // ==========================================
  // 4. ASISTENCIAS DE SEGUIMIENTO Y TOLERANCIA DE IMPACTO
  // ==========================================
  trackingAid: {
    /** Multiplicador de separación estéreo izquierda/derecha para el audio 3D */
    stereoSpreadBoost: 1.85,

    /** Duración (segundos) de la flecha/indicador visual en el borde al perder de vista un mosquito */
    edgeIndicatorDuration: 1.5,

    /** Ángulo del cono de visión central (grados) para que la mira detecte y reaccione al apuntar */
    reticleTargetConeDeg: 15,

    /** Radio de colisión 3D del mosquito en metros (hitbox generosa para acertar a 5-8 metros) */
    hitSphereRadius: 2.8,

    /** Tolerancia de toque o click en pantalla (píxeles) para impacto garantizado */
    screenTouchTolerancePx: 120,
  },

  // ==========================================
  // 5. NIDOS Y DISTRIBUCIÓN ESPACIAL
  // ==========================================
  nests: {
    /** Cantidad de nidos en el mundo */
    count: 6,

    /** Distancia mínima y máxima de los nidos al jugador (metros): más lejos de la cámara */
    minDistance: 5.0,
    maxDistance: 7.8,

    /** Rango de alturas de los nidos (metros): distribuidos en todo el campo vertical */
    minHeight: 0.6,
    maxHeight: 3.2,

    /** Radio de barrido orbital amplio para cruzar toda la pantalla (metros) */
    minSweepRadius: 2.4,
    maxSweepRadius: 3.8,

    /** Tiempo de espera en segundos para reaparecer en el nido al ser eliminado */
    respawnDelaySec: 4.0,
  },
};
