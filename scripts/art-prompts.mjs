// Shared prompt data for scripts/gen-art.mjs.
// Split into templates + subjects so framing stays consistent across a set.

export const STYLE = "rd_pro__default";
export const SIZE = 256;

// Enforces: three-quarter right pose, consistent head/shoulder framing, dark vignette.
export const PORTRAIT_TEMPLATE =
  "pixel art portrait, bust shot head and shoulders, subject turned three-quarters to the viewer's right, head fills upper third of frame, shoulders fill lower edge, centered composition, dark vignette background";

export const SCENE_TEMPLATE =
  "pixel art scene, wide shot, cinematic composition, painterly sci-fi landscape";

// Small UI icons — square, crisp edges, transparent-ready.
// We ask for a flat pure black background so the post-process alpha mask
// can cleanly knock it out.
export const ICON_TEMPLATE =
  "pixel art game UI icon, single object centered in frame, crisp edges, bold silhouette, isolated object on flat pure black background for transparent compositing, no borders, no text, no checkered pattern, 256x256";

// Star sprites — the object fills most of the frame, pure black space behind it.
// "astronomical sun" / "stellar photosphere" nudges models away from the 5-pointed
// geometric-star glyph interpretation.
export const STAR_TEMPLATE =
  "pixel art sprite of an astronomical sun, spherical stellar photosphere with granulation, glowing corona, isolated on flat pure black background for transparent compositing, no geometric star shape, no 5-pointed star, no planets, no text, 256x256";

// Planet sprites — spherical body in the center, black space behind.
export const PLANET_TEMPLATE =
  "pixel art sprite of a planet, single spherical body centered and filling frame, subtle shading on the lit side, isolated on flat pure black background for transparent compositing, no ships, no text, no moons, 256x256";

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

export const ICONS = [
  {
    id: "food",
    path: "public/icons/food.png",
    subject: "single bright green apple fruit, round, with a small brown stem at the top, glossy highlight, no leaves, no tree, no scenery",
    transparent: true,
  },
  {
    id: "energy",
    path: "public/icons/energy.png",
    subject: "stylized lightning bolt, bright warm yellow glow",
    transparent: true,
  },
  {
    id: "alloys",
    path: "public/icons/alloys.png",
    subject: "stack of three refined metal ingots, cool silver tones with faint blue sheen",
    transparent: true,
  },
  {
    id: "political",
    path: "public/icons/political.png",
    subject: "waving flag on a pole, bold red banner with gold trim",
    transparent: true,
  },
  {
    id: "compute",
    path: "public/icons/compute.png",
    subject: "single silicon microprocessor CPU chip seen from above, black square package with metallic pins on all four sides, glowing teal core dot in the center, tilted slight perspective, no background elements, no traces outside the chip",
    transparent: true,
  },
  {
    id: "hammers",
    path: "public/icons/hammers.png",
    subject: "crossed industrial hammers, burnt orange metal with worn wooden handles, bold silhouette",
    transparent: true,
  },
  {
    id: "pops",
    path: "public/icons/pops.png",
    subject: "three stylized humanoid bust silhouettes clustered together, pale cream tones, representing a civic population group, bold silhouette, no facial detail",
    transparent: true,
  },
];

export const STARS = [
  {
    id: "yellow_main",
    path: "public/stars/yellow_main.png",
    subject: "yellow G-type main-sequence sun, golden-white spherical surface with faint sunspots and bright granulation, soft orange corona",
    transparent: true,
  },
  {
    id: "red_dwarf",
    path: "public/stars/red_dwarf.png",
    subject: "small dim red dwarf star, deep crimson surface, subtle dull glow",
    transparent: true,
  },
  {
    id: "blue_giant",
    path: "public/stars/blue_giant.png",
    subject: "massive blue giant star, brilliant white-blue core, bright cyan corona, dense glow",
    transparent: true,
  },
];

export const PLANETS = [
  // Garden variants
  {
    id: "garden",
    path: "public/planets/garden.png",
    subject: "lush garden world, vibrant blue oceans, green continents, swirling white cloud bands",
    transparent: true,
  },
  {
    id: "garden_2",
    path: "public/planets/garden_2.png",
    subject: "tropical garden world, cyan seas dotted with archipelagos, dense emerald jungle, wispy equatorial clouds",
    transparent: true,
  },
  {
    id: "garden_3",
    path: "public/planets/garden_3.png",
    subject: "island world, small scattered archipelagos across a deep blue ocean, turquoise coastlines, broken cloud layer",
    transparent: true,
  },
  // Temperate variants
  {
    id: "temperate",
    path: "public/planets/temperate.png",
    subject: "temperate planet, tan and dusty-green continents, scattered clouds, some small seas",
    transparent: true,
  },
  {
    id: "temperate_2",
    path: "public/planets/temperate_2.png",
    subject: "savannah planet, russet plains and dry yellow grasslands, thin cirrus cloud bands, narrow rivers",
    transparent: true,
  },
  {
    id: "temperate_3",
    path: "public/planets/temperate_3.png",
    subject: "dusty earthlike planet, golden ochre continents across a steel-blue ocean, patchy clouds",
    transparent: true,
  },
  // Harsh variants
  {
    id: "harsh",
    path: "public/planets/harsh.png",
    subject: "harsh arid planet, rust-red cratered surface, thin dusty atmosphere, barren",
    transparent: true,
  },
  {
    id: "harsh_2",
    path: "public/planets/harsh_2.png",
    subject: "frozen ice world, blue-white cracked surface, pale atmospheric haze, glacial plains",
    transparent: true,
  },
  {
    id: "harsh_3",
    path: "public/planets/harsh_3.png",
    subject: "dust-storm planet, ochre swirling winds across a cratered brown surface, thin golden atmosphere",
    transparent: true,
  },
  // Hellscape variants
  {
    id: "hellscape",
    path: "public/planets/hellscape.png",
    subject: "volcanic hellscape planet, dark crust cracked with glowing lava flows, angry red atmosphere",
    transparent: true,
  },
  {
    id: "hellscape_2",
    path: "public/planets/hellscape_2.png",
    subject: "acid-rain world, sulfurous yellow-green atmosphere, churning thick cloud layer, no visible surface",
    transparent: true,
  },
  {
    id: "hellscape_3",
    path: "public/planets/hellscape_3.png",
    subject: "shattered moon world, dark cratered crust laced with glowing magma fissures, broken crescent ring of debris",
    transparent: true,
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
      transparent: false,
    })),
    ...SCENES.map((s) => ({
      path: s.path,
      prompt: buildPrompt(SCENE_TEMPLATE, s.subject),
      style: STYLE,
      size: SIZE,
      transparent: false,
    })),
    ...ICONS.map((i) => ({
      path: i.path,
      prompt: buildPrompt(ICON_TEMPLATE, i.subject),
      style: STYLE,
      size: SIZE,
      transparent: i.transparent ?? false,
    })),
    ...STARS.map((s) => ({
      path: s.path,
      prompt: buildPrompt(STAR_TEMPLATE, s.subject),
      style: STYLE,
      size: SIZE,
      transparent: s.transparent ?? false,
    })),
    ...PLANETS.map((p) => ({
      path: p.path,
      prompt: buildPrompt(PLANET_TEMPLATE, p.subject),
      style: STYLE,
      size: SIZE,
      transparent: p.transparent ?? false,
    })),
  ];
}
