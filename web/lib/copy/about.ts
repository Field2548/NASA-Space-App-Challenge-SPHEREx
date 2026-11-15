export type AboutSection = {
  heading: string;
  paragraphs: string[];
};

export const ABOUT_SECTIONS: AboutSection[] = [
  {
    heading: "How it works",
    paragraphs: [
      "SPHEREx takes pictures of the same patch of sky many times. Each picture is built from a short burst of exposures taken a few minutes apart.",
      "Color by time stacks several moments on top of each other and gives each one its own colour. Things that stay still add up to white. Things that move leave a coloured trail, so a moving asteroid shows up as a row of coloured dots.",
      "Show only changes removes everything that stayed the same, so only the moving parts remain.",
      "For objects that are too faint to see in one picture, shift and stack helps. The computer tries many possible motions, shifts the pictures back along each one, and adds them up. For the right motion, a faint mover's light adds up while the background noise does not.",
    ],
  },
  {
    heading: "Where the data comes from",
    paragraphs: [
      "The pictures come from SPHEREx, a NASA mission. We downloaded them from NASA's IRSA archive (irsa.ipac.caltech.edu).",
      "The positions of the known asteroids and dwarf planets come from JPL Horizons, the NASA JPL ephemeris service. We checked our detections against these predicted positions.",
      "This publication makes use of data products from the Spectro-Photometer for the History of the Universe, Epoch of Reionization and Ices Explorer (SPHEREx), which is a joint project of the Jet Propulsion Laboratory and the California Institute of Technology, and is funded by the National Aeronautics and Space Administration. This research has made use of the NASA/IPAC Infrared Science Archive, which is funded by the National Aeronautics and Space Administration and operated by the California Institute of Technology.",
      "The code is free software under the GNU General Public License, version 3 (GPL-3.0). The full licence is on the Licence page (/licence).",
    ],
  },
  {
    heading: "What we found, honestly",
    paragraphs: [
      "Asteroid (433) Eros is bright and easy to see. Its dots show clearly with Color by time.",
      "Makemake is a faint dwarf planet. We found it blind with shift and stack at 7.9 sigma, which beats a noise bar of 6.4 sigma. Its position matched JPL's prediction.",
      "Eris is much fainter. We found it blind at 6.9 sigma, against a noise bar of 5.9 sigma. That margin is small, only about 1 sigma. We report it as a narrow result, not a sure one.",
      "In an empty control field, where no moving objects are expected, nothing rose above the noise bar at 8.4 sigma. That is the result we wanted from a control field.",
      "Some ideas did not help. We tested each idea on fake stars added to real pictures. A matched filter lowered their signal, so it is off by default. Denoising with random-matrix methods removed many faint sources. Taking the brightest value from each band kept cosmic-ray hits as fake dots.",
    ],
  },
  {
    heading: "How we used AI",
    paragraphs: [
      "This project was built with AI coding agents. Claude Code, an AI coding assistant, helped write much of the code.",
      "Humans set the goals, chose the methods, and checked the results against the data and against JPL's predictions. The AI did not decide what was true.",
    ],
  },
];
