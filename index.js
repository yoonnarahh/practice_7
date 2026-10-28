import * as THREE from "three";

// Global scene values
let glCanvas, gl, camera, scene, renderer, controller, reticle;
let arButton, clearButton, fallbackEl;
let statusSession, statusReticle, statusAnchors, statusCount, statusTracking;

// Global XR values
let xrSession = null;
let hitTestSource = null;
let hitTestSourceRequested = false;
let placeRequested = false;
let localRefSpace = null;
let viewerRefSpace = null;
let currentHitResult = null;
let isHitValid = false;

// Placed products array: { object, anchor }
const placedProducts = [];
const MAX_PRODUCTS = 5;
const MAX_TILT_RAD = (12 * Math.PI) / 180; // 12 degrees tolerance for ID 243122[cite: 9]

initDOM();
loadScene();

function initDOM() {
  arButton = document.getElementById("ar-button");
  clearButton = document.getElementById("clear");
  fallbackEl = document.getElementById("fallback");

  statusSession = document.getElementById("st-session");
  statusReticle = document.getElementById("st-reticle");
  statusAnchors = document.getElementById("st-anchors");
  statusCount = document.getElementById("st-count");
  statusTracking = document.getElementById("st-tracking");

  // Prevent taps on UI overlay from triggering product placement (Task E)[cite: 9]
  const overlay = document.getElementById("overlay");
  overlay.addEventListener("beforexrselect", (e) => e.preventDefault());

  clearButton.addEventListener("click", clearProducts);
  arButton.addEventListener("click", onButtonClicked);

  // Дублируем триггер размещения по клику мышкой в эмуляторе для удобства тестирования и записи
  window.addEventListener("click", (event) => {
    if (xrSession && event.target.tagName !== "BUTTON" && !event.target.closest("#overlay")) {
      placeRequested = true;
    }
  });
}

function loadScene() {
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.01, 20);

  // Lighting: HemisphereLight + DirectionalLight (Task C)[cite: 9]
  const hemiLight = new THREE.HemisphereLight(0xffffff, 0xbbbbff, 1);
  hemiLight.position.set(0.5, 1, 0.25);
  scene.add(hemiLight);

  const dirLight = new THREE.DirectionalLight(0xffffff, 1.5);
  dirLight.position.set(2, 4, 2);
  scene.add(dirLight);

  // Porting fix 1: WebGLRenderer constructor with xrCompatible context (Task A)[cite: 9]
  glCanvas = document.createElement("canvas");
  gl = glCanvas.getContext("webgl2", { xrCompatible: true }) || glCanvas.getContext("webgl", { xrCompatible: true });
  renderer = new THREE.WebGLRenderer({ canvas: glCanvas, context: gl, antialias: true, alpha: true });
  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.xr.enabled = true;
  document.body.appendChild(renderer.domElement);

  // Reticle construction: flat ring (Task B)[cite: 9]
  const reticleGeo = new THREE.RingGeometry(0.15, 0.2, 32);
  reticleGeo.rotateX(-Math.PI / 2);
  const reticleMat = new THREE.MeshBasicMaterial({ color: 0x00ff00, side: THREE.DoubleSide });
  reticle = new THREE.Mesh(reticleGeo, reticleMat);
  reticle.matrixAutoUpdate = false;
  reticle.visible = false;
  scene.add(reticle);

  // Controller setup for hit select (Task D)[cite: 9]
  controller = renderer.xr.getController(0);
  controller.addEventListener("select", () => {
    placeRequested = true;
  });
  scene.add(controller);

  // Check WebXR AR support (Task A)[cite: 9]
  if ("xr" in navigator) {
    navigator.xr.isSessionSupported("immersive-ar").then((supported) => {
      if (supported) {
        arButton.disabled = false;
        arButton.textContent = "START AR";
      } else {
        showFallback("WebXR Immersive AR is not supported on this device/browser.");
      }
    }).catch(() => {
      showFallback("Error checking WebXR support.");
    });
  } else {
    showFallback("WebXR API is not available (Secure context HTTPS required).");
  }

  window.addEventListener("resize", onWindowResize);
}

