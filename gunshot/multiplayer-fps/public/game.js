// Multiplayer FPS client using Three.js and Socket.IO
// Professional FPS controls similar to Counter-Strike

console.log('game.js loaded');

// Socket.IO instance will be created lazily to avoid TDZ / init ordering issues.
let socket = null;

// Three.js core
let scene, camera, renderer, controls;
let clock;
let currentMap = null;
let currentMapBounds = null;
const currentMapCenter = new THREE.Vector3();
let loadingMapFallback = null;
let threeReady = false;
let animationStarted = false;
let resizeHandlerBound = false;
let pendingSpawnPosition = null;
let currentGroundLevel = 2;
let lastCollisionLogAt = 0;
const mapRaycastMeshes = [];
const MAPS_API_PATH = '/api/maps';
const DEFAULT_MAP_PATH = '/maps/lowpoly__fps__tdm__game__map_by_resoforge.glb';
const ENVIRONMENT_MAP_PATH = '/textures/environment.hdr';
const PLAYER_HEIGHT = 1.6;

// FPS Control System
let pointerLocked = false;
let mouseSensitivity = 0.002;
let pitch = 0; // Vertical rotation (up/down)
let yaw = 0;   // Horizontal rotation (left/right)
let moveForward = false;
let moveBackward = false;
let moveLeft = false;
let moveRight = false;
let jumpQueued = false;
let continuousFire = false;
let isShooting = false;
let isAiming = false;
let originalFov = 75;
let inputInitialized = false;

// Player state
const playerBody = {
  position: new THREE.Vector3(0, PLAYER_HEIGHT, 0),
  velocity: new THREE.Vector3(0, 0, 0),
  isOnGround: false,
  height: PLAYER_HEIGHT,
  radius: 0.35
};

// Basic FPS movement speed
const MOVE_SPEED = 6.0;
const MOVE_ACCELERATION = 34;
const AIR_ACCELERATION = 18;
const GROUND_DAMPING = 0.9;
const AIR_DAMPING = 0.96;
const COLLIDER_HEIGHT_EPSILON = 0.6;
const SPAWN_EDGE_PADDING = 4;
const SPAWN_RING_STEP = 6;
const SPAWN_SCAN_STEP = 8;
const SPAWN_CLEARANCE_STEP = 1.5;
const SPAWN_CLEARANCE_DISTANCE = 18;
const GROUND_PROBE_HEIGHT = 2;
const WORLD_GRAVITY = 9.8;
const JUMP_VELOCITY = 6.5;
const PLAYER_GROUND_CLEARANCE = 0.12;
const STEP_HEIGHT = 0.5;
const DEBUG_COLLISION_HELPERS = false;
const GRAVITY = 18.0;          // m/s² - slightly reduced for better feel

// Local player state
let localPlayer = null; // { id, username, position: THREE.Vector3, rotationY, health, score, lobby }

// Raycasting for shooting
const raycaster = new THREE.Raycaster();
const groundRaycaster = new THREE.Raycaster();
const DOWN_VECTOR = new THREE.Vector3(0, -1, 0);
const WORLD_UP = new THREE.Vector3(0, 1, 0);

// Networking timing
let lastMoveSend = 0;
const MOVE_SEND_RATE = 1 / 30; // seconds

// UI elements
const canvas = document.getElementById('game-canvas');
const hud = document.getElementById('hud');
const healthBarFill = document.getElementById('health-bar-fill');
const healthText = document.getElementById('health-text');
const scoreboardList = document.getElementById('scoreboard-list');
const killFeed = document.getElementById('kill-feed');
const hitMarker = document.getElementById('hit-marker');
const ammoText = document.getElementById('ammo-text');
const weaponName = document.getElementById('weapon-name');
const ammoContainer = document.getElementById('ammo-container');
const reloadIndicator = document.getElementById('reload-indicator');
const crosshair = document.getElementById('crosshair');
const weaponSlots = document.querySelectorAll('.weapon-slot');

// Remote players storage
const remotePlayers = new Map();

// Weapons
const WEAPONS = {
  rifle: {
    name: 'Rifle',
    damage: 25,
    fireRate: 0.12,
    spread: 0.015,
    recoil: 0.03,
    maxAmmo: 30,
    reloadTime: 1.6,
    gunModel: 'rifle'
  },
  sniper: {
    name: 'Sniper',
    damage: 70,
    fireRate: 1.0,
    spread: 0.002,
    recoil: 0.06,
    maxAmmo: 5,
    reloadTime: 2.4,
    gunModel: 'sniper'
  },
  pistol: {
    name: 'Pistol',
    damage: 20,
    fireRate: 0.35,
    spread: 0.01,
    recoil: 0.02,
    maxAmmo: 12,
    reloadTime: 1.2,
    gunModel: 'pistol'
  }
};

let currentWeaponKey = 'rifle';
let currentAmmo = WEAPONS.rifle.maxAmmo;
let currentGameMode = 'ffa'; // 'ffa' or 'tdm'
let lastPositionUpdate = 0;
const POSITION_UPDATE_INTERVAL = 50; // Send position updates every 50ms
let lastShotTime = 0;
let reloading = false;

// Visual FX
let muzzleLight = null;
let muzzleMesh = null;
const fxObjects = []; // { obj: THREE.Object3D, ttl: number }
let viewGun = null;
let gunBobT = 0;
let recoilKick = 0;
let weaponModels = {}; // Store different gun models
let gunArray = []; // Array to store all gun instances for switching

// Map collision entries: { box: THREE.Box3, mesh: THREE.Mesh }
const colliders = [];
const collisionHelpers = [];

// Ensure socket is created and networking handlers are wired
function ensureSocket() {
  if (!socket) {
    if (typeof io === 'undefined') {
      console.error('Socket.IO client (io) is not defined. Check script order.');
      return false;
    }
    socket = io();
    console.log('Socket created', socket ? 'OK' : 'FAILED');
    initNetworking();
  }
  return !!socket;
}

function getPlayerObject() {
  if (controls && typeof controls.getObject === 'function') {
    return controls.getObject();
  }
  return camera || null;
}

// Start game from ui.js
function startGame(username, lobby, gameMode = 'ffa') {
  console.log('=== STARTING GAME ===');
  console.log('Username:', username);
  console.log('Lobby:', lobby);
  console.log('Game Mode:', gameMode);
  
  currentGameMode = gameMode;
  
  // Update UI for game mode
  if (gameMode === 'tdm') {
    const teamIndicator = document.getElementById('team-indicator');
    const teamScores = document.getElementById('team-scores');
    if (teamIndicator) teamIndicator.classList.remove('hidden');
    if (teamScores) teamScores.classList.remove('hidden');
  }
  
  // We only need DOM tree, not a full window load event.
  if (document.readyState === 'loading') {
    console.log('DOM not ready, waiting for DOMContentLoaded...');
    document.addEventListener('DOMContentLoaded', () => {
      console.log('DOM ready, starting game...');
      startGameInternal(username, lobby, gameMode);
    }, { once: true });
    return true;
  } else {
    console.log('DOM ready, starting game immediately...');
    return startGameInternal(username, lobby, gameMode);
  }
}

function startGameInternal(username, lobby, gameMode) {
  try {
    // Initialize local player
    localPlayer = {
      id: null,
      username: username,
      position: playerBody.position.clone(),
      rotationY: 0,
      health: 100,
      score: 0,
      lobby: lobby
    };
    console.log('Local player initialized');
    
    // Initialize Three.js in correct order
    console.log('Step 1: Initializing Three.js...');
    const initialized = initThree();
    if (!initialized) {
      console.error('Three.js initialization aborted because dependencies are not ready.');
      return false;
    }
    
    console.log('Step 2: Initializing Input...');
    initInput();
    
    console.log('Step 3: Initializing Networking...');
    if (ensureSocket()) {
      socket.emit('joinGame', { username, lobby, gameMode });
    }
    
    console.log('Step 4: Starting animation loop...');
    if (!animationStarted) {
      animationStarted = true;
      animate();
    }
    
    console.log('✅ Game initialization complete');
    return true;
  } catch (error) {
    console.error('❌ Game initialization failed:', error);
    console.error('Error stack:', error.stack);
    
    // Try to provide more specific error info
    if (error.message.includes('THREE')) {
      console.error('Three.js library not loaded or incompatible');
    } else if (error.message.includes('canvas')) {
      console.error('Canvas element not found');
    } else if (error.message.includes('scene')) {
      console.error('Scene initialization failed');
    } else {
      console.error('Unknown error type');
    }
    return false;
  }
}

// Expose globally for ui.js
window.startGame = startGame;

