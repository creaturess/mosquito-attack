/**
 * gameplayConfig.ts
 * Configuración central del juego y parámetros de jugabilidad.
 * Editá estos valores para calibrar la dificultad de seguimiento visual,
 * tamaños de mosquitos, velocidades, opacidades y tolerancias.
 */

export const GAMEPLAY_CONFIG = {
  // ==========================================
  // 1. VISIBILIDAD, OPACIDAD Y TAMAÑO (PROBLEMA 1 & 2.2)
  // ==========================================
  visibility: {
    /** Distancia máxima en metros donde el mosquito empieza a desvanecerse (> 6m no es visible) */
    maxVisibleDistance: 6.0,

    /** Distancia en metros donde el mosquito alcanza OPACIDAD COMPLETA 1.0 (sólido total) */
    fullOpacityDistance: 4.0,

    /** Escala base del modelo 3D (aumentado para garantizar que se vea claramente) */
    baseScale: 2.3,

    /** Escala del jefe gigante (Nivel 3) */
    bossScale: 4.8,

    /** Escala mínima garantizada (clamp) a cualquier distancia visible: evita que se vuelva un puntito */
    minScaleFactor: 0.75,

    /** Grosor y brillo del reborde/silueta para contraste contra fondos oscuros y claros */
    outlineScale: 1.12,
    outlineColor: 0x94a3b8, // Gris claro / azul metálico de alto contraste
  },

  // ==========================================
  // 2. VELOCIDAD Y SEGUIMIENTO VISUAL (PROBLEMA 2.1 & 2.4)
  // ==========================================
  movement: {
    /** Velocidad base de vuelo en m/s en Nivel 1 */
    baseSpeedLvl1: 0.32,

    /** Velocidad base de vuelo en m/s en Nivel 2 */
    baseSpeedLvl2: 0.42,

    /** Límite de velocidad angular cuando está a la vista del jugador (grados por segundo en pantalla) */
    maxAngularSpeedDeg: 75,

    /** Factor de suavizado inercial en giros (mayor número = curvas más suaves, nunca giros secos) */
    turnSmoothing: 2.6,

    /** Reducción de velocidad cuando el mosquito está dentro del campo de visión para facilitar el tracking */
    inViewSpeedDamp: 0.8,

    /** Tiempo máximo de duración de los picos de aceleración / zigzags rápidos en segundos (< 0.3s) */
    dartDuration: 0.22,

    /** Multiplicador de velocidad durante el pico de aceleración (acotado y suave) */
    dartSpeedMultiplier: 1.5,

    /** Intervalo mínimo entre aceleraciones (segundos) - poco frecuentes */
    dartMinInterval: 4.5,

    /** Intervalo máximo entre aceleraciones (segundos) */
    dartMaxInterval: 7.5,

    /** Tiempo (segundos) que el mosquito merodea cerca del borde al salir del encuadre */
    screenEdgeLingerTime: 1.6,

    /** Distancia de seguridad a la cámara para que nunca choque ni se pegue a la pantalla */
    cameraRepelDistance: 1.6,
  },

  // ==========================================
  // 3. ESTELA DE MOVIMIENTO / MOTION TRAIL (PROBLEMA 2.3)
  // ==========================================
  trail: {
    /** Habilitar o deshabilitar estela */
    enabled: true,

    /** Cantidad de puntos en la estela */
    maxPoints: 12,

    /** Duración en segundos que tarda en desvanecerse la estela (0.3s a 0.5s) */
    lifetimeSec: 0.42,

    /** Opacidad máxima de la estela */
    opacity: 0.65,

    /** Color de la estela (cian eléctrico tenue para contraste sobre cualquier fondo) */
    color: 0x38bdf8,
  },

  // ==========================================
  // 4. ASISTENCIAS DE SEGUIMIENTO (PROBLEMA 2.5 & 2.6)
  // ==========================================
  trackingAid: {
    /** Multiplicador de separación estéreo izquierda/derecha para el audio 3D */
    stereoSpreadBoost: 1.85,

    /** Duración (segundos) de la flecha/indicador visual en el borde al perder de vista un mosquito */
    edgeIndicatorDuration: 1.5,

    /** Ángulo del cono de visión central (grados) para que la mira detecte y reaccione al apuntar */
    reticleTargetConeDeg: 14,

    /** Radio de colisión 3D del mosquito en metros (hitbox generosa) */
    hitSphereRadius: 2.0,

    /** Tolerancia de toque o click en pantalla (píxeles) para impacto garantizado */
    screenTouchTolerancePx: 100,
  },

  // ==========================================
  // 5. NIDOS Y REAPARICIÓN
  // ==========================================
  nests: {
    /** Cantidad de nidos en el mundo */
    count: 6,

    /** Distancia mínima y máxima de los nidos al jugador (metros) */
    minDistance: 3.6,
    maxDistance: 7.2,

    /** Rango de alturas de los nidos (metros) */
    minHeight: 0.9,
    maxHeight: 3.1,

    /** Tiempo de espera en segundos para reaparecer en el nido al ser eliminado */
    respawnDelaySec: 4.0,
  },
};
