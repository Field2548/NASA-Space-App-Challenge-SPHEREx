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
  /** Known object shown in the heading and Inspect; the public field title is neutral (issue #10). */
  objectName: string;
  steps: TutorialStep[];
};

/** Reveal step text when Inspect is already on as the step starts (it then finishes with Next). */
export const REVEAL_INSPECT_ON =
  "The dot is (433) Eros. Inspect is already on: click the dot to see its name, its place on the sky, how bright it is, and when the picture was taken.";

export const TUTORIAL: TutorialLevel[] = [
  {
    id: 0,
    title: "Boot",
    spot: "eros",
    objectName: "(433) Eros",
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
    objectName: "(433) Eros",
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
        text: "The dot is (433) Eros. Turn on Inspect, then click the dot to see its name, its place on the sky, how bright it is, and when the picture was taken.",
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