function initThree() {
  console.log('=== INITIALIZING THREE.JS ===');

  try {
    if (threeReady && scene && camera && renderer) {
      return true;
    }

    if (typeof THREE === 'undefined') {
      console.error('THREE is not ready yet.');
      return false;
    }

    const gameCanvas = document.getElementById('game-canvas');
    if (!gameCanvas) {
      console.error('Canvas element #game-canvas is missing.');
      return false;
    }

    // Initialization order: scene -> camera -> renderer -> controls
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x87ceeb);

    camera = new THREE.PerspectiveCamera(
      75,
      window.innerWidth / window.innerHeight,
      0.1,
      1000
    );
    camera.position.set(0, 2, 5);
    camera.lookAt(0, 2, 0);
    playerBody.position.set(0, 2, 5);

    renderer = new THREE.WebGLRenderer({ canvas: gameCanvas, antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.outputEncoding = THREE.sRGBEncoding;
    renderer.physicallyCorrectLights = true;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1;

    clock = new THREE.Clock();
    currentGroundLevel = 2;

    const axesHelper = new THREE.AxesHelper(5);
    axesHelper.userData.ignoreBulletRaycast = true;
    scene.add(axesHelper);

    setupLighting();
    loadEnvironmentMap();
    loadAvailableMap();
    setupPointerLockControls();

    if (controls) controls.enabled = true;

    createFirstPersonGun();

    if (!resizeHandlerBound) {
      window.addEventListener('resize', () => {
        if (!camera || !renderer) return;
        camera.aspect = window.innerWidth / window.innerHeight;
        camera.updateProjectionMatrix();
        renderer.setSize(window.innerWidth, window.innerHeight);
      });
      resizeHandlerBound = true;
    }

    if (!scene || !camera || !renderer) {
      console.error('Critical Three.js components missing after init.');
      return false;
    }

    threeReady = true;
    console.log('Three.js initialized successfully');
    return true;
  } catch (error) {
    console.error('Three.js initialization error:', error);
    return false;
  }
}

function resolveAssetPath(assetPath) {
  if (!assetPath) return '';
  if (/^https?:\/\//i.test(assetPath)) {
    return assetPath;
  }
  return new URL(assetPath.replace(/^\//, ''), window.location.href).toString();
}

async function loadAvailableMap() {
  let mapPath = resolveAssetPath(DEFAULT_MAP_PATH);

  try {
    const response = await fetch(resolveAssetPath(MAPS_API_PATH), { cache: 'no-store' });
    if (response.ok) {
      const payload = await response.json();
      if (payload && Array.isArray(payload.maps) && payload.maps.length > 0) {
        mapPath = resolveAssetPath(`/maps/${payload.maps[0]}`);
      }
    }
  } catch (error) {
    console.warn('Failed to fetch map manifest, using default map path.', error);
  }

  loadMapWithFallback(mapPath);
}

function loadEnvironmentMap() {
  if (!scene) {
    return;
  }

  const fallbackSkybox = createProceduralSkybox();
  scene.background = fallbackSkybox;
  scene.environment = fallbackSkybox;

  if (typeof THREE.RGBELoader !== 'function' || !renderer) {
    return;
  }

  const pmremGenerator = new THREE.PMREMGenerator(renderer);
  pmremGenerator.compileEquirectangularShader();

  new THREE.RGBELoader().load(
    resolveAssetPath(ENVIRONMENT_MAP_PATH),
    (hdrTexture) => {
      const environmentMap = pmremGenerator.fromEquirectangular(hdrTexture).texture;
      hdrTexture.mapping = THREE.EquirectangularReflectionMapping;
      scene.environment = environmentMap;
      scene.background = hdrTexture;
      pmremGenerator.dispose();
      console.log('Environment HDR loaded:', ENVIRONMENT_MAP_PATH);
    },
    undefined,
    (error) => {
      console.warn('Environment HDR missing or failed to load, using color background.', error);
      pmremGenerator.dispose();
    }
  );
}

function enhanceTextureQuality(texture) {
  if (!texture || !renderer) return;

  texture.anisotropy = renderer.capabilities.getMaxAnisotropy();
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = true;
  texture.needsUpdate = true;
}

function ensureStandardMaterial(material) {
  if (!material) return material;
  if (material.isMeshStandardMaterial) {
    return material;
  }

  const standardMaterial = new THREE.MeshStandardMaterial({
    color: material.color ? material.color.clone() : new THREE.Color(0xffffff),
    map: material.map || null,
    normalMap: material.normalMap || null,
    roughnessMap: material.roughnessMap || null,
    metalnessMap: material.metalnessMap || null,
    roughness: typeof material.roughness === 'number' ? material.roughness : 0.9,
    metalness: typeof material.metalness === 'number' ? material.metalness : 0.1,
    emissive: material.emissive ? material.emissive.clone() : new THREE.Color(0x000000),
    emissiveMap: material.emissiveMap || null,
    emissiveIntensity: typeof material.emissiveIntensity === 'number' ? material.emissiveIntensity : 1,
    transparent: Boolean(material.transparent),
    opacity: typeof material.opacity === 'number' ? material.opacity : 1,
    side: material.side
  });

  return standardMaterial;
}

function optimizeMapMaterial(material) {
  if (!material) return material;

  const optimizedMaterial = ensureStandardMaterial(material);
  const textureKeys = [
    'map',
    'normalMap',
    'roughnessMap',
    'metalnessMap',
    'emissiveMap',
    'aoMap',
    'alphaMap'
  ];

  textureKeys.forEach((key) => {
    if (optimizedMaterial[key]) {
      enhanceTextureQuality(optimizedMaterial[key]);
    }
  });

  if (optimizedMaterial.map) {
    optimizedMaterial.map.encoding = THREE.sRGBEncoding;
  }
  if (optimizedMaterial.emissiveMap) {
    optimizedMaterial.emissiveMap.encoding = THREE.sRGBEncoding;
  }

  optimizedMaterial.polygonOffset = true;
  optimizedMaterial.polygonOffsetFactor = 1;
  optimizedMaterial.polygonOffsetUnits = 1;
  optimizedMaterial.envMapIntensity = typeof optimizedMaterial.envMapIntensity === 'number'
    ? optimizedMaterial.envMapIntensity
    : 1;
  optimizedMaterial.needsUpdate = true;
  return optimizedMaterial;
}

function loadMapWithFallback(mapPath) {
  if (!scene) return;
  colliders.length = 0;
  mapRaycastMeshes.length = 0;
  currentMapBounds = null;

  const safePath = typeof mapPath === 'string' ? mapPath.trim() : '';
  const isValidPath = safePath.length > 0 && /\.(glb|gltf)$/i.test(safePath);
  if (!isValidPath) {
    console.warn('Invalid map path:', mapPath);
    return;
  }

  if (!THREE.GLTFLoader) {
    console.warn('GLTFLoader not available. Using fallback procedural map.');
    return;
  }

  const loader = new THREE.GLTFLoader();
  ensureMapLoadingFallback();
  loader.load(
    safePath,
    (gltf) => {
      if (!gltf || !gltf.scene) {
        console.warn('Map file loaded but scene is empty.');
        ensureMapLoadingFallback();
        return;
      }

      if (currentMap) {
        scene.remove(currentMap);
      }

      currentMap = gltf.scene;
      currentMap.position.set(0, 0, 0);
      currentMap.traverse((child) => {
        if (child.isMesh) {
          child.castShadow = true;
          child.receiveShadow = true;
          if (child.material) {
            if (Array.isArray(child.material)) {
              child.material = child.material.map((material) => optimizeMapMaterial(material));
            } else {
              child.material = optimizeMapMaterial(child.material);
            }
          }
        }
      });

      fitLoadedMapToWorld(currentMap);
      scene.add(currentMap);
      currentMap.updateMatrixWorld(true);
      rebuildMapColliders(currentMap);
      placeLocalPlayerInOpenSpawn(pendingSpawnPosition || playerBody.position, Boolean(socket && localPlayer && localPlayer.id));
      removeMapLoadingFallback();
      console.log('Map loaded:', safePath);
    },
    (event) => {
      if (!event) return;
      if (event.lengthComputable) {
        const percent = (event.loaded / event.total) * 100;
        console.log(`Map loading: ${percent.toFixed(1)}%`);
      } else {
        console.log('Map loading in progress...' );
      }
    },
    (error) => {
      console.error('Error loading map:', safePath, error);
      ensureMapLoadingFallback();
    }
  );
}

function fitLoadedMapToWorld(mapRoot) {
  if (!mapRoot) return;

  mapRoot.scale.set(1, 1, 1);
  mapRoot.position.set(0, 0, 0);
  mapRoot.updateMatrixWorld(true);

  const bounds = new THREE.Box3().setFromObject(mapRoot);
  if (bounds.isEmpty()) {
    return;
  }

  const size = bounds.getSize(new THREE.Vector3());
  const center = bounds.getCenter(new THREE.Vector3());
  const maxDim = Math.max(size.x, size.y, size.z);

  if (maxDim > 0) {
    const targetWorldSize = 120;
    const scale = targetWorldSize / maxDim;
    mapRoot.scale.setScalar(scale);
    mapRoot.updateMatrixWorld(true);
  }

  let scaledBounds = new THREE.Box3().setFromObject(mapRoot);
  const scaledCenter = scaledBounds.getCenter(new THREE.Vector3());
  const scaledMin = scaledBounds.min.clone();

  // Recenter the imported map so existing spawn logic near origin stays valid.
  mapRoot.position.sub(new THREE.Vector3(scaledCenter.x, scaledMin.y, scaledCenter.z));
  mapRoot.updateMatrixWorld(true);

  scaledBounds = new THREE.Box3().setFromObject(mapRoot);
  currentMapBounds = scaledBounds.clone();
  const centeredSize = scaledBounds.getSize(new THREE.Vector3());
  const centeredCenter = scaledBounds.getCenter(new THREE.Vector3());
  currentMapCenter.copy(centeredCenter);
  const spawnDistance = Math.max(12, centeredSize.z * 0.25, centeredSize.x * 0.15);
  const spawn = new THREE.Vector3(0, scaledBounds.max.y + GROUND_PROBE_HEIGHT, spawnDistance);
  currentGroundLevel = Math.max(PLAYER_HEIGHT, scaledBounds.min.y + PLAYER_HEIGHT);

  setLocalPlayerPosition(spawn);
  camera.lookAt(centeredCenter.x, Math.max(PLAYER_HEIGHT, centeredCenter.y + PLAYER_HEIGHT * 0.5), centeredCenter.z);

  console.log('Map bounds center:', center);
  console.log('Map fitted size:', centeredSize);
}

function rebuildMapColliders(mapRoot) {
  colliders.length = 0;
  mapRaycastMeshes.length = 0;
  while (collisionHelpers.length > 0) {
    const helper = collisionHelpers.pop();
    scene?.remove(helper);
  }
  if (!mapRoot) return;

  const mapSize = currentMapBounds
    ? currentMapBounds.getSize(new THREE.Vector3())
    : null;

  mapRoot.traverse((child) => {
    if (!child.isMesh || child.visible === false) return;
    if (child.material && child.material.transparent && child.material.opacity <= 0.05) return;
    mapRaycastMeshes.push(child);

    const box = new THREE.Box3().setFromObject(child);
    if (box.isEmpty()) return;

    const size = box.getSize(new THREE.Vector3());
    const isWalkableSurface =
      size.y <= Math.max(COLLIDER_HEIGHT_EPSILON, PLAYER_HEIGHT * 0.4) &&
      size.x > playerBody.radius * 3 &&
      size.z > playerBody.radius * 3 &&
      box.max.y <= PLAYER_HEIGHT + 0.75;
    const isWorldSizedCollider = mapSize &&
      size.x >= mapSize.x * 0.65 &&
      size.z >= mapSize.z * 0.65;
    if (isWalkableSurface) {
      return;
    }
    if (isWorldSizedCollider) {
      return;
    }

    colliders.push({
      box,
      mesh: child
    });

    if (DEBUG_COLLISION_HELPERS) {
      const helper = new THREE.BoxHelper(child, 0x00ff88);
      helper.userData.ignoreBulletRaycast = true;
      collisionHelpers.push(helper);
      scene?.add(helper);
    }
  });

  console.log('Map colliders built:', colliders.length);
}

function collidesWithMap(position) {
  return !!findBlockingCollider(position);
}

function getFallbackGroundLevel() {
  return currentMapBounds ? currentMapBounds.min.y + PLAYER_HEIGHT : currentGroundLevel;
}

function findGroundHitAt(x, z) {
  if (!mapRaycastMeshes.length) {
    return null;
  }

  const rayOriginY = currentMapBounds
    ? currentMapBounds.max.y + GROUND_PROBE_HEIGHT + 6
    : Math.max(currentGroundLevel + 6, PLAYER_HEIGHT + 6);
  const rayOrigin = new THREE.Vector3(x, rayOriginY, z);
  const rayFar = currentMapBounds
    ? Math.max(20, rayOriginY - currentMapBounds.min.y + GROUND_PROBE_HEIGHT + 6)
    : 40;

  groundRaycaster.set(rayOrigin, DOWN_VECTOR);
  groundRaycaster.far = rayFar;

  const hits = groundRaycaster.intersectObjects(mapRaycastMeshes, false);
  for (const hit of hits) {
    if (!hit.face || !hit.object || hit.object.visible === false) {
      continue;
    }

    const worldNormal = hit.face.normal.clone().transformDirection(hit.object.matrixWorld);
    if (worldNormal.y > 0.2) {
      return hit;
    }
  }

  return null;
}

function getGroundLevelAt(x, z, fallbackY) {
  const groundHit = findGroundHitAt(x, z);
  if (groundHit) {
    return groundHit.point.y + PLAYER_HEIGHT;
  }

  if (Number.isFinite(fallbackY)) {
    return Math.max(getFallbackGroundLevel(), fallbackY);
  }

  return Math.max(getFallbackGroundLevel(), PLAYER_HEIGHT);
}

function getPlayerBoundsForPosition(position) {
  return new THREE.Box3(
    new THREE.Vector3(
      position.x - playerBody.radius,
      position.y - PLAYER_HEIGHT,
      position.z - playerBody.radius
    ),
    new THREE.Vector3(
      position.x + playerBody.radius,
      position.y,
      position.z + playerBody.radius
    )
  );
}

function getGroundLevelFromHit(hit) {
  return hit ? hit.point.y + PLAYER_HEIGHT : null;
}

function findBlockingCollider(position, options = {}) {
  if (!colliders.length) return null;

  const groundHit = options.groundHit || findGroundHitAt(position.x, position.z);
  const previousPosition = options.previousPosition || position;
  const playerFeetY = position.y - playerBody.height;
  const playerBounds = getPlayerBoundsForPosition(position);
  const groundLevel = getGroundLevelFromHit(groundHit);

  for (const collider of colliders) {
    if (!collider || !collider.box) continue;

    // More permissive ground clearance - allow smaller obstacles
    const enhancedGroundClearance = PLAYER_GROUND_CLEARANCE * 1.5;
    if (collider.box.max.y <= playerFeetY + enhancedGroundClearance) {
      continue;
    }

    // Allow ramp movement - check if it's a slope
    if (groundHit && previousPosition && collider.mesh === groundHit.object) {
      const slopeHeight = groundLevel - previousPosition.y;
      const enhancedStepHeight = STEP_HEIGHT * 1.6; // More permissive step height
      
      if (slopeHeight <= enhancedStepHeight + enhancedGroundClearance) {
        continue;
      }
    }

    // Only block if there's significant intersection
    if (collider.box.intersectsBox(playerBounds)) {
      const intersectionDepth = Math.min(
        collider.box.max.x - playerBounds.min.x,
        playerBounds.max.x - collider.box.min.x,
        collider.box.max.z - playerBounds.min.z,
        playerBounds.max.z - collider.box.min.z
      );
      
      // Allow minor intersections (less restrictive)
      if (intersectionDepth < 0.05) {
        continue;
      }
      
      return collider;
    }
  }

  return null;
}

function getMoveIntentDirection() {
  const inputDirection = new THREE.Vector3(
    (moveRight ? 1 : 0) - (moveLeft ? 1 : 0),
    0,
    (moveBackward ? 1 : 0) - (moveForward ? 1 : 0)
  );

  if (inputDirection.lengthSq() === 0) {
    return inputDirection;
  }

  inputDirection.normalize();

  const forward = new THREE.Vector3();
  camera.getWorldDirection(forward);
  forward.y = 0;
  if (forward.lengthSq() === 0) {
    forward.set(0, 0, -1);
  } else {
    forward.normalize();
  }

  const right = new THREE.Vector3().crossVectors(forward, WORLD_UP).normalize();
  const worldDirection = new THREE.Vector3();
  worldDirection.addScaledVector(forward, -inputDirection.z);
  worldDirection.addScaledVector(right, inputDirection.x);

  if (worldDirection.lengthSq() > 0) {
    worldDirection.normalize();
  }

  return worldDirection;
}

// Removed tryStepClimb - no longer needed for natural movement

function logCollisionDebug(message) {
  const now = performance.now();
  if (now - lastCollisionLogAt < 250) {
    return;
  }
  lastCollisionLogAt = now;
  console.debug(message);
}

function setLocalPlayerPosition(position) {
  if (!position) return;

  const targetPosition = position.clone();
  targetPosition.y = Number.isFinite(targetPosition.y)
    ? Math.max(targetPosition.y, PLAYER_HEIGHT)
    : Math.max(currentGroundLevel, PLAYER_HEIGHT);

  const playerObject = getPlayerObject();
  if (playerObject) {
    playerObject.position.copy(targetPosition);
  }

  if (!playerObject || camera.parent !== playerObject) {
    camera.position.copy(targetPosition);
  }

  currentGroundLevel = targetPosition.y;
  playerBody.position.copy(targetPosition);
  playerBody.velocity.y = 0;
  playerBody.isOnGround = true;
  if (localPlayer) {
    localPlayer.position.copy(targetPosition);
  }
}

function buildSpawnCandidatePositions(preferredPosition) {
  const candidates = [];
  const seen = new Set();

  const pushCandidate = (x, z) => {
    if (!Number.isFinite(x) || !Number.isFinite(z)) return;

    let clampedX = x;
    let clampedZ = z;
    if (currentMapBounds) {
      clampedX = Math.max(currentMapBounds.min.x + SPAWN_EDGE_PADDING, Math.min(currentMapBounds.max.x - SPAWN_EDGE_PADDING, clampedX));
      clampedZ = Math.max(currentMapBounds.min.z + SPAWN_EDGE_PADDING, Math.min(currentMapBounds.max.z - SPAWN_EDGE_PADDING, clampedZ));
    }

    const key = `${clampedX.toFixed(2)}:${clampedZ.toFixed(2)}`;
    if (seen.has(key)) return;
    seen.add(key);
    candidates.push(new THREE.Vector3(clampedX, PLAYER_HEIGHT, clampedZ));
  };

  const base = preferredPosition ? preferredPosition.clone() : currentMapCenter.clone();
  pushCandidate(base.x, base.z);

  const ringDirections = [
    new THREE.Vector2(1, 0),
    new THREE.Vector2(-1, 0),
    new THREE.Vector2(0, 1),
    new THREE.Vector2(0, -1),
    new THREE.Vector2(0.707, 0.707),
    new THREE.Vector2(-0.707, 0.707),
    new THREE.Vector2(0.707, -0.707),
    new THREE.Vector2(-0.707, -0.707)
  ];

  for (let distance = SPAWN_RING_STEP; distance <= SPAWN_CLEARANCE_DISTANCE; distance += SPAWN_RING_STEP) {
    ringDirections.forEach((direction) => {
      pushCandidate(base.x + direction.x * distance, base.z + direction.y * distance);
    });
  }

  if (!currentMapBounds) {
    return candidates;
  }

  const minX = currentMapBounds.min.x + SPAWN_EDGE_PADDING;
  const maxX = currentMapBounds.max.x - SPAWN_EDGE_PADDING;
  const minZ = currentMapBounds.min.z + SPAWN_EDGE_PADDING;
  const maxZ = currentMapBounds.max.z - SPAWN_EDGE_PADDING;

  pushCandidate(currentMapCenter.x, currentMapCenter.z);
  pushCandidate(minX, minZ);
  pushCandidate(minX, maxZ);
  pushCandidate(maxX, minZ);
  pushCandidate(maxX, maxZ);
  pushCandidate(minX, currentMapCenter.z);
  pushCandidate(maxX, currentMapCenter.z);
  pushCandidate(currentMapCenter.x, minZ);
  pushCandidate(currentMapCenter.x, maxZ);

  for (let x = minX; x <= maxX; x += SPAWN_SCAN_STEP) {
    for (let z = minZ; z <= maxZ; z += SPAWN_SCAN_STEP) {
      pushCandidate(x, z);
    }
  }

  return candidates;
}

function measureSpawnClearance(position, direction) {
  let clearance = 0;

  for (let distance = playerBody.radius * 2; distance <= SPAWN_CLEARANCE_DISTANCE; distance += SPAWN_CLEARANCE_STEP) {
    const probe = new THREE.Vector3(
      position.x + direction.x * distance,
      position.y,
      position.z + direction.y * distance
    );
    probe.y = getGroundLevelAt(probe.x, probe.z, position.y);

    if (collidesWithMap(probe)) {
      break;
    }

    clearance = distance;
  }

  return clearance;
}

function scoreSpawnCandidate(position) {
  if (!position) {
    return -Infinity;
  }

  const groundedPosition = position.clone();
  groundedPosition.y = getGroundLevelAt(groundedPosition.x, groundedPosition.z, position.y);

  if (collidesWithMap(groundedPosition)) {
    return -Infinity;
  }

  const directions = [
    new THREE.Vector2(1, 0),
    new THREE.Vector2(-1, 0),
    new THREE.Vector2(0, 1),
    new THREE.Vector2(0, -1),
    new THREE.Vector2(0.707, 0.707),
    new THREE.Vector2(-0.707, 0.707),
    new THREE.Vector2(0.707, -0.707),
    new THREE.Vector2(-0.707, -0.707)
  ];

  let totalClearance = 0;
  let minClearance = Infinity;
  let maxClearance = 0;

  directions.forEach((direction) => {
    const clearance = measureSpawnClearance(groundedPosition, direction);
    totalClearance += clearance;
    minClearance = Math.min(minClearance, clearance);
    maxClearance = Math.max(maxClearance, clearance);
  });

  const averageClearance = totalClearance / directions.length;
  if (averageClearance < 5 || maxClearance < 8 || minClearance < 1.5) {
    return -Infinity;
  }

  const distanceFromCenter = currentMapBounds
    ? groundedPosition.distanceTo(new THREE.Vector3(currentMapCenter.x, groundedPosition.y, currentMapCenter.z))
    : 0;

  return totalClearance + maxClearance * 2 + minClearance - distanceFromCenter * 0.05;
}

function findSafeSpawnPosition(preferredPosition) {
  const candidates = buildSpawnCandidatePositions(preferredPosition);
  let bestCandidate = null;
  let bestScore = -Infinity;

  candidates.forEach((candidate) => {
    const score = scoreSpawnCandidate(candidate);
    if (score > bestScore) {
      bestScore = score;
      bestCandidate = candidate.clone();
      bestCandidate.y = getGroundLevelAt(bestCandidate.x, bestCandidate.z, candidate.y);
    }
  });

  if (bestCandidate) {
    return bestCandidate.clone();
  }

  const fallback = preferredPosition ? preferredPosition.clone() : new THREE.Vector3(0, PLAYER_HEIGHT, 12);
  fallback.y = getGroundLevelAt(fallback.x, fallback.z, fallback.y);
  return fallback;
}

function syncSpawnToServer(position) {
  if (!socket || !localPlayer || !localPlayer.id || !position) return;

  // Rate limit position updates for better performance
  const now = Date.now();
  if (now - lastPositionUpdate < POSITION_UPDATE_INTERVAL) {
    return; // Skip update if too soon
  }
  
  lastPositionUpdate = now;

  socket.emit('playerMove', {
    x: position.x,
    y: position.y,
    z: position.z,
    rotation: localPlayer.rotationY
  });
}

function placeLocalPlayerInOpenSpawn(preferredPosition, syncWithServer) {
  const desiredPosition = preferredPosition
    ? preferredPosition.clone()
    : playerBody.position.clone();
  desiredPosition.y = Number.isFinite(desiredPosition.y)
    ? desiredPosition.y
    : Math.max(currentGroundLevel, PLAYER_HEIGHT);

  if (!currentMapBounds || !colliders.length || !mapRaycastMeshes.length) {
    pendingSpawnPosition = desiredPosition.clone();
    setLocalPlayerPosition(desiredPosition);
    return desiredPosition;
  }

  const safeSpawn = findSafeSpawnPosition(desiredPosition);
  pendingSpawnPosition = null;
  setLocalPlayerPosition(safeSpawn);

  if (syncWithServer) {
    syncSpawnToServer(safeSpawn);
  }

  return safeSpawn;
}

function ensureMapLoadingFallback() {
  if (!scene || loadingMapFallback) return;

  const fallback = new THREE.Group();
  const floorMaterial = new THREE.MeshStandardMaterial({
    color: 0x7aa36c,
    roughness: 0.95,
    metalness: 0.05
  });
  floorMaterial.polygonOffset = true;
  floorMaterial.polygonOffsetFactor = 1;
  floorMaterial.polygonOffsetUnits = 1;

  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(80, 80),
    floorMaterial
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.y -= 0.01;
  floor.receiveShadow = true;
  fallback.add(floor);

  const marker = new THREE.Mesh(
    new THREE.BoxGeometry(4, 4, 4),
    new THREE.MeshStandardMaterial({ color: 0x4f46e5, roughness: 0.4, metalness: 0.1 })
  );
  marker.position.set(0, 2, 0);
  marker.castShadow = true;
  fallback.add(marker);

  loadingMapFallback = fallback;
  scene.add(loadingMapFallback);
}

function removeMapLoadingFallback() {
  if (!scene || !loadingMapFallback) return;
  scene.remove(loadingMapFallback);
  loadingMapFallback.traverse((child) => {
    if (child.geometry) child.geometry.dispose?.();
    if (child.material) child.material.dispose?.();
  });
  loadingMapFallback = null;
}

function setupLighting() {
  console.log('=== SETTING UP LIGHTING ===');
  
  try {
    if (!scene) {
      throw new Error('Scene not initialized for lighting!');
    }
    
    // Bright ambient lighting for visibility
    const ambient = new THREE.AmbientLight(0xffffff, 0.45);
    scene.add(ambient);
    console.log('✅ Ambient light added');
    
    // Strong directional light
    const sun = new THREE.DirectionalLight(0xffffff, 1.2);
    sun.position.set(20, 30, 20);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.near = 1;
    sun.shadow.camera.far = 200;
    sun.shadow.camera.left = -50;
    sun.shadow.camera.right = 50;
    sun.shadow.camera.top = 50;
    sun.shadow.camera.bottom = -50;
    sun.shadow.bias = -0.0003;
    sun.shadow.normalBias = 0.02;
    scene.add(sun);
    console.log('✅ Directional light added');
    
    console.log('✅ Lighting setup complete');
    
  } catch (error) {
    console.error('❌ Lighting setup error:', error);
    // Keep running with fallback scene instead of aborting.
  }
}

function setupPointerLockControls() {
  console.log('=== SETTING UP POINTER LOCK ===');
  
  try {
    if (!camera || !scene || !renderer) {
      console.error('Controls setup skipped: scene/camera/renderer not ready.');
      return;
    }

    const ControlsCtor = window.PointerLockControls || THREE.PointerLockControls;
    if (typeof ControlsCtor !== 'function') {
      console.warn('PointerLockControls not found - using manual implementation');
      setupManualPointerLock();
      return;
    }

    const pointerTarget = renderer.domElement || document.body;
    controls = new ControlsCtor(camera, pointerTarget);
    const playerObject = getPlayerObject();
    if (playerObject) {
      playerObject.position.copy(playerBody.position);
      playerObject.position.y = Math.max(playerBody.position.y, PLAYER_HEIGHT);
    }

    if (controls.getObject && typeof controls.getObject === 'function') {
      const object = controls.getObject();
      if (object && !object.parent) {
        scene.add(object);
      }
    }

    if ('enabled' in controls) {
      controls.enabled = true;
    }

    controls.pointerSpeed = mouseSensitivity;
    controls.minPolarAngle = 0;
    controls.maxPolarAngle = Math.PI * 0.95;

    console.log('PointerLockControls initialized');

    const renderCanvas = renderer.domElement;
    if (renderCanvas) {
      renderCanvas.tabIndex = 1;
    }
    renderCanvas.addEventListener('click', () => {
      renderCanvas.focus();
      if (controls && !controls.isLocked && typeof controls.lock === 'function') {
        controls.lock();
      }
    });

    if (typeof controls.addEventListener === 'function') {
      controls.addEventListener('lock', () => {
        pointerLocked = true;
        if ('enabled' in controls) {
          controls.enabled = true;
        }
      });

      controls.addEventListener('unlock', () => {
        pointerLocked = false;
        resetMovementState();
      });
    }
  } catch (error) {
    console.error('Pointer lock setup error:', error);
    setupManualPointerLock();
  }
}

function setupManualPointerLock() {
  console.log('Setting up manual pointer lock...');
  
  if (!renderer || !renderer.domElement) return;
  const canvas = renderer.domElement;
  
  canvas.addEventListener('click', () => {
    if (!pointerLocked) {
      console.log('Requesting manual pointer lock...');
      canvas.requestPointerLock();
    }
  });

  document.addEventListener('pointerlockchange', () => {
    pointerLocked = document.pointerLockElement === canvas;
    console.log(pointerLocked ? 'Manual pointer locked' : 'Manual pointer unlocked');
  });

  // Manual mouse movement
  document.addEventListener('mousemove', (e) => {
    if (pointerLocked) {
      const movementX = e.movementX || e.mozMovementX || e.webkitMovementX || 0;
      const movementY = e.movementY || e.mozMovementY || e.webkitMovementY || 0;
      
      // Update yaw and pitch (FIXED: no inversion)
      yaw -= movementX * mouseSensitivity;
      pitch -= movementY * mouseSensitivity;
      
      // Clamp pitch to prevent over-rotation
      pitch = Math.max(-Math.PI/2 + 0.1, Math.min(Math.PI/2 - 0.1, pitch));
    }
  });
}

function createProceduralSkybox() {
  const size = 256;
  const faces = [];
  const colors = [
    ['#1a2336', '#0b1020'],
    ['#1a2336', '#0b1020'],
    ['#2a3550', '#0b1020'],
    ['#0b1020', '#05060a'],
    ['#1a2336', '#0b1020'],
    ['#1a2336', '#0b1020']
  ];

  for (let i = 0; i < 6; i++) {
    const c = document.createElement('canvas');
    c.width = size;
    c.height = size;
    const ctx = c.getContext('2d');
    const g = ctx.createLinearGradient(0, 0, 0, size);
    g.addColorStop(0, colors[i][0]);
    g.addColorStop(1, colors[i][1]);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);

    // light stars/noise
    ctx.fillStyle = 'rgba(255,255,255,0.08)';
    for (let s = 0; s < 110; s++) {
      const x = Math.random() * size;
      const y = Math.random() * size;
      const r = Math.random() * 1.4;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    }

    faces.push(c.toDataURL('image/png'));
  }

  const loader = new THREE.CubeTextureLoader();
  return loader.load(faces);
}
function createMap() {
  console.log('=== CREATING MAP ===');
  
  try {
    if (!scene) {
      throw new Error('Scene not initialized!');
    }
    console.log('✅ Scene exists for map creation');
    
    // Clear existing colliders
    colliders.length = 0;
    
    // LARGE FLOOR PLANE - very visible
    const groundGeo = new THREE.PlaneGeometry(200, 200);
    const groundMat = new THREE.MeshStandardMaterial({
      color: 0x90ee90, // Light green grass color
      roughness: 0.8,
      metalness: 0.1
    });
    const ground = new THREE.Mesh(groundGeo, groundMat);
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = 0;
    ground.receiveShadow = true;
    scene.add(ground);
    console.log('✅ Large green ground added to scene');
    
    // Wall material - bright red for visibility
    const wallMat = new THREE.MeshStandardMaterial({
      color: 0xff6b6b, // Bright red
      roughness: 0.7,
      metalness: 0.2
    });
    
    // Create very visible arena walls
    const wallHeight = 15;
    const wallThickness = 3;
    const arenaSize = 50;
    
    // North wall
    const northWall = new THREE.Mesh(
      new THREE.BoxGeometry(arenaSize * 2, wallHeight, wallThickness),
      wallMat
    );
    northWall.position.set(0, wallHeight / 2, -arenaSize);
    northWall.castShadow = true;
    northWall.receiveShadow = true;
    scene.add(northWall);
    colliders.push(new THREE.Box3().setFromObject(northWall));
    console.log('✅ North wall added');
    
    // South wall
    const southWall = new THREE.Mesh(
      new THREE.BoxGeometry(arenaSize * 2, wallHeight, wallThickness),
      wallMat
    );
    southWall.position.set(0, wallHeight / 2, arenaSize);
    southWall.castShadow = true;
    southWall.receiveShadow = true;
    scene.add(southWall);
    colliders.push(new THREE.Box3().setFromObject(southWall));
    console.log('✅ South wall added');
    
    // East wall
    const eastWall = new THREE.Mesh(
      new THREE.BoxGeometry(wallThickness, wallHeight, arenaSize * 2),
      wallMat
    );
    eastWall.position.set(arenaSize, wallHeight / 2, 0);
    eastWall.castShadow = true;
    eastWall.receiveShadow = true;
    scene.add(eastWall);
    colliders.push(new THREE.Box3().setFromObject(eastWall));
    console.log('✅ East wall added');
    
    // West wall
    const westWall = new THREE.Mesh(
      new THREE.BoxGeometry(wallThickness, wallHeight, arenaSize * 2),
      wallMat
    );
    westWall.position.set(-arenaSize, wallHeight / 2, 0);
    westWall.castShadow = true;
    westWall.receiveShadow = true;
    scene.add(westWall);
    colliders.push(new THREE.Box3().setFromObject(westWall));
    console.log('✅ West wall added');
    
    // Add some bright colored boxes for visibility
    const boxColors = [0xff0000, 0x00ff00, 0x0000ff, 0xffff00];
    const boxPositions = [
      { x: -20, z: -20, y: 2 },
      { x: 20, z: -20, y: 2 },
      { x: -20, z: 20, y: 2 },
      { x: 20, z: 20, y: 2 }
    ];
    
    boxPositions.forEach((pos, index) => {
      const boxMat = new THREE.MeshStandardMaterial({
        color: boxColors[index],
        roughness: 0.5,
        metalness: 0.3
      });
      
      const box = new THREE.Mesh(
        new THREE.BoxGeometry(8, 4, 8),
        boxMat
      );
      box.position.set(pos.x, pos.y, pos.z);
      box.castShadow = true;
      box.receiveShadow = true;
      scene.add(box);
      colliders.push(new THREE.Box3().setFromObject(box));
      console.log(`✅ Colored box ${index + 1} added at ${pos.x}, ${pos.y}, ${pos.z}`);
    });
    
    console.log('✅ Map created successfully');
    console.log('✅ Total objects in scene:', scene.children.length);
    
  } catch (error) {
    console.error('❌ Map creation error:', error);
    // Keep running with fallback scene instead of aborting.
  }
}

function createCanvasTexture(size, drawFn) {
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  const ctx = c.getContext('2d');
  drawFn(ctx, size);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

function createNormalFromHeight(size, heightData) {
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(size, size);

  function h(x, y) {
    x = (x + size) % size;
    y = (y + size) % size;
    return heightData[y * size + x];
  }

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const hl = h(x - 1, y);
      const hr = h(x + 1, y);
      const hd = h(x, y - 1);
      const hu = h(x, y + 1);

      const sx = (hl - hr) * 0.8;
      const sy = (hd - hu) * 0.8;

      const nx = sx;
      const ny = sy;
      const nz = 1.0;
      const len = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;

      const r = ((nx / len) * 0.5 + 0.5) * 255;
      const g = ((ny / len) * 0.5 + 0.5) * 255;
      const b = ((nz / len) * 0.5 + 0.5) * 255;

      const i = (y * size + x) * 4;
      img.data[i + 0] = r;
      img.data[i + 1] = g;
      img.data[i + 2] = b;
      img.data[i + 3] = 255;
    }
  }

  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.NoColorSpace;
  tex.anisotropy = 8;
  return tex;
}

function createStoneTextureSet() {
  const size = 256;
  const height = new Float32Array(size * size);

  const map = createCanvasTexture(size, (ctx, s) => {
    ctx.fillStyle = '#7b7f86';
    ctx.fillRect(0, 0, s, s);

    // tile pattern
    const tile = 32;
    for (let y = 0; y < s; y += tile) {
      for (let x = 0; x < s; x += tile) {
        const v = 115 + Math.random() * 30;
        ctx.fillStyle = `rgb(${v},${v + 4},${v + 10})`;
        ctx.fillRect(x, y, tile - 1, tile - 1);
      }
    }

    // noise + cracks
    ctx.strokeStyle = 'rgba(20,20,25,0.35)';
    ctx.lineWidth = 1;
    for (let i = 0; i < 40; i++) {
      ctx.beginPath();
      let px = Math.random() * s;
      let py = Math.random() * s;
      ctx.moveTo(px, py);
      for (let k = 0; k < 8; k++) {
        px += (Math.random() - 0.5) * 28;
        py += (Math.random() - 0.5) * 28;
        ctx.lineTo(px, py);
      }
      ctx.stroke();
    }

    // height data (simple noise)
    const img = ctx.getImageData(0, 0, s, s).data;
    for (let i = 0; i < height.length; i++) {
      height[i] = img[i * 4] / 255;
    }
  });

  const normalMap = createNormalFromHeight(size, height);
  return { map, normalMap };
}

function createBrickTextureSet() {
  const size = 256;
  const height = new Float32Array(size * size);

  const map = createCanvasTexture(size, (ctx, s) => {
    ctx.fillStyle = '#c9b79b';
    ctx.fillRect(0, 0, s, s);

    const brickW = 48;
    const brickH = 24;
    for (let y = 0; y < s; y += brickH) {
      const offset = (Math.floor(y / brickH) % 2) * (brickW / 2);
      for (let x = -offset; x < s; x += brickW) {
        const tint = 190 + Math.random() * 25;
        ctx.fillStyle = `rgb(${tint},${tint - 10},${tint - 30})`;
        ctx.fillRect(x + 1, y + 1, brickW - 2, brickH - 2);
      }
    }

    ctx.strokeStyle = 'rgba(60,50,40,0.35)';
    ctx.lineWidth = 2;
    for (let y = 0; y < s; y += brickH) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(s, y);
      ctx.stroke();
    }

    const img = ctx.getImageData(0, 0, s, s).data;
    for (let i = 0; i < height.length; i++) {
      height[i] = img[i * 4] / 255;
    }
  });

  const normalMap = createNormalFromHeight(size, height);
  return { map, normalMap };
}

