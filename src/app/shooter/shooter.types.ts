export interface Bullet {
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
}

export interface Enemy {
  x: number;
  y: number;
  vy: number;
  hp: number;
}

export interface SpawnStep {
  timeFromStartSeconds: number;
  xRatio: number;
  speedMultiplier: number;
}
