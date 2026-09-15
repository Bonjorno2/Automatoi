/// <reference types="vite/client" />

/** Monaco's language services, imported through Vite's `?worker` suffix. */
declare module "*?worker" {
  const WorkerConstructor: new () => Worker;
  export default WorkerConstructor;
}
