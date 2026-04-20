import { useMemo, useState } from "react";
import { ORIGINS, SPECIES } from "../sim/content";
import { useGame } from "../store";
import { Thumb } from "./Thumb";

function originsFor(speciesId: string) {
  return ORIGINS.filter(
    (o) => !o.allowedSpeciesIds || o.allowedSpeciesIds.includes(speciesId),
  );
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
            <Thumb src={s.art} alt={s.name} />
            <span className="row-text">
              <span className="name">
                {s.name}
                <span className="species-swatch" style={{ backgroundColor: s.color }} />
              </span>
              <span className="desc">{s.description}</span>
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
            <Thumb src={o.art} alt={o.name} />
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
