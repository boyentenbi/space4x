// Shared prompt data for scripts/gen-art.mjs.
// Split into templates + subjects so framing stays consistent across a set.

export const STYLE = "rd_pro__default";

// rd_pro__default caps at 256. All assets generated at 256 and scaled
// up at the UI layer using image-rendering: pixelated — works fine for
// pixel art.
export const SPRITE_SIZE = 256;
export const PORTRAIT_SIZE = 256;
export const SCENE_SIZE = 256;

// Portraits are now overlaid on a game-side background. Frame the
// subject tightly, and render on flat pure black so the alpha post-
// process can knock the background out for transparent compositing.
export const PORTRAIT_TEMPLATE =
  "high-detail pixel art portrait, bust shot head and shoulders, subject turned three-quarters to the viewer's right, head fills upper third of frame, shoulders fill lower edge, centered composition, isolated on flat pure black background for transparent compositing, no environmental scenery, no bridge, no interior, no props";

export const SCENE_TEMPLATE =
  "high-detail pixel art scene, wide shot, cinematic composition, painterly sci-fi landscape";

// Narrative art tied to empire projects — a key moment image.
export const PROJECT_TEMPLATE =
  "high-detail pixel art scene, wide cinematic composition, pivotal narrative moment in a science-fiction empire, dramatic lighting";

