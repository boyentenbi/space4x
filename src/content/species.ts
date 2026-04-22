import type { Species } from "../sim/types";

// Species carry only flavour + politic constraints now. Mechanical
// effects live on origins — species are the "kind of creature you
// are," origins are the "kind of civilisation you became."
export const SPECIES: Species[] = [
  {
    id: "humans",
    name: "Humans",
    description:
      "Adaptable descendants of Old Earth. They fold into any biome, breed in any climate, and recover from setbacks faster than their neighbours realise. A loose constitutional habit keeps them arguing; the arguments keep them moving.",
    traitIds: [],
    art: "/portraits/humans.png",
    portraits: [
      "/portraits/humans.png",
      "/portraits/humans_2.png",
      "/portraits/humans_3.png",
    ],
    color: "#2a5a8c",
    modifiers: [],
  },
  {
    id: "insectoid",
    name: "Insectoid",
    description:
      "A chitinous hive-species that nests vertically as well as horizontally. Cities fit more of them per acre than any other species can manage, and they subsist on less — synchronized shifts leave almost nothing on the plate. Surface-unfriendly worlds hold no terror for them.",
    traitIds: [],
    art: "/portraits/insectoid.png",
    portraits: [
      "/portraits/insectoid.png",
      "/portraits/insectoid_2.png",
      "/portraits/insectoid_3.png",
    ],
    color: "#8b5bc8",
    modifiers: [],
    // Hive-minded: cannot run an individualist politic.
    allowedPolitics: ["collectivist", "centrist"],
  },
  {
    id: "machine",
    name: "Machine Intelligence",
    description:
      "Ruled by networked synthetic minds but populated by a biological workforce. AI administrators coordinate every shift, model every supply chain, and optimize production down to the joule — your people output more per head than any flesh-only rival. Biology still grows at biology's pace, and the machine networks deliberate slowly over any question not purely operational.",
    traitIds: [],
    art: "/portraits/machine.png",
    portraits: [
      "/portraits/machine.png",
      "/portraits/machine_2.png",
      "/portraits/machine_3.png",
    ],
    color: "#62d4e6",
    modifiers: [],
  },
];