function createWoodTextureSet() {
  const size = 256;
  const height = new Float32Array(size * size);

  const map = createCanvasTexture(size, (ctx, s) => {
    ctx.fillStyle = '#6b4a2b';
    ctx.fillRect(0, 0, s, s);

    for (let y = 0; y < s; y++) {
      const v = 80 + Math.sin(y * 0.15) * 18 + Math.random() * 10;
      ctx.fillStyle = `rgb(${v + 60},${v + 35},${v + 15})`;
      ctx.fillRect(0, y, s, 1);
    }

    ctx.strokeStyle = 'rgba(20,10,5,0.35)';
    ctx.lineWidth = 1;
    for (let i = 0; i < 18; i++) {
      ctx.beginPath();
      let px = Math.random() * s;
      let py = Math.random() * s;
      ctx.moveTo(px, py);
      for (let k = 0; k < 8; k++) {
        px += (Math.random() - 0.5) * 28;
        py += (Math.random() - 0.5) * 28;
        ctx.lineTo(px, py);
      }
      ctx.stroke();
    }

    const img = ctx.getImageData(0, 0, s, s).data;
    for (let i = 0; i < height.length; i++) {
      height[i] = img[i * 4] / 255;
    }
  });

  const normalMap = createNormalFromHeight(size, height);
  return { map, normalMap };
}

