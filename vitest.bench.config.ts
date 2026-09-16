import { defineConfig } from "vitest/config";

/**
 * Benchmarks, which are a different kind of thing from tests and need a
 * different runner.
 *
 * **They are isolated because they measure wall time.** A benchmark here paces
 * the world with `RealtimeClock`, so how long a worker thread takes to boot is
 * part of the measurement rather than an irrelevance. `cycle-four.test.ts`
 * already recorded the consequence in the main suite — "the whole suite runs
 * sixty files that are also starting threads, so a test that needed the child to
 * clear half the field would be measuring how busy the machine is". That is true
 * of every benchmark and doubly true of a wall-clocked one.
 *
 * So: one file at a time, one thread, and not part of `npm test`. Run them with
 * `npm run bench`, on a machine that is not doing anything else.
 */
export default defineConfig({
  test: {
    globals: true,
    include: ["tests/**/*.bench.ts"],
    fileParallelism: false,
    pool: "threads",
    poolOptions: { threads: { singleThread: true } },
    testTimeout: 480_000,
    hookTimeout: 60_000,
  },
});
