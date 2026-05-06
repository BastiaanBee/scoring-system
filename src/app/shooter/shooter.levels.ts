/**
 * Data-driven level system.
 *
 * To add a new level, append a LevelDefinition to LEVEL_CATALOG.
 * No engine code needs to change.
 */

export interface SpawnConfig {
  /** Seed used to initialise the deterministic RNG for this level. */
  seed: number;
  /** Total number of enemies to spawn before the level ends. */
  maxSpawns: number;
  /** [min, max] multipliers applied to the base enemy speed. */
  speedMultiplierRange: [number, number];
  /** Seconds before the very first spawn. */
  initialGapSeconds: number;
  /** Minimum horizontal ratio (0–1) from the left edge. */
  minEdgeRatio: number;
  /** Maximum horizontal ratio (0–1) from the left edge. */
  maxEdgeRatio: number;
  /** Minimum ratio distance required between consecutive single spawns. */
  minSpacingRatio: number;
  /** [min, max] gap in seconds between single spawns. */
  singleGapRange: [number, number];
  /** Probability (0–1) that a cluster is placed instead of a single. */
  clusterProbability: number;
  /** [min, max] ratio range for the cluster centre point. */
  clusterCenterRange: [number, number];
  /** [min, max] ratio offset from centre to each wing enemy. */
  clusterWingOffsetRange: [number, number];
  /** Seconds between consecutive enemies within a cluster. */
  clusterMemberDelaySeconds: number;
  /** [min, max] gap in seconds after a cluster before the next wave. */
  clusterGapRange: [number, number];
}

export interface LevelDefinition {
  id: number;
  label: string;
  /** Base enemy descent speed in pixels per second. */
  enemySpeed: number;
  /** Hit points each enemy starts with. */
  enemyHitPoints: number;
  spawn: SpawnConfig;
}

export const LEVEL_CATALOG: LevelDefinition[] = [
  {
    id: 1,
    label: 'Sector Patrol',
    enemySpeed: 88,
    enemyHitPoints: 5,
    spawn: {
      seed: 0x5f3759df,
      maxSpawns: 50,
      speedMultiplierRange: [1.0, 1.5],
      initialGapSeconds: 1.0,
      minEdgeRatio: 0.1,
      maxEdgeRatio: 0.9,
      minSpacingRatio: 0.2,
      singleGapRange: [2.1, 3.5],
      clusterProbability: 0.18,
      clusterCenterRange: [0.34, 0.66],
      clusterWingOffsetRange: [0.12, 0.18],
      clusterMemberDelaySeconds: 0.3,
      clusterGapRange: [4.0, 5.6],
    },
  },
];