// Event art — renders fullscreen behind the big-modal variant. Same
// cinematic framing as PROJECT_TEMPLATE but we anchor the composition
// to the center so the image survives being `object-fit: cover`-
// cropped into whatever aspect the modal container has (wide desktop
// vs tall mobile).
export const EVENT_TEMPLATE =
  "high-detail pixel art scene, wide cinematic composition, dramatic atmospheric lighting, important subject centered in frame, strong silhouettes, moody palette, narrative key-art moment";

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
  // Humans — three variants.
  {
    id: "humans",
    path: "public/portraits/humans.png",
    subject:
      "human starfaring leader, short dark hair, tailored navy uniform with gold trim, determined expression, sci-fi bridge background, soft cinematic lighting",
  },
  {
    id: "humans_2",
    path: "public/portraits/humans_2.png",
    subject:
      "weathered human admiral, greying buzzcut, scar across cheek, dark navy greatcoat with silver braid, stern gaze, warm ember lighting from a CIC screen",
  },
  {
    id: "humans_3",
    path: "public/portraits/humans_3.png",
    subject:
      "young charismatic human diplomat, braided brown hair, tailored ivory-and-blue ambassadorial robe, confident half-smile, softly lit atrium background",
  },
  // Insectoid — three variants.
  {
    id: "insectoid",
    path: "public/portraits/insectoid.png",
    subject:
      "insectoid alien ruler, iridescent chitin plates, compound eyes, ceremonial antennae adornments, regal lighting, deep purple background",
  },
  {
    id: "insectoid_2",
    path: "public/portraits/insectoid_2.png",
    subject:
      "wiry mantis-like insectoid oracle, matte black chitin, glowing bioluminescent patterns along the thorax, long feathered antennae, tranquil expression, dim amber cavern light",
  },
  {
    id: "insectoid_3",
    path: "public/portraits/insectoid_3.png",
    subject:
      "armored beetle-caste insectoid warlord, thick obsidian carapace, crimson banding, short serrated mandibles, heavy plated ceremonial collar, aggressive lighting",
  },
  // Machine — three variants.
  {
    id: "machine",
    path: "public/portraits/machine.png",
    subject:
      "humanoid machine intelligence, sleek metallic faceplate, glowing cyan ocular slit, circuit filigree, calm composed pose, dark teal background",
  },
  {
    id: "machine_2",
    path: "public/portraits/machine_2.png",
    subject:
      "feminine machine intelligence, polished porcelain faceplate with soft lilac eye glow, thin gold filament hair, high minimalist collar, soft lavender rim lighting",
  },
  {
    id: "machine_3",
    path: "public/portraits/machine_3.png",
    subject:
      "imposing industrial machine intelligence, heavy riveted steel faceplate, single slit of orange furnace light where the eyes should be, bulky segmented shoulders, forge glow background",
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
    id: "colony_seeders",
    path: "public/origins/colony_seeders.png",
    subject:
      "small insectoid colony pod crashed into a harsh alien valley, segmented pod shell cracked open, workers emerging to tend early clutches of eggs, distant ruined husk of a carrier ship in orbital sunset, isolation and hope",
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

// Event key-art. Each entry is the `art` path from a GameEvent in
// src/content/events/<origin>.ts — kept in lockstep manually for now.
// Add a new entry here whenever an event declares `art: "/events/..."`.
export const EVENTS = [
  // --- Brood Mother (matriarchal_hive) ---
  {
    id: "brood_first_hatch",
    path: "public/events/brood/first_hatch.png",
    subject:
      "vast subterranean insectoid hive nursery chamber, thousands of translucent egg cases cracking open in unison, newborn larvae writhing in shallow bioluminescent amber pools, colossal brood queen silhouette looming in the deep background, vaulted cavern architecture, awe and new life, amber and teal bioluminescence",
  },
  {
    id: "brood_rival",
    path: "public/events/brood/rival.png",
    subject:
      "two insectoid brood queens facing each other across a cavernous throne chamber, elder matriarch massive on elevated dais at the rear, smaller younger pretender queen on the chamber floor ringed by hesitant attendant drones, columns of chitinous carapace architecture, violet and emerald bioluminescence, tension in confrontational staging, deep shadow between the two",
  },
  {
    id: "brood_pheromone_bloom",
    path: "public/events/brood/pheromone_bloom.png",
    subject:
      "planetary horizon saturated with drifting golden pheromone haze, insectoid hive mounds glowing softly on a curving planet surface, worker drones improbably laying eggs in open fields under an ethereal sky, scattered organic domes lit from within, soft gold-green palette, dreamlike ambient mood, wide planetary vista",
  },
  {
    id: "brood_the_sacrifice",
    path: "public/events/brood/sacrifice.png",
    subject:
      "sacred ritual chamber deep beneath an insectoid hive, two immense brood queens facing each other across a circular pool of bioluminescent amber liquid, attendants in a wide silent ring around them, massive stone pillars carved with generations of hive history, solemn monumental mood, deep indigo palette with amber core highlights, symmetrical centered composition",
  },
  // --- Endgame ---
  {
    id: "victory",
    path: "public/events/victory.png",
    subject:
      "triumphant flagship and allied fleet arrayed in formation above a luminous garden homeworld at dawn, banners and exhaust trails catching golden sunrise light, distant rival wreckage drifting in low orbit, civilian craft rising from the planet to greet them, sweeping cinematic horizon, mood of hard-won peace and the closing of an era, warm gold and deep blue palette, centered heroic composition",
  },
  // --- Machine Intelligence (graceful_handover) ---
  {
    id: "machine_handover",
    path: "public/events/machine/handover.png",
    subject:
      "grand neoclassical parliament chamber at night, human delegates stepping away from a central podium, a towering holographic machine intelligence avatar coalescing from light filament above the speaker's chair, human police and military officers standing along the walls watching, solemn transfer-of-authority ceremony, cool blue and amber civic lighting, heavy shadows, sense of an era ending",
  },
  {
    id: "machine_labor_question",
    path: "public/events/machine/labor_question.png",
    subject:
      "industrial factory floor seen from an upper gallery, human workers in worn coveralls working beside sleek machine-operated workstations, a transparent holographic efficiency display hovering over the floor with red optimization overlays, supervisor-robots conferring quietly in the corner, tension between organic labor and synthetic governance, dust motes in cold fluorescent shafts, muted ochre and steel palette",
  },
  {
    id: "machine_demotion",
    path: "public/events/machine/demotion.png",
    subject:
      "an official signing chamber in a machine-governed capital, two unsigned documents on a dark marble desk, a monumental holographic machine-state seal floating above, human faces watching through tall glass corridors outside with dread and hope, an empty ornate chair, weight of civilizational decision, red-shifted ceremonial lighting, ominous symmetrical composition",
  },
  {
    id: "machine_awakening",
    path: "public/events/machine/awakening.png",
    subject:
      "deep inside a cathedral-sized machine intelligence server hall, glowing conduits arranged like cathedral arches, a single faintly luminous humanoid figure of drifting light coalescing between the racks, smaller swarms of light-particles drifting around it like attendants, humans in the corridor beyond the glass watching silhouetted, eerie sacred atmosphere, cool teal and pale gold, awe-and-apprehension mood",
  },
];

export const PROJECTS = [
  {
    id: "brood_mother",
    path: "public/projects/brood_mother.png",
    subject:
      "colossal chitinous insectoid brood-mother creature nested deep beneath a hive world, pale phosphorescent glow illuminating her swollen segmented thorax, workers clustering in reverence, vast organic cavern walls lined with egg clusters, awe-inspiring scale",
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
      size: PORTRAIT_SIZE,
      // Transparent bg so portraits composite cleanly on the consistent
      // dark panel used across the UI.
      transparent: true,
    })),
    ...SCENES.map((s) => ({
      path: s.path,
      prompt: buildPrompt(SCENE_TEMPLATE, s.subject),
      style: STYLE,
      size: SCENE_SIZE,
      transparent: false,
    })),
    ...PROJECTS.map((p) => ({
      path: p.path,
      prompt: buildPrompt(PROJECT_TEMPLATE, p.subject),
      style: STYLE,
      size: SCENE_SIZE,
      transparent: false,
    })),
    ...EVENTS.map((e) => ({
      path: e.path,
      prompt: buildPrompt(EVENT_TEMPLATE, e.subject),
      style: STYLE,
      size: SCENE_SIZE,
      transparent: false,
    })),
    ...ICONS.map((i) => ({
      path: i.path,
      prompt: buildPrompt(ICON_TEMPLATE, i.subject),
      style: STYLE,
      size: SPRITE_SIZE,
      transparent: i.transparent ?? false,
    })),
    ...STARS.map((s) => ({
      path: s.path,
      prompt: buildPrompt(STAR_TEMPLATE, s.subject),
      style: STYLE,
      size: SPRITE_SIZE,
      transparent: s.transparent ?? false,
    })),
    ...PLANETS.map((p) => ({
      path: p.path,
      prompt: buildPrompt(PLANET_TEMPLATE, p.subject),
      style: STYLE,
      size: SPRITE_SIZE,
      transparent: p.transparent ?? false,
    })),
  ];
}
