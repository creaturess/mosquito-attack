/**
 * RoomEnvironment.ts
 * Recreates the exact modern aesthetic gaming bedroom from the reference image:
 * - Floating platform bed with warm amber underglow LED strip
 * - Multi-layer bedding, duvet, and accent pillows
 * - Double wall shelves with decorative vases, books, and trailing potted plant
 * - Vertical neon ambient light strip in wall column
 * - Gaming desk with curved ultrawide monitor, warm backlighting, RGB PC tower, and headset
 * - Ergonomic gamer chair on caster wheels
 * - Charcoal/slate walls and dark reflective flooring with mood lighting
 */

import * as THREE from 'three';

export interface RoomBounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  minZ: number;
  maxZ: number;
}

export class RoomEnvironment {
  public group: THREE.Group;
  public bounds: RoomBounds = {
    minX: -4.3,
    maxX: 4.3,
    minY: 0.1,
    maxY: 3.5,
    minZ: -4.0,
    maxZ: 4.0,
  };

  constructor() {
    this.group = new THREE.Group();
    this.buildRoom();
  }

  private buildRoom() {
    // Shared Materials
    const wallMat = new THREE.MeshStandardMaterial({
      color: 0x1f2638, // Mood slate blue/charcoal as in image
      roughness: 0.85,
      metalness: 0.05,
    });

    const floorMat = new THREE.MeshStandardMaterial({
      color: 0x141824, // Dark reflective matte floor
      roughness: 0.5,
      metalness: 0.2,
    });

    const ceilingMat = new THREE.MeshStandardMaterial({
      color: 0x181f2f,
      roughness: 0.9,
    });

    const woodShelfMat = new THREE.MeshStandardMaterial({
      color: 0x242c3d,
      roughness: 0.7,
      metalness: 0.1,
    });

    const bedFrameMat = new THREE.MeshStandardMaterial({
      color: 0x222a3d,
      roughness: 0.8,
    });

    const mattressMat = new THREE.MeshStandardMaterial({
      color: 0xdde2ea,
      roughness: 0.9,
    });

    const duvetMat = new THREE.MeshStandardMaterial({
      color: 0x2b3852, // Navy blue duvet
      roughness: 0.75,
    });

    const pillowDarkMat = new THREE.MeshStandardMaterial({
      color: 0x232e44,
      roughness: 0.75,
    });

    const pillowLightMat = new THREE.MeshStandardMaterial({
      color: 0xcdd6e4,
      roughness: 0.85,
    });

    const deskTopMat = new THREE.MeshStandardMaterial({
      color: 0xd8dde6, // Sleek light-grey desk surface
      roughness: 0.35,
      metalness: 0.1,
    });

    const deskCabinetMat = new THREE.MeshStandardMaterial({
      color: 0x252e40,
      roughness: 0.7,
    });

    const blackPlasticMat = new THREE.MeshStandardMaterial({
      color: 0x111317,
      roughness: 0.4,
      metalness: 0.5,
    });

    // --- 1. WALLS, FLOOR & CEILING ---
    const roomWidth = 9.2;
    const roomHeight = 3.8;
    const roomDepth = 8.6;

    // Floor (at y = 0)
    const floorGeo = new THREE.PlaneGeometry(roomWidth, roomDepth);
    floorGeo.rotateX(-Math.PI / 2);
    const floor = new THREE.Mesh(floorGeo, floorMat);
    floor.position.y = 0;
    this.group.add(floor);

    // Ceiling (at y = roomHeight)
    const ceilingGeo = new THREE.PlaneGeometry(roomWidth, roomDepth);
    ceilingGeo.rotateX(Math.PI / 2);
    const ceiling = new THREE.Mesh(ceilingGeo, ceilingMat);
    ceiling.position.y = roomHeight;
    this.group.add(ceiling);

    // Back Wall (z = -roomDepth / 2)
    const backWallGeo = new THREE.PlaneGeometry(roomWidth, roomHeight);
    const backWall = new THREE.Mesh(backWallGeo, wallMat);
    backWall.position.set(0, roomHeight / 2, -roomDepth / 2);
    this.group.add(backWall);

    // Front Wall (z = roomDepth / 2)
    const frontWallGeo = new THREE.PlaneGeometry(roomWidth, roomHeight);
    frontWallGeo.rotateY(Math.PI);
    const frontWall = new THREE.Mesh(frontWallGeo, wallMat);
    frontWall.position.set(0, roomHeight / 2, roomDepth / 2);
    this.group.add(frontWall);

    // Left Wall (x = -roomWidth / 2)
    const leftWallGeo = new THREE.PlaneGeometry(roomDepth, roomHeight);
    leftWallGeo.rotateY(Math.PI / 2);
    const leftWall = new THREE.Mesh(leftWallGeo, wallMat);
    leftWall.position.set(-roomWidth / 2, roomHeight / 2, 0);
    this.group.add(leftWall);

    // Right Wall (x = roomWidth / 2)
    const rightWallGeo = new THREE.PlaneGeometry(roomDepth, roomHeight);
    rightWallGeo.rotateY(-Math.PI / 2);
    const rightWall = new THREE.Mesh(rightWallGeo, wallMat);
    rightWall.position.set(roomWidth / 2, roomHeight / 2, 0);
    this.group.add(rightWall);

    // Baseboards / Skirting
    const trimMat = new THREE.MeshStandardMaterial({ color: 0x131722, roughness: 0.6 });
    const trimBack = new THREE.Mesh(new THREE.BoxGeometry(roomWidth, 0.12, 0.04), trimMat);
    trimBack.position.set(0, 0.06, -roomDepth / 2 + 0.02);
    const trimLeft = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.12, roomDepth), trimMat);
    trimLeft.position.set(-roomWidth / 2 + 0.02, 0.06, 0);
    const trimRight = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.12, roomDepth), trimMat);
    trimRight.position.set(roomWidth / 2 - 0.02, 0.06, 0);
    this.group.add(trimBack, trimLeft, trimRight);

    // --- 2. FLOATING PLATFORM BED WITH AMBER UNDERGLOW ---
    const bedGroup = new THREE.Group();
    bedGroup.position.set(-1.8, 0, -2.1);

    // Recessed Floating Pedestal (hidden underneath to give floating effect)
    const bedPedestal = new THREE.Mesh(
      new THREE.BoxGeometry(2.1, 0.22, 2.3),
      new THREE.MeshStandardMaterial({ color: 0x0a0c10 })
    );
    bedPedestal.position.set(0, 0.11, 0);
    bedGroup.add(bedPedestal);

    // Floating Platform Frame
    const bedPlatform = new THREE.Mesh(new THREE.BoxGeometry(2.5, 0.24, 2.7), bedFrameMat);
    bedPlatform.position.set(0, 0.34, 0);
    bedGroup.add(bedPlatform);

    // Upholstered Headboard against back wall
    const headboard = new THREE.Mesh(new THREE.BoxGeometry(2.5, 1.25, 0.28), bedFrameMat);
    headboard.position.set(0, 0.95, -1.26);
    bedGroup.add(headboard);

    // Mattress
    const mattress = new THREE.Mesh(new THREE.BoxGeometry(2.25, 0.32, 2.45), mattressMat);
    mattress.position.set(0, 0.58, 0.05);
    bedGroup.add(mattress);

    // Navy Blue Duvet / Quilt (covers two-thirds of bed)
    const duvet = new THREE.Mesh(new THREE.BoxGeometry(2.32, 0.18, 1.7), duvetMat);
    duvet.position.set(0, 0.72, 0.45);
    bedGroup.add(duvet);

    // Folded top quilt accent
    const duvetFold = new THREE.Mesh(new THREE.BoxGeometry(2.34, 0.08, 0.35), duvetMat);
    duvetFold.position.set(0, 0.78, -0.42);
    bedGroup.add(duvetFold);

    // Pillows (2 light grey behind, 2 dark navy in front)
    const createPillow = (
      w: number,
      h: number,
      d: number,
      mat: THREE.Material,
      x: number,
      y: number,
      z: number,
      rotX: number
    ) => {
      const pillow = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
      pillow.position.set(x, y, z);
      pillow.rotation.x = rotX;
      return pillow;
    };

    // Back light pillows
    bedGroup.add(createPillow(0.72, 0.2, 0.42, pillowLightMat, -0.58, 0.82, -0.9, 0.35));
    bedGroup.add(createPillow(0.72, 0.2, 0.42, pillowLightMat, 0.58, 0.82, -0.9, 0.35));
    // Front dark navy pillows (propped up)
    bedGroup.add(createPillow(0.68, 0.22, 0.38, pillowDarkMat, -0.58, 0.84, -0.62, 0.5));
    bedGroup.add(createPillow(0.68, 0.22, 0.38, pillowDarkMat, 0.58, 0.84, -0.62, 0.5));

    // Underbed Warm Amber LED Glow Mesh (emissive strip underneath)
    const underbedGlowGeo = new THREE.PlaneGeometry(2.3, 2.5);
    underbedGlowGeo.rotateX(-Math.PI / 2);
    const underbedGlowMat = new THREE.MeshBasicMaterial({
      color: 0xff8811,
      transparent: true,
      opacity: 0.75,
    });
    const underbedGlowMesh = new THREE.Mesh(underbedGlowGeo, underbedGlowMat);
    underbedGlowMesh.position.set(0, 0.02, 0);
    bedGroup.add(underbedGlowMesh);

    // Warm Amber Point Light under the bed
    const bedUnderlight = new THREE.PointLight(0xff7700, 3.8, 4.5, 1.4);
    bedUnderlight.position.set(0, 0.18, 0.2);
    bedGroup.add(bedUnderlight);

    this.group.add(bedGroup);

    // --- 3. WALL SHELVES & DECOR (LEFT WALL) ---
    const shelfGroup = new THREE.Group();
    shelfGroup.position.set(-roomWidth / 2 + 0.35, 2.1, -1.8);

    // Shelf 1 (Bottom)
    const shelf1 = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.06, 3.2), woodShelfMat);
    shelfGroup.add(shelf1);

    // Shelf 2 (Top)
    const shelf2 = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.06, 3.2), woodShelfMat);
    shelf2.position.set(0, 0.65, 0);
    shelfGroup.add(shelf2);

    // Vertical Support Panels
    const shelfWallBack = new THREE.Mesh(
      new THREE.BoxGeometry(0.04, 0.72, 3.2),
      new THREE.MeshStandardMaterial({ color: 0x1a2130 })
    );
    shelfWallBack.position.set(-0.25, 0.32, 0);
    shelfGroup.add(shelfWallBack);

    // Ceramic Decor on Shelves
    const ceramicMat = new THREE.MeshStandardMaterial({ color: 0xd9e0ea, roughness: 0.3 });
    const darkVaseMat = new THREE.MeshStandardMaterial({ color: 0x242c3d, roughness: 0.5 });

    // Tall white bottle vase
    const tallVase = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.1, 0.42, 16), ceramicMat);
    tallVase.position.set(0.05, 0.24, -1.1);
    shelfGroup.add(tallVase);

    // Medium vase
    const medVase = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.07, 0.28, 16), ceramicMat);
    medVase.position.set(0.08, 0.17, -0.8);
    shelfGroup.add(medVase);

    // Signature Donut / Torus sculpture vase from photo!
    const torusVase = new THREE.Mesh(new THREE.TorusGeometry(0.14, 0.045, 12, 24), darkVaseMat);
    torusVase.position.set(0.06, 0.18, -0.45);
    torusVase.rotation.y = Math.PI / 4;
    shelfGroup.add(torusVase);

    // Set of horizontal and leaning books
    const bookMat1 = new THREE.MeshStandardMaterial({ color: 0xd4dcfa, roughness: 0.6 });
    const bookMat2 = new THREE.MeshStandardMaterial({ color: 0x3f4b66, roughness: 0.6 });
    const books = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.08, 0.35), bookMat1);
    books.position.set(0.05, 0.07, 0.15);
    shelfGroup.add(books);

    // Small ceramic cups on top shelf
    const cup1 = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.06, 0.16, 12), ceramicMat);
    cup1.position.set(0.05, 0.76, -0.35);
    const cup2 = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.06, 0.16, 12), ceramicMat);
    cup2.position.set(0.05, 0.76, -0.1);
    shelfGroup.add(cup1, cup2);

    // Potted plant on top shelf with hanging trailing vines
    const pot = new THREE.Mesh(
      new THREE.CylinderGeometry(0.14, 0.1, 0.22, 16),
      new THREE.MeshStandardMaterial({ color: 0x1f2738 })
    );
    pot.position.set(0.05, 0.79, 0.6);
    shelfGroup.add(pot);

    // Plant foliage
    const plantMat = new THREE.MeshStandardMaterial({
      color: 0x22c55e,
      roughness: 0.6,
    });
    const plantBush = new THREE.Mesh(new THREE.DodecahedronGeometry(0.2, 1), plantMat);
    plantBush.position.set(0.05, 0.95, 0.6);
    shelfGroup.add(plantBush);

    // Trailing vine leaves hanging down
    for (let i = 0; i < 4; i++) {
      const vine = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.28 + i * 0.08, 0.06), plantMat);
      vine.position.set(0.14 + (Math.random() - 0.5) * 0.05, 0.65 - i * 0.08, 0.52 + i * 0.07);
      vine.rotation.z = -0.15;
      shelfGroup.add(vine);
    }

    this.group.add(shelfGroup);

    // Vertical Warm Amber Neon Column on Left Wall
    const neonColumn = new THREE.Mesh(
      new THREE.BoxGeometry(0.08, 2.2, 0.08),
      new THREE.MeshBasicMaterial({ color: 0xffaa22 })
    );
    neonColumn.position.set(-roomWidth / 2 + 0.06, 1.8, 0.5);
    this.group.add(neonColumn);

    const neonLight = new THREE.PointLight(0xff8811, 2.2, 3.5, 1.6);
    neonLight.position.set(-roomWidth / 2 + 0.25, 1.8, 0.5);
    this.group.add(neonLight);

    // Window / Curtain silhouette on far left corner
    const curtainGeo = new THREE.BoxGeometry(0.18, roomHeight, 1.2);
    const curtainMat = new THREE.MeshStandardMaterial({ color: 0x0f1422, roughness: 0.95 });
    const curtain = new THREE.Mesh(curtainGeo, curtainMat);
    curtain.position.set(-roomWidth / 2 + 0.1, roomHeight / 2, 2.8);
    this.group.add(curtain);

    // --- 4. GAMING DESK SETUP (RIGHT SIDE) ---
    const deskGroup = new THREE.Group();
    deskGroup.position.set(1.9, 0, -2.5);

    // Main Sleek Desktop Countertop
    const deskWidth = 2.9;
    const deskDepth = 1.05;
    const deskHeight = 0.74;

    const deskTop = new THREE.Mesh(new THREE.BoxGeometry(deskWidth, 0.07, deskDepth), deskTopMat);
    deskTop.position.set(0, deskHeight, 0);
    deskGroup.add(deskTop);

    // Beveled LED Neon Edge Strip (Cyan/Magenta glow)
    const deskLedStrip = new THREE.Mesh(
      new THREE.BoxGeometry(deskWidth + 0.02, 0.025, 0.03),
      new THREE.MeshBasicMaterial({ color: 0x06b6d4 })
    );
    deskLedStrip.position.set(0, deskHeight, deskDepth / 2 + 0.01);
    deskGroup.add(deskLedStrip);

    // Metal legs on the left side of the desk
    const legLeftFront = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, deskHeight), blackPlasticMat);
    legLeftFront.position.set(-deskWidth / 2 + 0.12, deskHeight / 2, deskDepth / 2 - 0.1);
    const legLeftBack = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, deskHeight), blackPlasticMat);
    legLeftBack.position.set(-deskWidth / 2 + 0.12, deskHeight / 2, -deskDepth / 2 + 0.1);
    deskGroup.add(legLeftFront, legLeftBack);

    // Drawer Cabinet Unit on the right side of the desk
    const cabinetWidth = 0.65;
    const cabinetHeight = deskHeight - 0.05;
    const cabinetDepth = 0.95;
    const cabinet = new THREE.Mesh(
      new THREE.BoxGeometry(cabinetWidth, cabinetHeight, cabinetDepth),
      deskCabinetMat
    );
    cabinet.position.set(deskWidth / 2 - cabinetWidth / 2, cabinetHeight / 2, 0);
    deskGroup.add(cabinet);

    // Drawer seam lines & handles
    for (let i = 0; i < 3; i++) {
      const handle = new THREE.Mesh(
        new THREE.BoxGeometry(0.22, 0.02, 0.02),
        new THREE.MeshStandardMaterial({ color: 0x0f131a, metalness: 0.8, roughness: 0.2 })
      );
      handle.position.set(deskWidth / 2 - cabinetWidth / 2, 0.2 + i * 0.22, cabinetDepth / 2 + 0.015);
      deskGroup.add(handle);
    }

    // --- CURVED ULTRAWIDE MONITOR ---
    const monitorGroup = new THREE.Group();
    monitorGroup.position.set(-0.35, deskHeight + 0.035, -0.15);

    // Monitor Stand
    const standBase = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.02, 0.25), blackPlasticMat);
    standBase.position.set(0, 0.01, 0);
    const standPole = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.35, 12), blackPlasticMat);
    standPole.position.set(0, 0.18, -0.05);
    monitorGroup.add(standBase, standPole);

    // Curved Screen Bezel (approximated with angled segments)
    const screenMat = new THREE.MeshStandardMaterial({
      color: 0x05070a,
      roughness: 0.2,
      metalness: 0.8,
    });
    const centerScreen = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.44, 0.03), screenMat);
    centerScreen.position.set(0, 0.38, 0);

    const leftWingScreen = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.44, 0.03), screenMat);
    leftWingScreen.position.set(-0.58, 0.38, 0.05);
    leftWingScreen.rotation.y = 0.28;

    const rightWingScreen = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.44, 0.03), screenMat);
    rightWingScreen.position.set(0.58, 0.38, 0.05);
    rightWingScreen.rotation.y = -0.28;

    monitorGroup.add(centerScreen, leftWingScreen, rightWingScreen);

    // Backlight Behind Monitor (Orange/Amber glow casting on back wall, exactly as in photo!)
    const monitorBacklight = new THREE.PointLight(0xff6600, 3.2, 3.8, 1.4);
    monitorBacklight.position.set(0, 0.4, -0.3);
    monitorGroup.add(monitorBacklight);

    // Gaming Headset hooked on monitor right side
    const headsetMat = new THREE.MeshStandardMaterial({ color: 0x0d1117, metalness: 0.4, roughness: 0.3 });
    const headsetBand = new THREE.Mesh(new THREE.TorusGeometry(0.1, 0.02, 8, 16, Math.PI), headsetMat);
    headsetBand.position.set(0.8, 0.44, 0.05);
    headsetBand.rotation.y = Math.PI / 2;
    const earCupL = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.04, 12), headsetMat);
    earCupL.position.set(0.8, 0.34, 0.12);
    const earCupR = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.04, 12), headsetMat);
    earCupR.position.set(0.8, 0.34, -0.02);
    monitorGroup.add(headsetBand, earCupL, earCupR);

    deskGroup.add(monitorGroup);

    // --- GAMING PC TOWER WITH RGB FANS ---
    const pcGroup = new THREE.Group();
    pcGroup.position.set(deskWidth / 2 - 0.42, deskHeight + 0.035, 0.05);

    // Tower chassis
    const pcCase = new THREE.Mesh(
      new THREE.BoxGeometry(0.28, 0.52, 0.56),
      new THREE.MeshStandardMaterial({ color: 0x0a0c10, roughness: 0.3, metalness: 0.8 })
    );
    pcCase.position.set(0, 0.26, 0);
    pcGroup.add(pcCase);

    // Glass Side Panel with glowing purple interior
    const glassPanel = new THREE.Mesh(
      new THREE.PlaneGeometry(0.52, 0.48),
      new THREE.MeshStandardMaterial({
        color: 0x8b5cf6,
        transparent: true,
        opacity: 0.45,
        roughness: 0.1,
      })
    );
    glassPanel.position.set(-0.141, 0.26, 0);
    glassPanel.rotation.y = -Math.PI / 2;
    pcGroup.add(glassPanel);

    // 3 Front RGB Glowing Fan Rings (Signature neon rings from photo!)
    const fanMat1 = new THREE.MeshBasicMaterial({ color: 0xa855f7 });
    const fanMat2 = new THREE.MeshBasicMaterial({ color: 0x06b6d4 });
    const fanMat3 = new THREE.MeshBasicMaterial({ color: 0x3b82f6 });

    for (let i = 0; i < 3; i++) {
      const fanRing = new THREE.Mesh(
        new THREE.TorusGeometry(0.055, 0.012, 8, 16),
        i === 0 ? fanMat1 : i === 1 ? fanMat2 : fanMat3
      );
      fanRing.position.set(0, 0.14 + i * 0.14, 0.281);
      pcGroup.add(fanRing);
    }

    // Soft PC Light Glow
    const pcLight = new THREE.PointLight(0xa855f7, 1.8, 2.2, 1.8);
    pcLight.position.set(-0.25, 0.28, 0);
    pcGroup.add(pcLight);

    // Extended Mousemat, Keyboard & Mouse
    const mousemat = new THREE.Mesh(
      new THREE.BoxGeometry(0.9, 0.008, 0.38),
      new THREE.MeshStandardMaterial({ color: 0x111622, roughness: 0.9 })
    );
    mousemat.position.set(-0.35, deskHeight + 0.04, 0.25);
    deskGroup.add(mousemat);

    const keyboard = new THREE.Mesh(
      new THREE.BoxGeometry(0.48, 0.016, 0.16),
      new THREE.MeshStandardMaterial({ color: 0x1f293d, roughness: 0.5 })
    );
    keyboard.position.set(-0.45, deskHeight + 0.05, 0.25);
    deskGroup.add(keyboard);

    const mouse = new THREE.Mesh(
      new THREE.BoxGeometry(0.07, 0.024, 0.12),
      new THREE.MeshStandardMaterial({ color: 0x11151f, roughness: 0.3 })
    );
    mouse.position.set(-0.05, deskHeight + 0.05, 0.25);
    deskGroup.add(mouse);

    this.group.add(deskGroup);

    // --- 5. ERGONOMIC GAMING CHAIR ---
    const chairGroup = new THREE.Group();
    chairGroup.position.set(1.4, 0, -1.35);
    chairGroup.rotation.y = -0.35; // Angled slightly towards the room

    const chairMat = new THREE.MeshStandardMaterial({
      color: 0x141a28,
      roughness: 0.6,
    });
    const chairFrameMat = new THREE.MeshStandardMaterial({
      color: 0x090b0e,
      roughness: 0.4,
      metalness: 0.6,
    });

    // 5-Spoke Star Base
    const starCenter = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.08, 10), chairFrameMat);
    starCenter.position.set(0, 0.08, 0);
    chairGroup.add(starCenter);

    for (let i = 0; i < 5; i++) {
      const angle = (i * Math.PI * 2) / 5;
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.03, 0.04), chairFrameMat);
      leg.position.set(Math.cos(angle) * 0.18, 0.06, Math.sin(angle) * 0.18);
      leg.rotation.y = -angle;
      // Caster wheel
      const wheel = new THREE.Mesh(new THREE.SphereGeometry(0.035, 8, 8), chairFrameMat);
      wheel.position.set(Math.cos(angle) * 0.35, 0.035, Math.sin(angle) * 0.35);
      chairGroup.add(leg, wheel);
    }

    // Hydraulic Cylinder
    const cylinder = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.38, 12), chairFrameMat);
    cylinder.position.set(0, 0.26, 0);
    chairGroup.add(cylinder);

    // Seat Cushion
    const seat = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.1, 0.52), chairMat);
    seat.position.set(0, 0.48, 0);
    chairGroup.add(seat);

    // Contoured High Backrest
    const backrest = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.78, 0.08), chairMat);
    backrest.position.set(0, 0.88, -0.22);
    backrest.rotation.x = -0.12;
    chairGroup.add(backrest);

    // Headrest / Neck Pillow
    const headrestPillow = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.14, 0.06), chairMat);
    headrestPillow.position.set(0, 1.25, -0.26);
    chairGroup.add(headrestPillow);

    // Armrests
    const armrestL = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.03, 0.28), chairFrameMat);
    armrestL.position.set(-0.31, 0.72, -0.02);
    const armrestR = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.03, 0.28), chairFrameMat);
    armrestR.position.set(0.31, 0.72, -0.02);
    chairGroup.add(armrestL, armrestR);

    this.group.add(chairGroup);

    // --- 6. ROOM LIGHTING & POST-PROCESSING GLOWS ---
    // Deep Navy Ambient Ambiance
    const roomAmbient = new THREE.AmbientLight(0x192138, 1.1);
    this.group.add(roomAmbient);

    // Soft Overhead Fill Light (Night Mode)
    const softCeilingLight = new THREE.PointLight(0x384a6e, 1.2, 10, 2.0);
    softCeilingLight.position.set(0, 3.4, 0);
    this.group.add(softCeilingLight);
  }
}
