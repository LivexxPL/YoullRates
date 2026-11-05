// The 3D view: a small quad model that only rotates (no gravity, wind or collisions), seen from a
// fixed chase camera or from its own FPV camera. Kept deliberately light: a few hundred triangles,
// no shadows, no textures, rendered only while the simulator is on screen.
import {
  BoxGeometry,
  BufferGeometry,
  CircleGeometry,
  Color,
  CylinderGeometry,
  DirectionalLight,
  Float32BufferAttribute,
  Fog,
  Group,
  HemisphereLight,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshStandardMaterial,
  PerspectiveCamera,
  Scene,
  TorusGeometry,
  WebGLRenderer,
  type Material,
  type Object3D,
} from 'three';
import type { Quat } from './kinematics';

export type ViewMode = 'chase' | 'fpv';

export interface SimScene {
  setAttitude(q: Quat): void;
  setView(mode: ViewMode): void;
  /** FPV camera tilt above the craft's horizontal plane, degrees. */
  setUptilt(degrees: number): void;
  resize(width: number, height: number, pixelRatio: number): void;
  render(): void;
  dispose(): void;
}

const SKY = '#8fb9e3';
const GROUND_Y = -2;

function material(color: string, opts: { transparent?: boolean; opacity?: number; metalness?: number; roughness?: number; behind?: boolean } = {}) {
  return new MeshStandardMaterial({
    color,
    roughness: opts.roughness ?? 0.7,
    metalness: opts.metalness ?? 0.1,
    transparent: opts.transparent ?? false,
    opacity: opts.opacity ?? 1,
    // Pushed back in depth so lines drawn on it (the grid) never z-fight with it.
    polygonOffset: opts.behind ?? false,
    polygonOffsetFactor: 1,
    polygonOffsetUnits: 1,
  });
}

function mesh(geometry: BufferGeometry, mat: Material, x = 0, y = 0, z = 0): Mesh {
  const m = new Mesh(geometry, mat);
  m.position.set(x, y, z);
  return m;
}

/** X-frame quad, nose along −Z, top along +Y. Orange front props mark the front, as on most FPV quads. */
function buildCraft(ducted: boolean): Group {
  const craft = new Group();
  const carbon = material('#1f252c', { roughness: 0.55 });
  const metal = material('#a3adb8', { metalness: 0.6, roughness: 0.35 });
  const frontProp = material('#ff7a33', { transparent: true, opacity: 0.6 });
  const rearProp = material('#3d8fd6', { transparent: true, opacity: 0.5 });

  craft.add(mesh(new BoxGeometry(0.34, 0.08, 0.56), carbon));
  for (const angle of [Math.PI / 4, -Math.PI / 4]) {
    const arm = mesh(new BoxGeometry(1.15, 0.035, 0.09), carbon);
    arm.rotation.y = angle;
    craft.add(arm);
  }
  const motorGeometry = new CylinderGeometry(0.07, 0.07, 0.08, 20);
  const propGeometry = new CylinderGeometry(0.3, 0.3, 0.012, 36);
  const ductGeometry = new TorusGeometry(0.33, 0.03, 10, 44);
  for (const [x, z] of [
    [0.4, -0.4],
    [-0.4, -0.4],
    [0.4, 0.4],
    [-0.4, 0.4],
  ] as const) {
    craft.add(mesh(motorGeometry, metal, x, 0.06, z));
    craft.add(mesh(propGeometry, z < 0 ? frontProp : rearProp, x, 0.11, z));
    if (ducted) {
      const duct = mesh(ductGeometry, carbon, x, 0.09, z);
      duct.rotation.x = Math.PI / 2;
      craft.add(duct);
    }
  }
  craft.add(mesh(new BoxGeometry(0.17, 0.11, 0.34), material('#34465a'), 0, 0.1, 0.04)); // battery on top
  craft.add(mesh(new BoxGeometry(0.13, 0.11, 0.09), material('#0d0f12'), 0, 0.06, -0.3)); // FPV camera
  const lens = mesh(new CylinderGeometry(0.035, 0.035, 0.05, 16), material('#38506b', { metalness: 0.5, roughness: 0.2 }), 0, 0.06, -0.36);
  lens.rotation.x = Math.PI / 2;
  craft.add(lens);
  return craft;
}

