/**
 * What kind of thing a key press landed on.
 *
 * Milestone 7's finding 2. Three keyboard bindings — `R` in the inspector,
 * `Home` and `Space` for the camera — each guarded themselves with
 * `e.target === document.body`, which means *nothing has focus*. The intent was
 * "not while the player is typing in Monaco". The effect was that clicking any
 * button on the page silently disabled all three until the player clicked the
 * canvas again, with nothing on screen to explain why.
 *
 * So the question is asked properly and asked in one place. Three callers, one
 * predicate, which is the same discipline `canPlace` and `canRemove` carry in
 * the sim.
 *
 * Duck-typed rather than using `instanceof HTMLElement`, because the test
 * environment has no DOM — the same reason `stage.test.ts` checks the resize
 * fan-out with plain objects.
 */
export type KeyTarget =
  /** A text field, a select, or anywhere inside the editor. Hands off entirely. */
  | "typing"
  /** A button or a link. It owns its own activation keys; everything else is fair game. */
  | "control"
  /** The body, the canvas, a plain container. Every binding applies. */
  | "world";

/** Widgets that consume keys as input. `SELECT` is here because Space opens it. */
const TYPING_TAGS = new Set(["INPUT", "TEXTAREA", "SELECT"]);

/** Widgets the platform activates with Space or Enter. */
const CONTROL_TAGS = new Set(["BUTTON", "A"]);

export function keyTarget(target: unknown): KeyTarget {
  const el = target as {
    tagName?: unknown;
    isContentEditable?: unknown;
    closest?: (selector: string) => unknown;
  } | null;
  // `window` and `document` are legitimate targets and are neither.
  if (!el || typeof el.tagName !== "string") return "world";

  if (el.isContentEditable === true) return "typing";
  const tag = el.tagName.toUpperCase();
  if (TYPING_TAGS.has(tag)) return "typing";
  // Monaco focuses a hidden textarea, which the tag check already catches. This
  // is for whatever else it decides to focus, now or in a later version.
  if (typeof el.closest === "function" && el.closest("#editor")) return "typing";

  return CONTROL_TAGS.has(tag) ? "control" : "world";
}
