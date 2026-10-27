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
    /** Distancia máxima en metros donde el mosquito empieza a ser visible (> 9.0m no es visible) */
    maxVisibleDistance: 9.2,

    /** Distancia en metros donde el mosquito alcanza OPACIDAD COMPLETA 1.0 (sólido total) */
    fullOpacityDistance: 7.0,

    /** Escala base del modelo 3D (aumentado para que se vea claro a 5m-7.5m y ocupe 60-90px) */
    baseScale: 3.4,

    /** Escala del jefe gigante (Nivel 3) */
    bossScale: 5.6,

    /** Escala mínima garantizada (clamp) a cualquier distancia visible: evita que se vuelva un puntito */
    minScaleFactor: 0.82,

    /** Grosor y brillo del reborde/silueta para contraste contra fondos oscuros y claros */
    outlineScale: 1.14,
    outlineColor: 0x94a3b8, // Gris claro / azul metálico de alto contraste
  },

  // ==========================================
  // 2. VELOCIDAD Y MOVIMIENTO (BARRIDOS A TRAVÉS DE LA PANTALLA)
  // ==========================================
  movement: {
    /** Velocidad base de vuelo en m/s en Nivel 1 */
    baseSpeedLvl1: 0.36,

    /** Velocidad base de vuelo en m/s en Nivel 2 */
    baseSpeedLvl2: 0.46,

    /** Límite de velocidad angular cuando está a la vista del jugador (grados por segundo en pantalla) */
    maxAngularSpeedDeg: 70,

    /** Factor de suavizado inercial en giros (mayor número = curvas más suaves, nunca giros secos) */
    turnSmoothing: 2.2,

    /** Reducción de velocidad cuando el mosquito está dentro del campo de visión para facilitar el tracking */
    inViewSpeedDamp: 0.85,

    /** Tiempo máximo de duración de los picos de aceleración / zigzags rápidos en segundos (< 0.3s) */
    dartDuration: 0.2,

    /** Multiplicador de velocidad durante el pico de aceleración (acotado y suave) */
    dartSpeedMultiplier: 1.45,

    /** Intervalo mínimo entre aceleraciones (segundos) - poco frecuentes */
    dartMinInterval: 5.0,

    /** Intervalo máximo entre aceleraciones (segundos) */
    dartMaxInterval: 8.5,

    /** Distancia mínima de seguridad a la cámara para que nunca se pegue a la pantalla */
    cameraRepelDistance: 3.0,
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
