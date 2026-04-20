import { useMemo, useState } from "react";
import { ORIGINS, SPECIES, TRAITS } from "../sim/content";
import { useGame } from "../store";
import { Thumb } from "./Thumb";
import { ModifierChip } from "./modifierUi";

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

  const currentSpecies = SPECIES.find((s) => s.id === speciesId);
  const portraitOptions = currentSpecies?.portraits ?? (currentSpecies?.art ? [currentSpecies.art] : []);
  const [portraitArt, setPortraitArt] = useState<string>(portraitOptions[0] ?? "");

  function onSelectSpecies(id: string) {
    setSpeciesId(id);
    const next = originsFor(id);
    if (!next.some((o) => o.id === originId)) {
      setOriginId(next[0].id);
    }
    const species = SPECIES.find((s) => s.id === id);
    const firstPortrait = species?.portraits?.[0] ?? species?.art ?? "";
    setPortraitArt(firstPortrait);
  }

  function start() {
    const seed = (Math.random() * 0xffffffff) >>> 0;
    dispatch({
      type: "newGame",
      empireName: name,
      originId,
      speciesId,
      seed,
      portraitArt,
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
                    <ModifierChip key={i} mod={m} />
                  ))}
                </span>
              )}
              {s.traitIds.length > 0 && (
                <span className="traits">
                  {s.traitIds.map((tid) => {
                    const t = TRAITS.find((x) => x.id === tid);
                    if (!t) return null;
                    return (
                      <span key={tid} className="trait-group" title={t.description}>
                        <span className="trait-name">{t.name}</span>
                        {t.modifiers.map((m, i) => (
                          <ModifierChip key={i} mod={m} />
                        ))}
                      </span>
                    );
                  })}
                </span>
              )}
            </span>
          </button>
        ))}
      </div>

      {portraitOptions.length > 1 && (
        <>
          <label>Portrait</label>
          <div className="portrait-picker">
            {portraitOptions.map((src) => (
              <button
                key={src}
                className={`portrait-option ${src === portraitArt ? "selected" : ""}`}
                onClick={() => setPortraitArt(src)}
                style={{ borderColor: src === portraitArt ? (currentSpecies?.color ?? "var(--accent)") : "var(--border)" }}
              >
                <img src={src} alt="" />
              </button>
            ))}
          </div>
        </>
      )}

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