function showFallback(message) {
  arButton.disabled = true;
  arButton.textContent = "AR Unavailable";
  fallbackEl.textContent = message;
  fallbackEl.hidden = false;
}

// Variant 2: Coffee Table (1.00 x 0.50 m top, 0.45 m height, 4 legs) (Task C)[cite: 9]
function buildProduct() {
  const group = new THREE.Group();
  const woodMaterial = new THREE.MeshStandardMaterial({ color: 0x8B4513, roughness: 0.4 });
  const legMaterial = new THREE.MeshStandardMaterial({ color: 0x222222, metalness: 0.8, roughness: 0.2 });

  // Table Top: 1.00 x 0.05 x 0.50 m at y = 0.425
  const topGeo = new THREE.BoxGeometry(1.00, 0.05, 0.50);
  const topMesh = new THREE.Mesh(topGeo, woodMaterial);
  topMesh.position.set(0, 0.425, 0);
  group.add(topMesh);

  // 4 Legs
  const legRadius = 0.025;
  const legHeight = 0.40;
  const legGeo = new THREE.CylinderGeometry(legRadius, legRadius, legHeight, 16);

  const xOffset = 0.42;
  const zOffset = 0.18;
  const legPositions = [
    [-xOffset, legHeight / 2, -zOffset],
    [ xOffset, legHeight / 2, -zOffset],
    [-xOffset, legHeight / 2,  zOffset],
    [ xOffset, legHeight / 2,  zOffset],
  ];

  legPositions.forEach((pos) => {
    const legMesh = new THREE.Mesh(legGeo, legMaterial);
    legMesh.position.set(...pos);
    group.add(legMesh);
  });

  // Size verification log (Task C)[cite: 9]
  const bbox = new THREE.Box3().setFromObject(group);
  const size = new THREE.Vector3();
  bbox.getSize(size);
  console.log(`[Product Variant 2 - Coffee Table] Size (m): X=${size.x.toFixed(2)}, Y=${size.y.toFixed(2)}, Z=${size.z.toFixed(2)}`);

  return group;
}

function onButtonClicked() {
  if (xrSession === null) {
    onRequestSession();
  } else {
    endXRSession();
  }
}

function onRequestSession() {
  const sessionInit = {
    requiredFeatures: ["hit-test"],
    optionalFeatures: ["anchors", "dom-overlay"],
    domOverlay: { root: document.getElementById("overlay") }
  };

  navigator.xr.requestSession("immersive-ar", sessionInit).then(onSessionStarted);
}

function onSessionStarted(session) {
  xrSession = session;
  arButton.textContent = "STOP AR";
  statusSession.textContent = "Active";

  session.addEventListener("end", onSessionEnd);

  renderer.xr.setReferenceSpaceType("local");
  renderer.xr.setSession(session);

  session.requestReferenceSpace("viewer").then((refSpace) => {
    viewerRefSpace = refSpace;
  });

  session.requestReferenceSpace("local").then((refSpace) => {
    localRefSpace = refSpace;
  });

  // Check anchors support
  if (session.enabledFeatures && session.enabledFeatures.includes("anchors")) {
    statusAnchors.textContent = "On";
  } else {
    statusAnchors.textContent = "Off (Fallback mode)";
  }

  hitTestSourceRequested = false;
  hitTestSource = null;

  animate();
}

function animate() {
  renderer.setAnimationLoop(render);
}