function resetMovementState() {
  moveForward = false;
  moveBackward = false;
  moveLeft = false;
  moveRight = false;
  jumpQueued = false;
  continuousFire = false;
  isShooting = false;
}

function setMovementKeyState(code, isPressed) {
  switch (code) {
    case 'KeyW':
      moveForward = isPressed;
      return true;
    case 'KeyS':
      moveBackward = isPressed;
      return true;
    case 'KeyA':
      moveLeft = isPressed;
      return true;
    case 'KeyD':
      moveRight = isPressed;
      return true;
    default:
      return false;
  }
}

function initInput() {
  console.log('=== INITIALIZING INPUT ===');
  
  try {
    if (inputInitialized) {
      return;
    }

    document.addEventListener('keydown', (e) => {
      if (e.code === 'Space') {
        if (!e.repeat) {
          jumpQueued = true;
        }
        e.preventDefault();
        return;
      }

      if (setMovementKeyState(e.code, true)) {
        e.preventDefault();
        return;
      }

      switch (e.code) {
        case 'Escape': 
          if (controls && controls.isLocked) {
            if (controls && typeof controls.unlock === 'function') {
              controls.unlock();
            } else {
              document.exitPointerLock();
            }
          }
          break;
        case 'KeyR': beginReload(); break;
        case 'Digit1': switchWeapon('rifle'); break;
        case 'Digit2': switchWeapon('sniper'); break;
        case 'Digit3': switchWeapon('pistol'); break;
      }
    });

    document.addEventListener('keyup', (e) => {
      if (e.code === 'Space') {
        e.preventDefault();
        return;
      }

      if (setMovementKeyState(e.code, false)) {
        e.preventDefault();
      }
    });

    window.addEventListener('blur', resetMovementState);
    
    document.addEventListener('mousedown', (e) => {
      if (!controls || !controls.isLocked) {
        return;
      }

      if (e.button === 0) {
        // Left click - start shooting
        isShooting = true;
        continuousFire = true;
        handleShoot(); // Initial shot
      } else if (e.button === 2) {
        // Right click - toggle aim mode
        isAiming = !isAiming;
        if (isAiming) {
          camera.fov = 50; // Zoom in for aiming
        } else {
          camera.fov = originalFov; // Normal view
        }
        camera.updateProjectionMatrix();
      }
    });

    document.addEventListener('mouseup', (e) => {
      if (e.button === 0) {
        // Left click release - stop shooting
        isShooting = false;
        continuousFire = false;
      }
    });

    document.addEventListener('contextmenu', (e) => {
      e.preventDefault();
    });

    inputInitialized = true;
    
    console.log('Input initialized successfully');
    
  } catch (error) {
    console.error('Input initialization error:', error);
  }
}

