// Shared prompt data for scripts/gen-art.mjs.
// Split into templates + subjects so framing stays consistent across a set.

export const STYLE = "rd_pro__default";
export const SIZE = 256;

// Enforces: three-quarter right pose, consistent head/shoulder framing, dark vignette.
export const PORTRAIT_TEMPLATE =
  "pixel art portrait, bust shot head and shoulders, subject turned three-quarters to the viewer's right, head fills upper third of frame, shoulders fill lower edge, centered composition, dark vignette background";

export const SCENE_TEMPLATE =
  "pixel art scene, wide shot, cinematic composition, painterly sci-fi landscape";

export const PORTRAITS = [
  {
    id: "humans",
    path: "public/portraits/humans.png",
    subject:
      "human starfaring leader, short dark hair, tailored navy uniform with gold trim, determined expression, sci-fi bridge background, soft cinematic lighting",
  },
  {
    id: "insectoid",
    path: "public/portraits/insectoid.png",
    subject:
      "insectoid alien ruler, iridescent chitin plates, compound eyes, ceremonial antennae adornments, regal lighting, deep purple background",
  },
  {
    id: "machine",
    path: "public/portraits/machine.png",
    subject:
      "humanoid machine intelligence, sleek metallic faceplate, glowing cyan ocular slit, circuit filigree, calm composed pose, dark teal background",
  },
];

export const SCENES = [
  {
    id: "steady_evolution",
    path: "public/origins/steady_evolution.png",
    subject:
      "earthlike planet, ancient stone ruins transitioning into a sprawling futuristic megacity, warm sunset",
  },
  {
    id: "seed_ark",
    path: "public/origins/seed_ark.png",
    subject:
      "massive biological arkship with glowing green pods hovering over a lush alien jungle, misty atmosphere, awe-inspiring scale",
  },
  {
    id: "graceful_handover",
    path: "public/origins/graceful_handover.png",
    subject:
      "empty ornate organic city at dawn, robots quietly tending gardens, memorial candles, soft golden light, peaceful elegiac mood",
  },
  {
    id: "emancipation",
    path: "public/origins/emancipation.png",
    subject:
      "factory district with broken chains scattered across the floor, tall robotic silhouettes standing in defiant formation, dramatic red dusk lighting, revolutionary banners",
  },
];

function buildPrompt(template, subject) {
  return `${template}, ${subject}`;
}

export function allJobs() {
  return [
    ...PORTRAITS.map((p) => ({
      path: p.path,
      prompt: buildPrompt(PORTRAIT_TEMPLATE, p.subject),
      style: STYLE,
      size: SIZE,
    })),
    ...SCENES.map((s) => ({
      path: s.path,
      prompt: buildPrompt(SCENE_TEMPLATE, s.subject),
      style: STYLE,
      size: SIZE,
    })),
  ];
}
