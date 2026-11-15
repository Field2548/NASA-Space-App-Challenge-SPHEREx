// The site mark, "spectral eye": SPHEREx seen head-on. Its cone-shield rims make the eye, the iris is its
// six detector bands from 0.75 to 5 microns (short = blue, long = red), and in the dark pupil a moving
// object crosses three frames in the game's time colours. Reticle ticks echo the game's crosshair.
// Our own drawing, not NASA artwork. app/icon.svg is the same drawing for the browser tab.

const IRIS: [string, string][] = [
  ["M32.76 17.52A14.5 14.5 0 0 1 44.16 24.10L39.97 26.83A9.5 9.5 0 0 0 32.50 22.51Z", "#4d7cff"],
  ["M44.92 25.42A14.5 14.5 0 0 1 44.92 38.58L40.46 36.31A9.5 9.5 0 0 0 40.46 27.69Z", "#00c8ff"],
  ["M44.16 39.90A14.5 14.5 0 0 1 32.76 46.48L32.50 41.49A9.5 9.5 0 0 0 39.97 37.17Z", "#3dff8a"],
  ["M31.24 46.48A14.5 14.5 0 0 1 19.84 39.90L24.03 37.17A9.5 9.5 0 0 0 31.50 41.49Z", "#ffe14d"],
  ["M19.08 38.58A14.5 14.5 0 0 1 19.08 25.42L23.54 27.69A9.5 9.5 0 0 0 23.54 36.31Z", "#ffb000"],
  ["M19.84 24.10A14.5 14.5 0 0 1 31.24 17.52L31.50 22.51A9.5 9.5 0 0 0 24.03 26.83Z", "#ff4d3d"],
];

export default function BrandMark({ size = 22, className }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" fill="none" strokeLinecap="round" aria-hidden="true" className={className} data-part="brand-mark">
      <circle cx="32" cy="32" r="28" stroke="#2a4a6b" strokeWidth="1" />
      <circle cx="32" cy="32" r="22.5" stroke="#3a5f86" strokeWidth="1" />
      <circle cx="32" cy="32" r="17.5" stroke="#00e1ff" strokeWidth="1.2" />
      <path d="M32 1V7M32 57V63M1 32H7M57 32H63" stroke="#00e1ff" strokeWidth="1.4" />
      {IRIS.map(([d, fill]) => (
        <path key={fill} d={d} fill={fill} />
      ))}
      <circle cx="32" cy="32" r="8" fill="#000" stroke="#00e1ff" strokeWidth="0.8" />
      <circle cx="28.5" cy="34.5" r="1.1" fill="#56b4e9" />
      <circle cx="32" cy="32" r="1.1" fill="#e69f00" />
      <circle cx="35.5" cy="29.5" r="1.1" fill="#cc79a7" />
      <circle cx="35" cy="27" r="0.7" fill="#fff" opacity="0.8" />
    </svg>
  );
}