function initNetworking() {
  if (!socket) return;
  socket.on('connect', () => {
    console.log('Socket connected with id', socket.id);
  });

  socket.on('currentPlayers', payload => {
    console.log('Received currentPlayers', payload);

    // Set up local player
    localPlayer = {
      id: payload.me.id,
      username: payload.me.username,
      position: new THREE.Vector3(payload.me.x, payload.me.y, payload.me.z),
      rotationY: payload.me.rotation,
      health: payload.me.health,
      score: payload.me.score,
      kills: payload.me.kills || 0,
      deaths: payload.me.deaths || 0,
      lobby: payload.me.lobby,
      team: payload.me.team
    };

    placeLocalPlayerInOpenSpawn(
      new THREE.Vector3(payload.me.x, PLAYER_HEIGHT, payload.me.z),
      true
    );

    updateHealthUI(localPlayer.health);
    updateScoreboard();

    // Spawn existing others
    payload.others.forEach(p => {
      spawnRemotePlayer(p);
    });

    updateAmmoUI();
  });

  socket.on('playerJoined', player => {
    spawnRemotePlayer(player);
    addKillFeedMessage(`${player.username} joined the match`);
  });

  socket.on('playerMoved', data => {
    const entry = remotePlayers.get(data.id);
    if (!entry) return;
    entry.targetPosition.set(data.x, data.y, data.z);
    entry.rotationY = data.rotation;
    entry.lastUpdate = Date.now();
  });

  socket.on('playerHit', data => {
    if (localPlayer && data.targetId === localPlayer.id) {
      localPlayer.health = data.newHealth;
      updateHealthUI(localPlayer.health);
      showHitMarker();
      
      // Show headshot indicator
      if (data.isHeadshot) {
        addKillFeedMessage('HEADSHOT!', { color: '#ff6b6b', bold: true });
      }
    }
  });

  socket.on('playerDied', data => {
    const shooterName = getPlayerName(data.shooterId);
    const targetName = getPlayerName(data.targetId);
    
    let deathMessage = `${shooterName} eliminated ${targetName}`;
    if (data.isHeadshot) {
      deathMessage += ` (HEADSHOT)`;
    }
    
    addKillFeedMessage(deathMessage);
    
    if (localPlayer && data.shooterId === localPlayer.id) {
      localPlayer.score = data.shooterScore;
      localPlayer.kills = data.shooterKills;
      updateScoreboard();
    }
    
    if (localPlayer && data.targetId === localPlayer.id) {
      localPlayer.deaths = data.targetDeaths;
      updateScoreboard();
    }
  });

  socket.on('respawn', data => {
    if (!localPlayer) return;
    placeLocalPlayerInOpenSpawn(
      new THREE.Vector3(data.x, PLAYER_HEIGHT, data.z),
      true
    );
    localPlayer.health = data.health;
    updateHealthUI(localPlayer.health);
  });

  socket.on('playerDisconnected', data => {
    const entry = remotePlayers.get(data.id);
    if (entry) {
      scene.remove(entry.mesh);
      remotePlayers.delete(data.id);
    }
  });
}

function spawnRemotePlayer(p) {
  if (remotePlayers.has(p.id)) return;

  const group = new THREE.Group();
  group.userData.playerId = p.id;

  // Create more detailed player model with different colors
  const playerColor = getPlayerColor(p.id);
  
  // Body
  const bodyGeo = new THREE.BoxGeometry(0.6, 1.2, 0.4);
  const bodyMat = new THREE.MeshStandardMaterial({ 
    color: playerColor.body,
    roughness: 0.7,
    metalness: 0.1
  });
  const body = new THREE.Mesh(bodyGeo, bodyMat);
  body.position.y = 1.0;
  body.castShadow = true;
  group.add(body);

  // Head - named for headshot detection
  const headGeo = new THREE.SphereGeometry(0.3, 16, 16);
  const headMat = new THREE.MeshStandardMaterial({ 
    color: playerColor.head,
    roughness: 0.8,
    metalness: 0.05
  });
  const head = new THREE.Mesh(headGeo, headMat);
  head.position.y = 1.8;
  head.castShadow = true;
  head.name = 'head'; // Important for headshot detection
  group.add(head);
  
  // Arms
  const armGeo = new THREE.BoxGeometry(0.15, 0.8, 0.15);
  const armMat = new THREE.MeshStandardMaterial({ 
    color: playerColor.arms,
    roughness: 0.7,
    metalness: 0.1
  });
  
  const leftArm = new THREE.Mesh(armGeo, armMat);
  leftArm.position.set(-0.4, 1.0, 0);
  leftArm.castShadow = true;
  group.add(leftArm);
  
  const rightArm = new THREE.Mesh(armGeo, armMat);
  rightArm.position.set(0.4, 1.0, 0);
  rightArm.castShadow = true;
  group.add(rightArm);
  
  // Legs
  const legGeo = new THREE.BoxGeometry(0.2, 0.8, 0.2);
  const legMat = new THREE.MeshStandardMaterial({ 
    color: playerColor.legs,
    roughness: 0.8,
    metalness: 0.05
  });
  
  const leftLeg = new THREE.Mesh(legGeo, legMat);
  leftLeg.position.set(-0.15, 0.4, 0);
  leftLeg.castShadow = true;
  group.add(leftLeg);
  
  const rightLeg = new THREE.Mesh(legGeo, legMat);
  rightLeg.position.set(0.15, 0.4, 0);
  rightLeg.castShadow = true;
  group.add(rightLeg);

  // Weapon model for remote player
  const gunGeo = new THREE.BoxGeometry(0.5, 0.1, 0.2);
  const gunMat = new THREE.MeshStandardMaterial({ 
    color: 0x4a5568,
    roughness: 0.3,
    metalness: 0.8
  });
  const gun = new THREE.Mesh(gunGeo, gunMat);
  gun.position.set(0.4, 1.1, -0.1);
  gun.castShadow = true;
  group.add(gun);
  
  // Player name tag
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 64;
  const context = canvas.getContext('2d');
  context.fillStyle = 'rgba(0, 0, 0, 0.7)';
  context.fillRect(0, 0, 256, 64);
  context.fillStyle = '#ffffff';
  context.font = '24px Arial';
  context.textAlign = 'center';
  context.fillText(p.username || 'Player', 128, 40);
  
  const texture = new THREE.CanvasTexture(canvas);
  const spriteMaterial = new THREE.SpriteMaterial({ 
    map: texture, 
    transparent: true 
  });
  const sprite = new THREE.Sprite(spriteMaterial);
  sprite.position.set(0, 2.5, 0);
  sprite.scale.set(2, 1, 1);
  group.add(sprite);

  // Store player data for scoreboard
  const entry = {
    mesh: group,
    targetPosition: new THREE.Vector3(p.x, p.y, p.z),
    rotationY: p.rotation || 0,
    lastUpdate: Date.now(),
    playerData: p // Store full player data
  };

  group.position.copy(entry.targetPosition);
  scene.add(group);
  remotePlayers.set(p.id, entry);
}

function getPlayerColor(playerId) {
  // Generate consistent colors based on player ID
  const hash = playerId.split('').reduce((a, b) => {
    a = ((a << 5) - a) + b.charCodeAt(0);
    return a & a;
  }, 0);
  
  const hue = Math.abs(hash) % 360;
  const saturation = 40 + (Math.abs(hash >> 8) % 30);
  const lightness = 45 + (Math.abs(hash >> 16) % 20);
  
  return {
    body: `hsl(${hue}, ${saturation}%, ${lightness}%)`,
    head: `hsl(${(hue + 30) % 360}, ${saturation - 10}%, ${lightness + 10}%)`,
    arms: `hsl(${(hue + 60) % 360}, ${saturation}%, ${lightness - 5}%)`,
    legs: `hsl(${(hue + 90) % 360}, ${saturation - 5}%, ${lightness - 10}%)`
  };
}

function getPlayerName(id) {
  if (localPlayer && id === localPlayer.id) return localPlayer.username;
  const entry = remotePlayers.get(id);
  if (entry && entry.username) return entry.username;
  return 'Player';
}

function addKillFeedMessage(msg) {
  if (!killFeed) return;
  const div = document.createElement('div');
  div.textContent = msg;
  killFeed.prepend(div);
  while (killFeed.childElementCount > 6) {
    killFeed.removeChild(killFeed.lastChild);
  }
}

function updateHealthUI(health) {
  const clamped = Math.max(0, Math.min(100, health));
  const ratio = clamped / 100;
  if (healthBarFill) {
    healthBarFill.style.transform = `scaleX(${ratio})`;
  }
  if (healthText) {
    healthText.textContent = `${clamped}`;
  }
}

function updateScoreboard() {
  if (!scoreboardList) return;
  scoreboardList.innerHTML = '';
  if (!localPlayer) return;

  // Update team indicator
  if (currentGameMode === 'tdm' && localPlayer.team) {
    const teamText = document.getElementById('team-text');
    if (teamText) {
      teamText.textContent = localPlayer.team === 'teamA' ? 'Team A' : 'Team B';
      teamText.style.color = localPlayer.team === 'teamA' ? '#4CAF50' : '#2196F3';
    }
  }

  // Add local player to scoreboard
  const localRow = document.createElement('li');
  const localNameSpan = document.createElement('span');
  const localScoreSpan = document.createElement('span');
  const localHealthSpan = document.createElement('span');

  localNameSpan.className = 'name';
  localScoreSpan.className = 'score';
  localHealthSpan.className = 'health';

  localNameSpan.textContent = localPlayer.username;
  localScoreSpan.textContent = `${localPlayer.score} (K: ${localPlayer.kills || 0})`;
  localHealthSpan.textContent = localPlayer.health;

  localRow.appendChild(localNameSpan);
  localRow.appendChild(localScoreSpan);
  localRow.appendChild(localHealthSpan);
  scoreboardList.appendChild(localRow);

  // Add remote players to scoreboard
  remotePlayers.forEach((entry, playerId) => {
    const player = entry.playerData;
    if (!player) return;

    const row = document.createElement('li');
    const nameSpan = document.createElement('span');
    const scoreSpan = document.createElement('span');
    const healthSpan = document.createElement('span');

    nameSpan.className = 'name';
    scoreSpan.className = 'score';
    healthSpan.className = 'health';

    nameSpan.textContent = player.username;
    scoreSpan.textContent = `${player.score} (K: ${player.kills || 0})`;
    healthSpan.textContent = player.health;

    // Color code for teams in TDM
    if (currentGameMode === 'tdm' && player.team) {
      if (player.team === 'teamA') {
        nameSpan.style.color = '#4CAF50';
        scoreSpan.style.color = '#4CAF50';
      } else if (player.team === 'teamB') {
        nameSpan.style.color = '#2196F3';
        scoreSpan.style.color = '#2196F3';
      }
    }

    row.appendChild(nameSpan);
    row.appendChild(scoreSpan);
    row.appendChild(healthSpan);
    scoreboardList.appendChild(row);
  });

  // Update team scores in TDM
  if (currentGameMode === 'tdm') {
    const teamScoresDiv = document.getElementById('team-scores');
    const teamAScore = document.getElementById('team-a-score');
    const teamBScore = document.getElementById('team-b-score');
    
    if (teamScoresDiv && teamAScore && teamBScore) {
      let teamAKills = 0;
      let teamBKills = 0;
      
      // Count team kills
      remotePlayers.forEach((entry) => {
        const player = entry.playerData;
        if (player && player.team) {
          if (player.team === 'teamA') {
            teamAKills += player.kills || 0;
          } else if (player.team === 'teamB') {
            teamBKills += player.kills || 0;
          }
        }
      });
      
      // Add local player's kills
      if (localPlayer && localPlayer.team) {
        if (localPlayer.team === 'teamA') {
          teamAKills += localPlayer.kills || 0;
        } else if (localPlayer.team === 'teamB') {
          teamBKills += localPlayer.kills || 0;
        }
      }
      
      teamAScore.textContent = `Team A: ${teamAKills}`;
      teamBScore.textContent = `Team B: ${teamBKills}`;
    }
  }
}

