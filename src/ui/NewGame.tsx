import { useMemo, useState } from "react";
import { ORIGINS, SPECIES } from "../sim/content";
import type { Modifier } from "../sim/types";
import { useGame } from "../store";
import { Thumb } from "./Thumb";

function originsFor(speciesId: string) {
  return ORIGINS.filter(
    (o) => !o.allowedSpeciesIds || o.allowedSpeciesIds.includes(speciesId),
  );
}

// Human-readable one-liner for each modifier kind. Used for summary rows on
// species cards. Trait descriptions override this — traits carry their own prose.
function describeModifier(mod: Modifier): string {
  switch (mod.kind) {
    case "perPop":
      return `${mod.value > 0 ? "+" : ""}${mod.value} ${mod.resource}/pop`;
    case "flat":
      return `${mod.value > 0 ? "+" : ""}${mod.value} ${mod.resource}/turn`;
    case "popGrowthMult": {
      const pct = Math.round((mod.value - 1) * 100);
      return `${pct > 0 ? "+" : ""}${pct}% pop growth`;
    }
    case "spaceMult": {
      const pct = Math.round((mod.value - 1) * 100);
      return `${pct > 0 ? "+" : ""}${pct}% body space`;
    }
    case "colonizeHammerMult": {
      const pct = Math.round((mod.value - 1) * 100);
      return `${pct > 0 ? "+" : ""}${pct}% colonize cost`;
    }
    case "foodUpkeepDelta":
      return `${mod.value > 0 ? "+" : ""}${mod.value} food upkeep/pop`;
    case "hammersPerPopDelta":
      return `${mod.value > 0 ? "+" : ""}${mod.value} hammers/pop`;
    case "habBonus":
      return `${mod.value > 0 ? "+" : ""}${mod.value} ${mod.resource} on ${mod.habitability}`;
  }
}

export function NewGame() {
  const dispatch = useGame((s) => s.dispatch);
  const [name, setName] = useState("Nova Directorate");
  const [speciesId, setSpeciesId] = useState(SPECIES[0].id);
  const validOrigins = useMemo(() => originsFor(speciesId), [speciesId]);
  const [originId, setOriginId] = useState(validOrigins[0].id);

  function onSelectSpecies(id: string) {
    setSpeciesId(id);
    const next = originsFor(id);
    if (!next.some((o) => o.id === originId)) {
      setOriginId(next[0].id);
    }
  }

  function start() {
    const seed = (Math.random() * 0xffffffff) >>> 0;
    dispatch({
      type: "newGame",
      empireName: name,
      originId,
      speciesId,
      seed,
    });
  }

  return (
    <div className="new-game">
      <h2>space4x</h2>

      <label>
        Empire Name
        <input value={name} onChange={(e) => setName(e.target.value)} />
      </label>

      <label>Species</label>
      <div className="chooser">
        {SPECIES.map((s) => (
          <button
            key={s.id}
            className={`row species-row ${s.id === speciesId ? "selected" : ""}`}
            onClick={() => onSelectSpecies(s.id)}
            style={{ borderLeftColor: s.color, borderLeftWidth: 4, borderLeftStyle: "solid" }}
          >
            <Thumb src={s.art} alt={s.name} size={84} />
            <span className="row-text">
              <span className="name">
                {s.name}
                <span className="species-swatch" style={{ backgroundColor: s.color }} />
              </span>
              <span className="desc">{s.description}</span>
              {s.modifiers.length > 0 && (
                <span className="bonuses">
                  {s.modifiers.map((m, i) => (
                    <span key={i} className="bonus-chip">{describeModifier(m)}</span>
                  ))}
                </span>
              )}
            </span>
          </button>
        ))}
      </div>

      <label>Origin</label>
      <div className="chooser">
        {validOrigins.map((o) => (
          <button
            key={o.id}
            className={`row ${o.id === originId ? "selected" : ""}`}
            onClick={() => setOriginId(o.id)}
          >
            <Thumb src={o.art} alt={o.name} size={84} />
            <span className="row-text">
              <span className="name">{o.name}</span>
              <span className="desc">{o.description}</span>
            </span>
          </button>
        ))}
      </div>

      <button onClick={start} style={{ marginTop: 12 }}>Begin</button>

      <div className="version-tag" style={{ alignSelf: "center" }}>
        {__APP_VERSION__}
      </div>
    </div>
  );
}
