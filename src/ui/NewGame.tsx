import { useState } from "react";
import { ORIGINS, SPECIES } from "../sim/content";
import { useGame } from "../store";

export function NewGame() {
  const dispatch = useGame((s) => s.dispatch);
  const [name, setName] = useState("Nova Directorate");
  const [originId, setOriginId] = useState(ORIGINS[0].id);
  const [speciesId, setSpeciesId] = useState(SPECIES[0].id);

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

      <label>Origin</label>
      <div className="chooser">
        {ORIGINS.map((o) => (
          <button
            key={o.id}
            className={o.id === originId ? "selected" : ""}
            onClick={() => setOriginId(o.id)}
          >
            <span className="name">{o.name}</span>
            <span className="desc">{o.description}</span>
          </button>
        ))}
      </div>

      <label>Species</label>
      <div className="chooser">
        {SPECIES.map((s) => (
          <button
            key={s.id}
            className={s.id === speciesId ? "selected" : ""}
            onClick={() => setSpeciesId(s.id)}
          >
            <span className="name">{s.name}</span>
            <span className="desc">{s.description}</span>
          </button>
        ))}
      </div>

      <button onClick={start} style={{ marginTop: 12 }}>Begin</button>
    </div>
  );
}
