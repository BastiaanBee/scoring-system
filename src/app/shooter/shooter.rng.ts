/**
 * Deterministic linear congruential generator.
 * Produces the same sequence for a given seed every time, which is what
 * makes level spawn patterns repeatable across restarts.
 */
export class SeededRng {
  private state: number;

  constructor(seed: number) {
    this.state = seed >>> 0;
  }

  /** Returns the next value in [0, 1). */
  next(): number {
    this.state = (1664525 * this.state + 1013904223) >>> 0;
    return this.state / 0x100000000;
  }

  /** Returns a value uniformly distributed in [min, max). */
  range(min: number, max: number): number {
    return min + this.next() * (max - min);
  }
}