function findRemotePlayerIdForObject(object) {
  let current = object;
  while (current) {
    if (current.userData && current.userData.playerId) {
      return current.userData.playerId;
    }
    current = current.parent;
  }
  return null;
}

function shouldIgnoreBulletHit(object) {
  let current = object;
  while (current) {
    if (current === camera || current === viewGun) {
      return true;
    }
    if (current.userData && current.userData.ignoreBulletRaycast) {
      return true;
    }
    current = current.parent;
  }
  return false;
}

function createBulletImpactEffect(intersection) {
  if (!scene || !intersection || !intersection.point) return;

  const impactGroup = new THREE.Group();
  impactGroup.userData.ignoreBulletRaycast = true;

  const normal = intersection.face
    ? intersection.face.normal.clone().transformDirection(intersection.object.matrixWorld).normalize()
    : raycaster.ray.direction.clone().negate().normalize();

  // Enhanced bullet hole with better visibility
  const bulletHole = new THREE.Mesh(
    new THREE.CircleGeometry(0.08, 16),
    new THREE.MeshBasicMaterial({
      color: 0x000000,
      transparent: true,
      opacity: 0.9,
      side: THREE.DoubleSide,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -4,
      polygonOffsetUnits: -4
    })
  );
  bulletHole.position.copy(intersection.point).addScaledVector(normal, 0.01);
  bulletHole.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), normal);
  impactGroup.add(bulletHole);

  // Larger and brighter hit flash
  const hitFlash = new THREE.Mesh(
    new THREE.SphereGeometry(0.06, 12, 12),
    new THREE.MeshBasicMaterial({ 
      color: 0xffaa33, 
      transparent: true, 
      opacity: 1.0,
      emissive: 0xff6600,
      emissiveIntensity: 0.5
    })
  );
  hitFlash.position.copy(intersection.point).addScaledVector(normal, 0.02);
  impactGroup.add(hitFlash);

  // Enhanced spark system with more particles
  const sparkMaterial = new THREE.LineBasicMaterial({
    color: 0xffd27a,
    transparent: true,
    opacity: 1.0
  });

  for (let i = 0; i < 8; i++) {
    const sparkDirection = normal.clone().add(new THREE.Vector3(
      (Math.random() - 0.5) * 0.8,
      Math.random() * 0.8,
      (Math.random() - 0.5) * 0.8
    )).normalize();
    const sparkEnd = intersection.point.clone().addScaledVector(sparkDirection, 0.3 + Math.random() * 0.2);
    const sparkGeometry = new THREE.BufferGeometry().setFromPoints([
      intersection.point.clone(),
      sparkEnd
    ]);
    const spark = new THREE.Line(sparkGeometry, sparkMaterial.clone());
    impactGroup.add(spark);
  }

  // Add smoke puff effect
  const smokePuff = new THREE.Mesh(
    new THREE.SphereGeometry(0.1, 8, 8),
    new THREE.MeshBasicMaterial({
      color: 0x888888,
      transparent: true,
      opacity: 0.3
    })
  );
  smokePuff.position.copy(intersection.point).addScaledVector(normal, 0.05);
  impactGroup.add(smokePuff);

  scene.add(impactGroup);
  fxObjects.push({ obj: impactGroup, ttl: 2.0, type: 'impact' });
}

function handleContinuousFire() {
  if (!isShooting || !continuousFire || !controls || !controls.isLocked) {
    return;
  }

  const weapon = WEAPONS[currentWeaponKey];
  const now = clock.getElapsedTime();
  
  // Check fire rate for continuous shooting (convert fireRate from seconds to milliseconds)
  const fireRateMs = weapon.fireRate * 1000;
  if (now - lastShotTime >= weapon.fireRate) {
    handleShoot();
  }
}

function handleShoot() {
  if (!localPlayer) return;
  if (reloading) return;

  const weapon = WEAPONS[currentWeaponKey];
  const now = clock.getElapsedTime();
  if (now - lastShotTime < weapon.fireRate) return;
  if (currentAmmo <= 0) {
    beginReload();
    return;
  }

  lastShotTime = now;
  currentAmmo -= 1;
  updateAmmoUI();

  // Recoil kick and muzzle flash FX
  recoilKick = Math.min(0.22, recoilKick + weapon.recoil);
  triggerMuzzleFlash();

  const origin = camera.position.clone();
  const directionVec = new THREE.Vector3(0, 0, -1);
  directionVec.applyEuler(camera.rotation);

  // Apply random spread
  directionVec.x += (Math.random() - 0.5) * weapon.spread;
  directionVec.y += (Math.random() - 0.5) * weapon.spread;
  directionVec.normalize();

  // Fix raycaster camera issue
  raycaster.set(origin, directionVec);
  raycaster.camera = camera;

  const intersections = raycaster
    .intersectObjects(scene.children, true)
    .filter((intersection) => !shouldIgnoreBulletHit(intersection.object));

  let hitPlayerId = null;
  let worldHit = null;
  let hitLocation = null;

  for (const intersection of intersections) {
    const playerId = findRemotePlayerIdForObject(intersection.object);
    if (playerId && remotePlayers.has(playerId)) {
      hitPlayerId = playerId;
      worldHit = intersection;
      // Determine hit location based on object name
      if (intersection.object.name === 'head') {
        hitLocation = 'head';
      } else {
        hitLocation = 'body';
      }
      break;
    }

    if (!worldHit) {
      worldHit = intersection;
    }
  }

  if (hitPlayerId) {
    // Send hit data to server with location
    socket.emit('playerShot', { 
      targetId: hitPlayerId, 
      weaponKey: currentWeaponKey,
      hitLocation: hitLocation
    });
    showHitMarker();
  } else if (worldHit) {
    createBulletImpactEffect(worldHit);
    createSimpleHitMarker(worldHit.point);
  }

  spawnTracer(origin, directionVec, worldHit ? worldHit.point : null);
}

function createSimpleHitMarker(hitPoint) {
  // Simple red sphere hit marker
  const hitMarker = new THREE.Mesh(
    new THREE.SphereGeometry(0.05, 8, 8),
    new THREE.MeshBasicMaterial({ 
      color: 0xff0000,
      transparent: true,
      opacity: 0.8
    })
  );
  hitMarker.position.copy(hitPoint);
  scene.add(hitMarker);
  
  // Remove after 2 seconds
  setTimeout(() => {
    scene.remove(hitMarker);
  }, 2000);
}

function updatePlayerMovement(deltaTime) {
  try {
    const playerObject = getPlayerObject();
    if (!playerObject) return;

    // Store previous position for safety collision
    const previousPosition = playerObject.position.clone();
    
    // Get movement input
    const intentDirection = controls && controls.isLocked
      ? getMoveIntentDirection()
      : new THREE.Vector3();
    const moving = intentDirection.lengthSq() > 0;

    // Apply horizontal movement (X and Z only)
    const acceleration = playerBody.isOnGround ? MOVE_ACCELERATION : AIR_ACCELERATION;
    if (moving) {
      playerBody.velocity.x += intentDirection.x * acceleration * deltaTime;
      playerBody.velocity.z += intentDirection.z * acceleration * deltaTime;
    }

    // Apply damping
    playerBody.velocity.x *= playerBody.isOnGround ? GROUND_DAMPING : AIR_DAMPING;
    playerBody.velocity.z *= playerBody.isOnGround ? GROUND_DAMPING : AIR_DAMPING;

    // Limit speed
    const horizontalSpeed = Math.hypot(playerBody.velocity.x, playerBody.velocity.z);
    if (horizontalSpeed > MOVE_SPEED) {
      const horizontalScale = MOVE_SPEED / horizontalSpeed;
      playerBody.velocity.x *= horizontalScale;
      playerBody.velocity.z *= horizontalScale;
    }

    // ALWAYS allow horizontal movement - no blocking
    playerObject.position.x += playerBody.velocity.x * deltaTime;
    playerObject.position.z += playerBody.velocity.z * deltaTime;

    // Handle jumping
    if (jumpQueued) {
      if (controls && controls.isLocked && playerBody.isOnGround) {
        playerBody.velocity.y = JUMP_VELOCITY;
        playerBody.isOnGround = false;
      }
      jumpQueued = false;
    }

    // Y-axis movement: GRAVITY ONLY
    playerBody.velocity.y -= WORLD_GRAVITY * deltaTime;
    playerObject.position.y += playerBody.velocity.y * deltaTime;

    // Find ground level
    const groundHit = findGroundHitAt(playerObject.position.x, playerObject.position.z);
    const groundLevel = groundHit
      ? getGroundLevelFromHit(groundHit)
      : getGroundLevelAt(
          playerObject.position.x,
          playerObject.position.z,
          currentGroundLevel
        );

    // Ground collision
    if (playerObject.position.y < groundLevel) {
      playerBody.velocity.y = 0;
      playerObject.position.y = groundLevel;
      playerBody.isOnGround = true;
    } else {
      playerBody.isOnGround = false;
    }

    // SAFETY COLLISION: Only revert if DEEPLY inside solid object
    if (isPlayerDeeplyInsideSolid(playerObject)) {
      // Revert to previous position to prevent getting stuck
      playerObject.position.copy(previousPosition);
      playerBody.velocity.x = 0;
      playerBody.velocity.z = 0;
      console.log('Player was inside solid object - reverted to safe position');
    }

    // Update camera and player body
    camera.position.copy(playerObject.position);
    playerBody.position.copy(playerObject.position);
    if (localPlayer) {
      localPlayer.position.copy(playerObject.position);
    }

    yaw = camera.rotation.y;
  } catch (error) {
    console.error('Movement update error:', error);
  }
}

// Simple safety check - only block if player is DEEPLY inside solid geometry
function isPlayerDeeplyInsideSolid(playerObject) {
  if (!colliders.length) return false;
  
  const playerBounds = getPlayerBoundsForPosition(playerObject);
  const playerFeetY = playerObject.position.y - playerBody.height;
  
  for (const collider of colliders) {
    if (!collider || !collider.box) continue;
    
    // Only check if player is significantly inside the object
    if (collider.box.intersectsBox(playerBounds)) {
      // Calculate how deep the intersection is
      const intersectionDepth = Math.min(
        collider.box.max.x - playerBounds.min.x,
        playerBounds.max.x - collider.box.min.x,
        collider.box.max.z - playerBounds.min.z,
        playerBounds.max.z - collider.box.min.z
      );
      
      // Only block if DEEPLY inside (more than 0.2 units)
      if (intersectionDepth > 0.2) {
        // Also check if player is below the top of the object
        if (collider.box.max.y > playerFeetY) {
          return true;
        }
      }
    }
  }
  
  return false;
}

