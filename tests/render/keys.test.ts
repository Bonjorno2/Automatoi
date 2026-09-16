import { keyTarget } from "../../src/render/keys";

/** A stand-in for an element, because the test environment has no DOM. */
const el = (tagName: string, over: Record<string, unknown> = {}) => ({
  tagName,
  isContentEditable: false,
  closest: () => null,
  ...over,
});

describe("keyTarget", () => {
  it("keeps its hands off anything the player is typing into", () => {
    for (const tag of ["INPUT", "TEXTAREA", "input", "textarea"]) {
      expect(keyTarget(el(tag))).toBe("typing");
    }
    expect(keyTarget(el("DIV", { isContentEditable: true }))).toBe("typing");
  });

  it("treats a select as typing, because Space opens it", () => {
    // Not a control: blurring it on click would shut the speed dropdown the
    // instant it opened, and Space is how it is opened from the keyboard.
    expect(keyTarget(el("SELECT"))).toBe("typing");
  });

  it("treats anything inside the editor as typing, whatever Monaco focused", () => {
    // Monaco focuses a hidden textarea today, which the tag check already
    // catches. This is for whatever it focuses in a later version.
    expect(keyTarget(el("DIV", { closest: (s: string) => (s === "#editor" ? {} : null) }))).toBe(
      "typing",
    );
  });

  it("calls a button a control, so the platform keeps its activation keys", () => {
    expect(keyTarget(el("BUTTON"))).toBe("control");
    expect(keyTarget(el("A"))).toBe("control");
  });

  it("calls everything else the world", () => {
    // The finding this module exists for: the old guard was
    // `target === document.body`, so a focused button made every binding dead.
    // A button is now a control rather than a disqualification, which is what
    // lets `R` rotate a belt straight after picking it from the build menu.
    for (const tag of ["BODY", "CANVAS", "DIV", "ASIDE", "P"]) {
      expect(keyTarget(el(tag))).toBe("world");
    }
  });

  it("survives the targets that are not elements at all", () => {
    // `window` and `document` are legitimate keydown targets, and a synthetic
    // event can carry null. None of them should disable a binding.
    expect(keyTarget(null)).toBe("world");
    expect(keyTarget(undefined)).toBe("world");
    expect(keyTarget({})).toBe("world");
    expect(keyTarget({ tagName: 42 })).toBe("world");
  });
});
