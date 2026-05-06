import { LevelDefinition } from './shooter.levels';
import { SeededRng } from './shooter.rng';
import { SpawnStep } from './shooter.types';

/**
 * Builds a deterministic spawn schedule for the given level.
 *
 * Pass a SeededRng initialised with `level.spawn.seed` to get the same
 * schedule on every run.  Pass a differently-seeded RNG for a randomised
 * run (e.g. daily challenge modes).
 */
export function buildSpawnSchedule(level: LevelDefinition, rng: SeededRng): SpawnStep[] {
  const schedule: SpawnStep[] = [];
  const { spawn } = level;
  const { minEdgeRatio, maxEdgeRatio } = spawn;
  let elapsed = spawn.initialGapSeconds;
  let lastSingleRatio = 0.5;

  const clampRatio = (value: number) =>
    Math.max(minEdgeRatio, Math.min(maxEdgeRatio, value));

  const randomSpeedMultiplier = () =>
    rng.range(spawn.speedMultiplierRange[0], spawn.speedMultiplierRange[1]);

  const getSpacedSingleRatio = () => {
    let ratio = clampRatio(rng.range(minEdgeRatio, maxEdgeRatio));
    let attempts = 0;
    while (Math.abs(ratio - lastSingleRatio) < spawn.minSpacingRatio && attempts < 8) {
      ratio = clampRatio(rng.range(minEdgeRatio, maxEdgeRatio));
      attempts += 1;
    }
    lastSingleRatio = ratio;
    return ratio;
  };

  const pushSingle = () => {
    schedule.push({
      timeFromStartSeconds: elapsed,
      xRatio: getSpacedSingleRatio(),
      speedMultiplier: randomSpeedMultiplier(),
    });
    elapsed += rng.range(spawn.singleGapRange[0], spawn.singleGapRange[1]);
  };

  const pushSymmetricCluster = () => {
    const center = rng.range(spawn.clusterCenterRange[0], spawn.clusterCenterRange[1]);
    const wingOffset = rng.range(spawn.clusterWingOffsetRange[0], spawn.clusterWingOffsetRange[1]);
    const left = clampRatio(center - wingOffset);
    const right = clampRatio(center + wingOffset);
    const clusterSpeedMultiplier = randomSpeedMultiplier();
    const delay = spawn.clusterMemberDelaySeconds;

    schedule.push({
      timeFromStartSeconds: elapsed,
      xRatio: left,
      speedMultiplier: clusterSpeedMultiplier,
    });
    schedule.push({
      timeFromStartSeconds: elapsed + delay,
      xRatio: center,
      speedMultiplier: clusterSpeedMultiplier,
    });
    schedule.push({
      timeFromStartSeconds: elapsed + delay * 2,
      xRatio: right,
      speedMultiplier: clusterSpeedMultiplier,
    });

    lastSingleRatio = center;
    elapsed += rng.range(spawn.clusterGapRange[0], spawn.clusterGapRange[1]);
  };

  while (schedule.length < spawn.maxSpawns) {
    const remaining = spawn.maxSpawns - schedule.length;
    const canPlaceCluster = remaining >= 3;
    const shouldPlaceCluster = canPlaceCluster && rng.next() < spawn.clusterProbability;

    if (shouldPlaceCluster) {
      pushSymmetricCluster();
    } else {
      pushSingle();
    }
  }

  schedule.sort((a, b) => a.timeFromStartSeconds - b.timeFromStartSeconds);
  return schedule.slice(0, spawn.maxSpawns);
}