function render(time, frame) {
  if (frame) {
    const session = frame.session;

    // Check tracking status (Task E)[cite: 9]
    const viewerPose = frame.getViewerPose(localRefSpace);
    if (!viewerPose || viewerPose.emulatedPosition) {
      statusTracking.textContent = "Tracking lost — move the phone slowly";
      reticle.visible = false;
      placeRequested = false;
    } else {
      statusTracking.textContent = "";
    }

    // Porting fix 3: Request hit-test source ONCE (Task A, B)[cite: 9]
    if (!hitTestSourceRequested && viewerRefSpace) {
      session.requestHitTestSource({ space: viewerRefSpace }).then((source) => {
        hitTestSource = source;
      });
      hitTestSourceRequested = true;
    }

    // Process Hit Test Results (Task B)[cite: 9]
    if (hitTestSource && localRefSpace && viewerPose) {
      const hitResults = frame.getHitTestResults(hitTestSource);

      if (hitResults.length > 0) {
        currentHitResult = hitResults[0];
        const pose = currentHitResult.getPose(localRefSpace);

        if (pose) {
          reticle.visible = true;
          reticle.matrix.fromArray(pose.transform.matrix);

          // Surface filter: read surface normal (y-axis column: elements 4, 5, 6)[cite: 9]
          const e = pose.transform.matrix;
          const normal = new THREE.Vector3(e[4], e[5], e[6]).normalize();
          const worldUp = new THREE.Vector3(0, 1, 0);

          const angleRad = normal.angleTo(worldUp);
          const angleDeg = (angleRad * 180 / Math.PI).toFixed(1);

          if (angleRad <= MAX_TILT_RAD) {
            isHitValid = true;
            reticle.material.color.setHex(0x00ff00); // Green
            statusReticle.textContent = `Valid (${angleDeg}°)`;
          } else {
            isHitValid = false;
            reticle.material.color.setHex(0xff0000); // Red
            statusReticle.textContent = `Too tilted (${angleDeg}°)`;
          }
        }
      } else {
        reticle.visible = false;
        isHitValid = false;
        currentHitResult = null;
        statusReticle.textContent = "None";
      }
    }

    // Process Placement request (Task D)[cite: 9]
    if (placeRequested) {
      if (isHitValid && currentHitResult) {
        placeProduct(frame, currentHitResult);
      }
      placeRequested = false;
    }

    // Update anchored products matrices each frame (Task D)[cite: 9]
    placedProducts.forEach((item) => {
      if (item.anchor && frame.getPose) {
        const anchorPose = frame.getPose(item.anchor.anchorSpace, localRefSpace);
        if (anchorPose) {
          item.object.matrixAutoUpdate = false;
          item.object.matrix.fromArray(anchorPose.transform.matrix);
        }
      }
    });
  }

  renderer.render(scene, camera);
}

function placeProduct(frame, hitResult) {
  // Multi mode: max 5 products, 6th removes oldest (Task D)[cite: 9]
  if (placedProducts.length >= MAX_PRODUCTS) {
    const oldest = placedProducts.shift();
    scene.remove(oldest.object);
    if (oldest.anchor) oldest.anchor.delete();
  }

  const product = buildProduct();
  product.matrixAutoUpdate = false;

  const pose = hitResult.getPose(localRefSpace);
  product.matrix.fromArray(pose.transform.matrix);

  let anchorObj = null;
  if (hitResult.createAnchor) {
    hitResult.createAnchor().then((anchor) => {
      anchorObj = anchor;
      const itemRef = placedProducts.find(p => p.object === product);
      if (itemRef) itemRef.anchor = anchor;
    }).catch((err) => {
      console.warn("Anchor creation failed, falling back to static pose:", err);
    });
  }

  scene.add(product);
  placedProducts.push({ object: product, anchor: anchorObj });

  statusCount.textContent = `${placedProducts.length} / ${MAX_PRODUCTS}`;
}

function clearProducts() {
  placedProducts.forEach((item) => {
    scene.remove(item.object);
    if (item.anchor) item.anchor.delete();
  });
  placedProducts.length = 0;
  statusCount.textContent = `0 / ${MAX_PRODUCTS}`;
}

function endXRSession() {
  if (xrSession) {
    xrSession.end();
  }
}

function onSessionEnd() {
  if (hitTestSource) {
    hitTestSource.cancel();
    hitTestSource = null;
  }
  hitTestSourceRequested = false;
  xrSession = null;

  clearProducts();

  arButton.textContent = "START AR";
  statusSession.textContent = "Inactive";
  statusReticle.textContent = "None";
  statusTracking.textContent = "";
  reticle.visible = false;
}

function onWindowResize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
}