/**
 * Ground grid made of one-cell segments. A long line that passes behind the camera is dropped
 * whole by some renderers (Chrome's SwiftShader software fallback), which would erase exactly the
 * lines running away from the pilot; short segments are clipped individually everywhere.
 */
function buildGrid(size: number, step: number, color: string): LineSegments {
  const half = size / 2;
  const cells = Math.round(size / step);
  const positions: number[] = [];
  for (let i = 0; i <= cells; i++) {
    const a = -half + i * step;
    for (let j = 0; j < cells; j++) {
      const b = -half + j * step;
      positions.push(a, 0, b, a, 0, b + step, b, 0, a, b + step, 0, a);
    }
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  return new LineSegments(geometry, new LineBasicMaterial({ color }));
}

/** Ground, grid and a ring of gates: enough world to read attitude and heading at a glance. */
function buildWorld(scene: Scene) {
  const ground = mesh(new CircleGeometry(220, 64), material('#5f7a54', { roughness: 1, behind: true }), 0, GROUND_Y, 0);
  ground.rotation.x = -Math.PI / 2;
  scene.add(ground);
  // Grid lines are the optical-flow cue that makes rotation speed readable, in FPV view above all.
  const grid = buildGrid(120, 3, '#3a5232');
  grid.position.y = GROUND_Y;
  scene.add(grid);

  const orange = material('#ff7a33');
  const blue = material('#3d8fd6');
  const post = new BoxGeometry(0.25, 3, 0.25);
  const bar = new BoxGeometry(3.5, 0.25, 0.25);
  for (let i = 0; i < 8; i++) {
    const heading = (i / 8) * Math.PI * 2;
    const gate = new Group();
    const mat = i % 2 ? blue : orange;
    gate.add(mesh(post, mat, -1.75, 1.5, 0), mesh(post, mat, 1.75, 1.5, 0), mesh(bar, mat, 0, 3, 0));
    gate.position.set(Math.sin(heading) * 16, GROUND_Y, -Math.cos(heading) * 16);
    gate.rotation.y = -heading;
    scene.add(gate);
  }
}

export function createSimScene(canvas: HTMLCanvasElement, options: { ducted: boolean }): SimScene {
  const renderer = new WebGLRenderer({ canvas, antialias: true, powerPreference: 'low-power' });
  const scene = new Scene();
  scene.background = new Color(SKY);
  scene.fog = new Fog(SKY, 20, 90);
  scene.add(new HemisphereLight('#dceeff', '#3a4a35', 1.6));
  const sun = new DirectionalLight('#ffffff', 1.8);
  sun.position.set(5, 10, 7);
  scene.add(sun);
  buildWorld(scene);

  // The attitude group rotates; the visible model and the FPV camera ride on it.
  const attitude = new Group();
  const model = buildCraft(options.ducted);
  attitude.add(model);
  scene.add(attitude);

  const chase = new PerspectiveCamera(42, 16 / 9, 0.05, 400);
  chase.position.set(0, 0.95, 3.5);
  chase.lookAt(0, 0.12, 0);

  const fpv = new PerspectiveCamera(78, 16 / 9, 0.02, 400);
  fpv.position.set(0, 0.06, -0.4);
  attitude.add(fpv);

  let view: ViewMode = 'chase';
  return {
    setAttitude(q) {
      attitude.quaternion.set(q.x, q.y, q.z, q.w);
    },
    setView(mode) {
      view = mode;
      model.visible = mode === 'chase';
    },
    setUptilt(degrees) {
      fpv.rotation.set((degrees * Math.PI) / 180, 0, 0);
    },
    resize(width, height, pixelRatio) {
      renderer.setPixelRatio(Math.min(pixelRatio, 2));
      renderer.setSize(width, height, false);
      for (const camera of [chase, fpv]) {
        camera.aspect = width / Math.max(height, 1);
        camera.updateProjectionMatrix();
      }
    },
    render() {
      renderer.render(scene, view === 'chase' ? chase : fpv);
    },
    dispose() {
      scene.traverse((object: Object3D) => {
        if (object instanceof Mesh || object instanceof LineSegments) {
          object.geometry.dispose();
          (Array.isArray(object.material) ? object.material : [object.material]).forEach((m) => m.dispose());
        }
      });
      renderer.dispose();
    },
  };
}
