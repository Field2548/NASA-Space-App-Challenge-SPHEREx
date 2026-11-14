export type TutorialStep = {
  id: string;
  text: string;
  /** UI element key the coach mark points at */
  target?: string;
  /** Machine-readable event name, e.g. "frame-changed", "mark-placed", "submitted" */
  doneWhen: string;
};

export type TutorialLevel = {
  id: number;
  title: string;
  spot: string;
  steps: TutorialStep[];
};

export const TUTORIAL: TutorialLevel[] = [
  {
    id: 0,
    title: "Boot",
    spot: "eros",
    steps: [
      {
        id: "l0-intro",
        text: "These are real SPHEREx pictures of one patch of sky at different times.",
        target: "frame-viewer",
        doneWhen: "intro-seen",
      },
      {
        id: "l0-play",
        text: "Press Play to watch the pictures change.",
        target: "play-button",
        doneWhen: "play-pressed",
      },
    ],
  },
  {
    id: 1,
    title: "First contact",
    spot: "eros",
    steps: [
      {
        id: "l1-mark-first",
        text: "Find the dot that jumps. Mark it in one picture.",
        target: "mark-tool",
        doneWhen: "mark-placed",
      },
      {
        id: "l1-mark-second",
        text: "Mark the same dot in another picture where it is still visible.",
        target: "frame-picker",
        doneWhen: "mark-placed",
      },
      {
        id: "l1-reveal",
        text: "The dot is (433) Eros. Open Inspect to see its real distance from Earth.",
        target: "inspect-toggle",
        doneWhen: "inspect-opened",
      },
      {
        id: "l1-overlay",
        text: "Turn on Known asteroids. JPL's predicted spots, shown as diamonds, land on the dots you found.",
        target: "overlay-known-asteroids",
        doneWhen: "overlay-toggled",
      },
    ],
  },
];