function updatePlayerPhysics(deltaTime) {
  return updatePlayerMovement(deltaTime);
  try {
    // Get camera direction vectors for proper FPS movement
    const forward = new THREE.Vector3();
    camera.getWorldDirection(forward);
    forward.y = 0; // Keep movement on horizontal plane
    forward.normalize();
    
    const right = new THREE.Vector3();
    right.crossVectors(camera.up, forward).normalize();
    
    // Calculate movement direction relative to camera
    let moveVector = new THREE.Vector3();
    
    // W → move along forward vector
    if (moveState.forward) {
      moveVector.add(forward.clone().multiplyScalar(1));
    }
    
    // S → move opposite forward
    if (moveState.backward) {
      moveVector.add(forward.clone().multiplyScalar(-1));
    }
    
    // A → move along right vector (strafe left)
    if (moveState.left) {
      moveVector.add(right.clone().multiplyScalar(-1));
    }
    
    // D → move opposite right (strafe right)
    if (moveState.right) {
      moveVector.add(right.clone().multiplyScalar(1));
    }
    
    // Normalize movement vector for consistent speed in all directions
    if (moveVector.length() > 0) {
      moveVector.normalize();
    }
    
    // Apply movement speed with sprint modifier
    const currentSpeed = moveState.sprint ? SPRINT_SPEED : MOVE_SPEED;
    const targetVelocity = moveVector.multiplyScalar(currentSpeed);
    
    // Apply air control if not on ground
    if (!playerBody.isOnGround) {
      targetVelocity.multiplyScalar(AIR_CONTROL);
    }
    
    // Smooth acceleration using delta time
    const accelerationFactor = 15.0;
    playerBody.velocity.x += (targetVelocity.x - playerBody.velocity.x) * accelerationFactor * deltaTime;
    playerBody.velocity.z += (targetVelocity.z - playerBody.velocity.z) * accelerationFactor * deltaTime;
    
    // Apply friction when on ground
    if (playerBody.isOnGround) {
      const frictionFactor = Math.pow(FRICTION, deltaTime);
      playerBody.velocity.x *= frictionFactor;
      playerBody.velocity.z *= frictionFactor;
    }
    
    // Handle jumping with improved mechanics
    if (moveState.jump && playerBody.isOnGround) {
      playerBody.velocity.y = JUMP_FORCE;
      playerBody.isOnGround = false;
    }
    
    // Apply gravity
    playerBody.velocity.y -= GRAVITY * deltaTime;
    
    // Update position using velocity and delta time
    const newPosition = playerBody.position.clone();
    newPosition.x += playerBody.velocity.x * deltaTime;
    newPosition.y += playerBody.velocity.y * deltaTime;
    newPosition.z += playerBody.velocity.z * deltaTime;
    
    // Improved ground collision
    if (newPosition.y <= playerBody.height) {
      newPosition.y = playerBody.height;
      playerBody.velocity.y = 0;
      playerBody.isOnGround = true;
    }
    
    // Simple wall collision (prevent going outside bounds)
    const bounds = 45;
    newPosition.x = Math.max(-bounds, Math.min(bounds, newPosition.x));
    newPosition.z = Math.max(-bounds, Math.min(bounds, newPosition.z));
    
    // Update player position
    playerBody.position.copy(newPosition);
    
    // Update camera position and rotation
    if (controls && pointerLocked && typeof controls.getObject === 'function') {
      const controlsObject = controls.getObject();
      if (controlsObject) {
        camera.position.copy(controlsObject.position);
        camera.rotation.copy(controlsObject.rotation);
      }
    } else {
      camera.position.lerp(playerBody.position, 0.1);
      camera.rotation.order = 'YXZ';
      camera.rotation.y = yaw;
      camera.rotation.x = pitch;
    }
    
  } catch (error) {
    console.error('Physics update error:', error);
  }
}

function switchWeaponModel(weaponKey) {
  // Remove current gun if exists
  if (viewGun) {
    camera.remove(viewGun);
  }
  
  // Add new weapon model
  const newGunModel = weaponModels[weaponKey];
  if (!newGunModel) return;
  
  viewGun = newGunModel.clone();
  
  // Position based on weapon type - adjusted for better visibility
  switch(weaponKey) {
    case 'rifle':
      viewGun.position.set(0.4, -0.3, -0.8);
      viewGun.rotation.set(0.05, -0.1, 0);
      break;
    case 'sniper':
      viewGun.position.set(0.35, -0.25, -0.9);
      viewGun.rotation.set(0.03, -0.08, 0);
      break;
    case 'pistol':
      viewGun.position.set(0.45, -0.35, -0.7);
      viewGun.rotation.set(0.08, -0.12, 0);
      break;
  }
  
  camera.add(viewGun);
  
  // Add muzzle flash to new gun
  muzzleLight = new THREE.PointLight(0xffaa00, 0, 8, 2.5);
  
  // Position muzzle light based on weapon type
  switch(weaponKey) {
    case 'rifle':
      muzzleLight.position.set(0.08, 0.03, -1.0);
      break;
    case 'sniper':
      muzzleLight.position.set(0.0, 0.0, -1.3);
      break;
    case 'pistol':
      muzzleLight.position.set(0.0, 0.0, -0.7);
      break;
  }
  
  viewGun.add(muzzleLight);

  const flashMat = new THREE.MeshStandardMaterial({
    color: 0xffcc00,
    emissive: 0xff9900,
    emissiveIntensity: 3,
    transparent: true,
    opacity: 0
  });
  muzzleMesh = new THREE.Mesh(new THREE.ConeGeometry(0.08, 0.15, 6), flashMat);
  muzzleMesh.rotation.x = Math.PI / 2;
  muzzleMesh.position.copy(muzzleLight.position);
  viewGun.add(muzzleMesh);
  
  console.log(`Switched to ${weaponKey} weapon`);
}

function switchWeapon(key) {
  if (!WEAPONS[key] || currentWeaponKey === key) return;
  
  currentWeaponKey = key;
  currentAmmo = WEAPONS[key].maxAmmo;
  reloading = false;
  
  // Hide all guns
  Object.values(gunArray).forEach(gun => {
    if (gun) gun.visible = false;
  });
  
  // Show selected gun
  if (gunArray[key]) {
    gunArray[key].visible = true;
    viewGun = gunArray[key];
    
    // Move muzzle flash to new gun
    if (muzzleLight && muzzleMesh) {
      viewGun.add(muzzleLight);
      viewGun.add(muzzleMesh);
    }
  }
  
  // Update weapon slot UI
  weaponSlots.forEach(slot => {
    slot.classList.remove('active');
    if (slot.dataset.weapon === key) {
      slot.classList.add('active');
    }
  });
  
  updateAmmoUI();
  console.log(`Switched to ${key} weapon`);
}

function beginReload() {
  if (reloading) return;
  const weapon = WEAPONS[currentWeaponKey];
  reloading = true;
  updateAmmoUI();
  
  setTimeout(() => {
    currentAmmo = weapon.maxAmmo;
    reloading = false;
    updateAmmoUI();
  }, weapon.reloadTime * 1000);
}

function createWeaponModels() {
  // Create different gun models for each weapon type
  
  // Rifle model (default)
  weaponModels.rifle = createRifleModel();
  
  // Sniper model
  weaponModels.sniper = createSniperModel();
  
  // Pistol model
  weaponModels.pistol = createPistolModel();
}

function createRifleModel() {
  const gunGroup = new THREE.Group();

  const metalMat = new THREE.MeshStandardMaterial({
    color: 0x2c3e50,
    roughness: 0.2,
    metalness: 0.8
  });
  const darkMetalMat = new THREE.MeshStandardMaterial({
    color: 0x1a252f,
    roughness: 0.3,
    metalness: 0.9
  });
  const gripMat = new THREE.MeshStandardMaterial({
    color: 0x0f1419,
    roughness: 0.9,
    metalness: 0.1
  });
  const sightMat = new THREE.MeshStandardMaterial({
    color: 0x1a1a1a,
    roughness: 0.1,
    metalness: 0.95
  });

  // Main receiver body - made larger for visibility
  const receiver = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.2, 0.8), metalMat);
  receiver.position.set(0.0, 0.0, -0.1);
  gunGroup.add(receiver);

  // Pistol grip
  const grip = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.3, 0.2), gripMat);
  grip.position.set(-0.08, -0.25, 0.15);
  grip.rotation.z = 0.1;
  gunGroup.add(grip);

  // Barrel - made longer and thicker for visibility
  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.8, 12), darkMetalMat);
  barrel.rotation.x = Math.PI / 2;
  barrel.position.set(0.08, 0.03, -0.8);
  gunGroup.add(barrel);

  // Muzzle brake
  const muzzleBrake = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.05, 0.1, 8), darkMetalMat);
  muzzleBrake.rotation.x = Math.PI / 2;
  muzzleBrake.position.set(0.08, 0.03, -1.1);
  gunGroup.add(muzzleBrake);

  // Iron sights
  const rearSight = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.03, 0.02), sightMat);
  rearSight.position.set(-0.05, 0.1, -0.15);
  gunGroup.add(rearSight);

  const frontSight = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.06, 0.02), sightMat);
  frontSight.position.set(0.08, 0.08, -0.8);
  gunGroup.add(frontSight);

  // Magazine
  const magazine = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.15, 0.04), darkMetalMat);
  magazine.position.set(0.0, -0.1, 0.3);
  gunGroup.add(magazine);

  // Charging handle
  const chargingHandle = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.02, 0.03), metalMat);
  chargingHandle.position.set(0.0, 0.1, -0.4);
  gunGroup.add(chargingHandle);

  return gunGroup;
}

function createSniperModel() {
  const gunGroup = new THREE.Group();

  const metalMat = new THREE.MeshStandardMaterial({
    color: 0x1a1a1a,
    roughness: 0.15,
    metalness: 0.85
  });
  const darkMetalMat = new THREE.MeshStandardMaterial({
    color: 0x0d0d0d,
    roughness: 0.2,
    metalness: 0.9
  });
  const gripMat = new THREE.MeshStandardMaterial({
    color: 0x2a2a2a,
    roughness: 0.8,
    metalness: 0.2
  });

  // Long barrel
  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 1.2, 16), darkMetalMat);
  barrel.rotation.x = Math.PI / 2;
  barrel.position.set(0.0, 0.0, -0.6);
  gunGroup.add(barrel);

  // Receiver body
  const receiver = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.12, 0.4), metalMat);
  receiver.position.set(0.0, 0.0, 0.2);
  gunGroup.add(receiver);

  // Sniper scope
  const scope = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.4, 12), metalMat);
  scope.rotation.z = Math.PI / 2;
  scope.position.set(0.0, 0.15, 0.1);
  gunGroup.add(scope);

  // Scope lenses
  const lensMat = new THREE.MeshStandardMaterial({
    color: 0x000033,
    roughness: 0.0,
    metalness: 0.1,
    transparent: true,
    opacity: 0.8
  });
  
  const frontLens = new THREE.Mesh(new THREE.CircleGeometry(0.05, 16), lensMat);
  frontLens.position.set(-0.2, 0.15, 0.1);
  frontLens.rotation.y = Math.PI / 2;
  gunGroup.add(frontLens);
  
  const rearLens = new THREE.Mesh(new THREE.CircleGeometry(0.05, 16), lensMat);
  rearLens.position.set(0.2, 0.15, 0.1);
  rearLens.rotation.y = Math.PI / 2;
  gunGroup.add(rearLens);

  // Bipod
  const bipodLeft = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.15, 0.02), darkMetalMat);
  bipodLeft.position.set(-0.08, -0.08, -0.8);
  bipodLeft.rotation.z = 0.3;
  gunGroup.add(bipodLeft);
  
  const bipodRight = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.15, 0.02), darkMetalMat);
  bipodRight.position.set(0.08, -0.08, -0.8);
  bipodRight.rotation.z = -0.3;
  gunGroup.add(bipodRight);

  // Stock
  const stock = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.08, 0.4), gripMat);
  stock.position.set(0.0, -0.05, 0.6);
  gunGroup.add(stock);

  return gunGroup;
}

function createPistolModel() {
  const gunGroup = new THREE.Group();

  const metalMat = new THREE.MeshStandardMaterial({
    color: 0x4a4a4a,
    roughness: 0.3,
    metalness: 0.7
  });
  const gripMat = new THREE.MeshStandardMaterial({
    color: 0x1a1a1a,
    roughness: 0.9,
    metalness: 0.1
  });

  // Slide - made larger for visibility
  const slide = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.15, 0.3), metalMat);
  slide.position.set(0.0, 0.05, -0.05);
  gunGroup.add(slide);

  // Frame - made larger
  const frame = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.2, 0.2), metalMat);
  frame.position.set(0.0, -0.02, 0.05);
  gunGroup.add(frame);

  // Barrel - made thicker
  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.25, 8), metalMat);
  barrel.rotation.x = Math.PI / 2;
  barrel.position.set(0.0, 0.0, -0.25);
  gunGroup.add(barrel);

  // Grip - made larger
  const grip = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.22, 0.1), gripMat);
  grip.position.set(0.0, -0.18, 0.08);
  gunGroup.add(grip);

  // Trigger guard
  const triggerGuard = new THREE.Mesh(new THREE.TorusGeometry(0.05, 0.008, 4, 8), metalMat);
  triggerGuard.position.set(0.0, -0.08, 0.05);
  triggerGuard.rotation.x = Math.PI / 2;
  gunGroup.add(triggerGuard);

  // Sights - made larger
  const rearSight = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.02, 0.008), metalMat);
  rearSight.position.set(0.0, 0.12, -0.1);
  gunGroup.add(rearSight);

  const frontSight = new THREE.Mesh(new THREE.BoxGeometry(0.008, 0.04, 0.008), metalMat);
  frontSight.position.set(0.0, 0.1, -0.25);
  gunGroup.add(frontSight);

  return gunGroup;
}

