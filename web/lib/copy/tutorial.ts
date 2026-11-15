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

/** Coach text after a tutorial submit that did not land on Eros (the checker's round verdict is not shown here). */
export const TUTORIAL_MISS =
  "Not on the dot yet. A mark must sit within 2 pixels of it. Click Clear marks, then mark the jumping dot again in frames 1 to 3, or use Skip step.";

/** JPL positions of (433) Eros on the tutorial field, copied from web/data/catalog/eros.json
 * (pixel grid, frames 1-based = FrameMeta.i of public/fields/eros). It is drawn when the
 * tutorial's Known asteroids toggle is on; the tutorial may name Eros, a round never does. */
export const EROS_OVERLAY = {
  asteroids: [
    {
      name: "(433) Eros",
      positions: [
        { frame: 1, x: 83.57, y: 78.71, vmag: 13.2 },
        { frame: 2, x: 54.03, y: 54.46, vmag: 13.2 },
        { frame: 3, x: 39.53, y: 42.54, vmag: 13.2 },
      ],
    },
  ],
  stars: [],
};

export const TUTORIAL: TutorialLevel[] = [
  {
    id: 0,
    title: "Watch",
    spot: "eros",
    objectName: "(433) Eros",
    steps: [
      {
        id: "l0-intro",
        text: "These are real SPHEREx pictures of one patch of sky, taken at different times. Stars stay still. Something that moves from picture to picture is an asteroid or a planet, and that is what you hunt for.",
        target: "frame-viewer",
        doneWhen: "next",
      },
      {
        id: "l0-play",
        text: "Press Blink to flip through the pictures. Watch for the one dot that jumps while the stars stay put.",
        target: "play-button",
        doneWhen: "play-pressed",
      },
      {
        id: "l0-speed",
        text: "Speed sets how many pictures Blink shows each second, from 0.5 to 3. Slower is easier to follow.",
        target: "blink-speed",
        doneWhen: "next",
      },
      {
        id: "l0-step",
        text: "Step by hand: press the arrow buttons, or the left and right arrow keys, to move one picture at a time. After the last picture it wraps around to the first. Try it.",
        target: "frame-controls",
        doneWhen: "frame-changed",
      },
      {
        id: "l0-frames",
        text: "Frames chooses how many of this spot's pictures are used at all, spread evenly across the time span. Fewer is quicker to scan, but a slow mover can slip through. Leave it on all of them.",
        target: "frames-count",
        doneWhen: "next",
      },
      {
        id: "l0-range",
        text: "The Blink bar is different. Every picture stays, but Blink only cycles through the ones between its two handles, and the rest are dimmed. Use it to loop just the pictures where the dot is easy to see.",
        target: "blink-range",
        doneWhen: "next",
      },
    ],
  },
  {
    id: 1,
    title: "Look closer",
    spot: "eros",
    objectName: "(433) Eros",
    steps: [
      {
        id: "l1-color",
        text: "Press Color by time. Each picture gets its own color and they are stacked into one. Still things turn white. A mover leaves a trail of colored dots.",
        target: "color-by-time",
        doneWhen: "color-by-time-toggled",
      },
      {
        id: "l1-color-range",
        text: "The Color bar chooses which pictures are mixed (2 or more). Drag its ends to try other sets. Then press Color by time again to go back to single pictures.",
        target: "color-range",
        doneWhen: "color-by-time-toggled",
      },
      {
        id: "l1-brightness",
        text: "Brightness sets where black starts. Slide right to hide faint noise, left to show fainter things along with more noise. Faint movers hide near the dark end.",
        target: "brightness",
        doneWhen: "next",
      },
      {
        id: "l1-wavelength",
        text: "SPHEREx sees many infrared colors. Wavelength rebuilds the pictures from only some of them (Short, Long, Longest, or a single detector D1 to D6). Stars and movers can look different in each.",
        target: "wavelength",
        doneWhen: "next",
      },
      {
        id: "l1-morphology",
        text: "Morphology cleans up or grows bright spots, for example to remove single hot pixels. You can stack steps. It is optional: skip it if the dot is already clear.",
        target: "morphology",
        doneWhen: "next",
      },
      {
        id: "l1-zoom",
        text: "Use + and - to zoom the picture. Zoom in to place a mark exactly on a dot.",
        target: "zoom",
        doneWhen: "next",
      },
    ],
  },
  {
    id: 2,
    title: "Find it",
    spot: "eros",
    objectName: "(433) Eros",
    steps: [
      {
        id: "l2-mark-first",
        text: "Find the dot that jumps. Mark it in one picture.",
        target: "mark-tool",
        doneWhen: "mark-placed",
      },
      {
        id: "l2-mark-second",
        text: "Mark the same dot in another picture where it is still visible. A mover needs marks in at least 2 pictures.",
        target: "frame-picker",
        doneWhen: "mark-placed",
      },
      {
        id: "l2-answer",
        text: "Clear marks removes all your marks so you can start over. Nothing moved here is a valid answer for a spot where nothing moves; something does move here, so do not press it now.",
        target: "answer-panel",
        doneWhen: "next",
      },
      {
        id: "l2-submit",
        text: "Press Submit to check your marks.",
        target: "answer-panel",
        doneWhen: "submitted",
      },
      {
        id: "l2-reveal",
        text: "The dot is (433) Eros. Turn on Inspect, then click the dot to see its name, its place on the sky, how bright it is, and when the picture was taken.",
        target: "inspect-toggle",
        doneWhen: "inspect-opened",
      },
      {
        id: "l2-overlay",
        text: "Turn on Known asteroids. JPL's predicted spots, shown as diamonds, land on the dots you found.",
        target: "overlay-known-asteroids",
        doneWhen: "overlay-toggled",
      },
      {
        id: "l2-wrap",
        text: "In real rounds each find scores points, and the Scoreboard on the right ranks players for that spot and of all time. Achievements track your milestones. Log in (top right) to keep your points and progress on your account.",
        doneWhen: "next",
      },
    ],
  },
];