function createGunModel(weaponKey) {
  const weapon = WEAPONS[weaponKey];
  const gunGroup = new THREE.Group();
  
  // Gun materials
  const gunMat = new THREE.MeshStandardMaterial({ 
    color: 0x2c3e50,
    roughness: 0.3,
    metalness: 0.7
  });
  
  const darkMat = new THREE.MeshStandardMaterial({ 
    color: 0x1a1a1a,
    roughness: 0.4,
    metalness: 0.8
  });
  
  // Create different gun shapes based on weapon type
  if (weaponKey === 'rifle') {
    // Rifle - longer barrel, larger body
    const gunBody = new THREE.Mesh(
      new THREE.BoxGeometry(0.4, 0.15, 0.8),
      gunMat
    );
    gunBody.position.set(0, 0, 0);
    gunGroup.add(gunBody);
    
    const barrel = new THREE.Mesh(
      new THREE.CylinderGeometry(0.05, 0.05, 1.2, 12),
      darkMat
    );
    barrel.rotation.x = Math.PI / 2;
    barrel.position.set(0, 0.05, -0.8);
    gunGroup.add(barrel);
    
    const grip = new THREE.Mesh(
      new THREE.BoxGeometry(0.1, 0.25, 0.15),
      new THREE.MeshStandardMaterial({ color: 0x0f1419, roughness: 0.9 })
    );
    grip.position.set(-0.08, -0.2, 0.2);
    gunGroup.add(grip);
    
    const magazine = new THREE.Mesh(
      new THREE.BoxGeometry(0.08, 0.15, 0.04),
      darkMat
    );
    magazine.position.set(0, -0.08, 0.25);
    gunGroup.add(magazine);
    
  } else if (weaponKey === 'sniper') {
    // Sniper - very long barrel, scope, slimmer body
    const gunBody = new THREE.Mesh(
      new THREE.BoxGeometry(0.3, 0.12, 0.6),
      gunMat
    );
    gunBody.position.set(0, 0, 0);
    gunGroup.add(gunBody);
    
    const barrel = new THREE.Mesh(
      new THREE.CylinderGeometry(0.04, 0.04, 2.0, 12),
      darkMat
    );
    barrel.rotation.x = Math.PI / 2;
    barrel.position.set(0, 0.04, -1.0);
    gunGroup.add(barrel);
    
    // Scope
    const scope = new THREE.Mesh(
      new THREE.CylinderGeometry(0.06, 0.06, 0.4, 12),
      new THREE.MeshStandardMaterial({ color: 0x222222, roughness: 0.2, metalness: 0.9 })
    );
    scope.rotation.z = Math.PI / 2;
    scope.position.set(0, 0.15, -0.2);
    gunGroup.add(scope);
    
    const grip = new THREE.Mesh(
      new THREE.BoxGeometry(0.08, 0.3, 0.12),
      new THREE.MeshStandardMaterial({ color: 0x0f1419, roughness: 0.9 })
    );
    grip.position.set(-0.06, -0.25, 0.15);
    gunGroup.add(grip);
    
  } else if (weaponKey === 'pistol') {
    // Pistol - short barrel, compact body
    const gunBody = new THREE.Mesh(
      new THREE.BoxGeometry(0.25, 0.12, 0.4),
      gunMat
    );
    gunBody.position.set(0, 0, 0);
    gunGroup.add(gunBody);
    
    const barrel = new THREE.Mesh(
      new THREE.CylinderGeometry(0.03, 0.03, 0.5, 8),
      darkMat
    );
    barrel.rotation.x = Math.PI / 2;
    barrel.position.set(0, 0.03, -0.3);
    gunGroup.add(barrel);
    
    const grip = new THREE.Mesh(
      new THREE.BoxGeometry(0.06, 0.18, 0.1),
      new THREE.MeshStandardMaterial({ color: 0x0f1419, roughness: 0.9 })
    );
    grip.position.set(-0.04, -0.15, 0.1);
    gunGroup.add(grip);
    
    // Slide
    const slide = new THREE.Mesh(
      new THREE.BoxGeometry(0.22, 0.08, 0.35),
      darkMat
    );
    slide.position.set(0, 0.08, -0.1);
    gunGroup.add(slide);
  }
  
  // Add iron sights for all weapons
  const rearSight = new THREE.Mesh(
    new THREE.BoxGeometry(0.12, 0.03, 0.02),
    gunMat
  );
  rearSight.position.set(-0.05, 0.08, -0.15);
  gunGroup.add(rearSight);
  
  const frontSight = new THREE.Mesh(
    new THREE.BoxGeometry(0.02, 0.06, 0.02),
    gunMat
  );
  frontSight.position.set(0, 0.06, -0.4);
  gunGroup.add(frontSight);
  
  // Position gun in first-person view (right side, slightly down)
  gunGroup.position.set(0.4, -0.3, -0.8);
  gunGroup.rotation.set(0.05, -0.1, 0);
  
  return gunGroup;
}

function createFirstPersonGun() {
  console.log('Creating first person gun system...');
  
  // Clear any existing guns
  if (viewGun) {
    camera.remove(viewGun);
  }
  gunArray.forEach(gun => {
    camera.remove(gun);
  });
  gunArray = [];
  
  // Create all gun models
  const weaponKeys = ['rifle', 'sniper', 'pistol'];
  weaponKeys.forEach(key => {
    const gun = createGunModel(key);
    gun.visible = (key === currentWeaponKey); // Only show current weapon
    camera.add(gun);
    gunArray[key] = gun;
  });
  
  // Set current gun
  viewGun = gunArray[currentWeaponKey];
  
  // Add muzzle flash to current gun
  if (viewGun) {
    muzzleLight = new THREE.PointLight(0xffaa00, 0, 8, 2.5);
    muzzleLight.position.set(0, 0.05, -1.2);
    viewGun.add(muzzleLight);
    
    const flashMat = new THREE.MeshStandardMaterial({
      color: 0xffcc00,
      emissive: 0xff9900,
      emissiveIntensity: 3,
      transparent: true,
      opacity: 0
    });
    muzzleMesh = new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.2, 6), flashMat);
    muzzleMesh.rotation.x = Math.PI / 2;
    muzzleMesh.position.copy(muzzleLight.position);
    viewGun.add(muzzleMesh);
  }
  
  console.log(`First person gun system created with ${weaponKeys.length} weapons`);
}

function animate() {
  try {
    requestAnimationFrame(animate);

    if (!threeReady || !clock || !scene || !camera || !renderer) {
      return;
    }
    
    const deltaTime = clock.getDelta();
    
    // Standard PointerLockControls WASD movement
    updatePlayerMovement(deltaTime);
    handleContinuousFire();
    
    // Update gun animation
    updateGunAnimation(deltaTime);
    
    // Update visual effects
    updateFx(deltaTime);
    
    // Update remote players
    updateRemotePlayers(deltaTime);
    
    // Send movement to server
    sendMovement(deltaTime);
    
    // Render the scene
    renderer.render(scene, camera);
    
  } catch (error) {
    console.error('❌ Animation loop error:', error);
    console.error('Animation error details:', error.message);
  }
}

function updateGunAnimation(deltaTime) {
  if (!viewGun) return;
  
  const speed = controls && controls.isLocked && (moveForward || moveBackward || moveLeft || moveRight)
    ? MOVE_SPEED
    : 0;
  
  if (speed > 0.1) {
    const bobAmount = Math.sin(Date.now() * 0.01) * 0.002;
    const swayAmount = Math.cos(Date.now() * 0.008) * 0.001;
    
    viewGun.position.x += swayAmount;
    viewGun.position.y += bobAmount;
  }
}

function updateRemotePlayers(deltaTime) {
  // Basic remote player update (simplified for now)
  remotePlayers.forEach((entry, id) => {
    if (entry.targetPosition) {
      entry.position.lerp(entry.targetPosition, deltaTime * 10);
      entry.mesh.position.copy(entry.position);
    }
  });
}

function sendMovement(deltaTime) {
  if (!localPlayer || !socket) return;
  
  lastMoveSend += deltaTime;
  if (lastMoveSend < MOVE_SEND_RATE) return;
  lastMoveSend = 0;

  const playerObject = getPlayerObject();
  const position = playerObject ? playerObject.position : camera.position;
  playerBody.position.copy(position);
  localPlayer.position.copy(position);

  socket.emit('playerMove', {
    x: position.x,
    y: position.y,
    z: position.z,
    rotation: camera.rotation.y
  });
}

function triggerMuzzleFlash() {
  if (!muzzleLight || !muzzleMesh) return;
  
  // More dramatic muzzle flash
  muzzleLight.intensity = 50;
  muzzleLight.color.setHex(0xffaa00);
  
  muzzleMesh.material.opacity = 1;
  muzzleMesh.material.emissiveIntensity = 4;
  
  // Add some randomness to flash
  muzzleMesh.scale.set(
    0.8 + Math.random() * 0.4,
    0.8 + Math.random() * 0.4,
    1.2 + Math.random() * 0.6
  );
  
  fxObjects.push({ obj: muzzleLight, ttl: 0.04, type: 'muzzleLight' });
  fxObjects.push({ obj: muzzleMesh, ttl: 0.06, type: 'muzzleMesh' });
}

function spawnTracer(origin, dir, hitPoint) {
  const p1 = origin.clone();
  const p2 = hitPoint ? hitPoint.clone() : origin.clone().addScaledVector(dir, 14);
  const geom = new THREE.BufferGeometry().setFromPoints([p1, p2]);
  const mat = new THREE.LineBasicMaterial({ color: 0xfff1c1, transparent: true, opacity: 0.8 });
  const line = new THREE.Line(geom, mat);
  line.userData.ignoreBulletRaycast = true;
  scene.add(line);
  fxObjects.push({ obj: line, ttl: 0.08, type: 'tracer' });
}

function disposeSceneObject(object) {
  if (!object) return;

  if (object.parent) {
    object.parent.remove(object);
  } else if (scene) {
    scene.remove(object);
  }

  object.traverse?.((child) => {
    if (child.geometry) {
      child.geometry.dispose?.();
    }

    if (Array.isArray(child.material)) {
      child.material.forEach((material) => material?.dispose?.());
    } else if (child.material) {
      child.material.dispose?.();
    }
  });
}

function updateFx(deltaTime) {
  for (let i = fxObjects.length - 1; i >= 0; i--) {
    fxObjects[i].ttl -= deltaTime;
    if (fxObjects[i].ttl <= 0) {
      const o = fxObjects[i].obj;
      if (fxObjects[i].type === 'muzzleLight' && o && o.isLight) {
        o.intensity = 0;
      } else if (fxObjects[i].type === 'muzzleMesh' && o && o.material && typeof o.material.opacity === 'number') {
        o.material.opacity = 0;
      } else if (o) {
        disposeSceneObject(o);
      }
      fxObjects.splice(i, 1);
    } else {
      const o = fxObjects[i].obj;
      if (o && o.material && typeof o.material.opacity === 'number') {
        o.material.opacity = Math.min(o.material.opacity, fxObjects[i].ttl / 0.08);
      }
    }
  }
}

function showHitMarker() {
  if (!hitMarker) return;
  hitMarker.style.opacity = '1';
  hitMarker.style.transform = 'translate(-50%, -50%) scale(1.2)';
  setTimeout(() => {
    hitMarker.style.opacity = '0';
    hitMarker.style.transform = 'translate(-50%, -50%) scale(1)';
  }, 120);
}

function updateAmmoUI() {
  if (!ammoText || !weaponName || !ammoContainer) return;
  const weapon = WEAPONS[currentWeaponKey];
  weaponName.textContent = weapon.name.toUpperCase();
  ammoText.textContent = `${currentAmmo} / ${weapon.maxAmmo}`;
  
  // Update ammo container state
  ammoContainer.classList.remove('reloading', 'low-ammo');
  
  if (reloading) {
    ammoContainer.classList.add('reloading');
    reloadIndicator.classList.add('active');
  } else {
    reloadIndicator.classList.remove('active');
  }
  
  if (currentAmmo <= weapon.maxAmmo * 0.2 && currentAmmo > 0) {
    ammoContainer.classList.add('low-ammo');
  }
  
  // Update crosshair based on weapon
  crosshair.classList.remove('sniper', 'pistol');
  if (currentWeaponKey === 'sniper') {
    crosshair.classList.add('sniper');
  } else if (currentWeaponKey === 'pistol') {
    crosshair.classList.add('pistol');
  }
}

function switchWeapon(key) {
  if (!WEAPONS[key] || currentWeaponKey === key) return;
  
  currentWeaponKey = key;
  currentAmmo = WEAPONS[key].maxAmmo;
  reloading = false;
  
  // Update weapon slot UI
  const weaponSlots = document.querySelectorAll('.weapon-slot');
  weaponSlots.forEach(slot => {
    slot.classList.remove('active');
    if (slot.dataset.weapon === key) {
      slot.classList.add('active');
    }
  });
  
  updateAmmoUI();
}

function beginReload() {
  if (reloading) return;
  const weapon = WEAPONS[currentWeaponKey];
  reloading = true;
  updateAmmoUI();
  
  setTimeout(() => {
    currentAmmo = weapon.maxAmmo;
    reloading = false;
    updateAmmoUI();
  }, weapon.reloadTime * 1000);
}


