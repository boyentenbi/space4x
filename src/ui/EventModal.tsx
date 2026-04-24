import { eventById } from "../sim/content";
import type { Effect } from "../sim/types";
import { useGame } from "../store";

function effectLabel(effect: Effect): { text: string; sign: "pos" | "neg" | "" } | null {
  switch (effect.kind) {
    case "addResource": {
      const sign = effect.value > 0 ? "pos" : effect.value < 0 ? "neg" : "";
      return { text: `${effect.value > 0 ? "+" : ""}${effect.value} ${effect.resource}`, sign };
    }
    case "addPops":
      return { text: `${effect.value > 0 ? "+" : ""}${effect.value} pops`, sign: effect.value >= 0 ? "pos" : "neg" };
    case "addFlag":
      return { text: `flag: ${effect.flag}`, sign: "" };
    case "removeFlag":
      return { text: `-flag: ${effect.flag}`, sign: "" };
    case "logText":
      return null;
    case "addShips":
      return { text: `+${effect.value} ship${effect.value === 1 ? "" : "s"}`, sign: "pos" };
    case "addDefenders":
      return { text: `+${effect.value} defender${effect.value === 1 ? "" : "s"}`, sign: "pos" };
    case "grantFeatureOnCapital":
    case "grantFeatureOnSecondBody":
      return { text: `install: ${effect.featureId.replace(/_/g, " ")}`, sign: "pos" };
    case "removeFeatureFromCapital":
      return { text: `remove: ${effect.featureId.replace(/_/g, " ")}`, sign: "neg" };
    case "grantStoryModifier":
    case "liftStoryModifier":
      // Story-modifier effects are too varied to label meaningfully
      // in a single chip; the event text itself should describe what
      // they do. Suppress them from the preview.
      return null;
  }
}

export function EventModal({ eventId }: { eventId: string }) {
  const dispatch = useGame((s) => s.dispatch);
  const event = eventById(eventId);
  if (!event) return null;

  // The "big" variant is triggered purely by the event having
  // `art` set. Climactic events (rival, sacrifice, referendum) get
  // near-fullscreen treatment; ordinary events keep the compact
  // modal. One React tree, two CSS skins via the `big` class.
  const big = !!event.art;
  const choices = event.choices.map((c) => {
    const labels = c.effects
      .map(effectLabel)
      .filter((x): x is NonNullable<typeof x> => !!x);
    return { c, labels };
  });

  if (big) {
    return (
      <div className="modal-scrim big-event-scrim" role="dialog" aria-modal="true">
        <div className="big-event-modal">
          <img className="big-event-art" src={event.art} alt="" />
          <div className="big-event-overlay">
            <h2 className="big-event-title">{event.title}</h2>
            <div className="big-event-text">{event.text}</div>
            <div className="big-event-choices">
              {choices.map(({ c, labels }) => (
                <button
                  key={c.id}
                  className="big-event-choice"
                  onClick={() =>
                    dispatch({ type: "resolveEvent", eventId: event.id, choiceId: c.id })
                  }
                >
                  <span className="big-event-choice-text">{c.text}</span>
                  {labels.length > 0 && (
                    <span className="effect-list">
                      {labels.map((l, i) => (
                        <span key={i} className={`effect ${l.sign}`}>{l.text}</span>
                      ))}
                    </span>
                  )}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="modal-scrim" role="dialog" aria-modal="true">
      <div className="modal">
        <h2>{event.title}</h2>
        <div className="event-text">{event.text}</div>
        <div className="choices">
          {choices.map(({ c, labels }) => (
            <button
              key={c.id}
              onClick={() =>
                dispatch({ type: "resolveEvent", eventId: event.id, choiceId: c.id })
              }
            >
              <span>{c.text}</span>
              {labels.length > 0 && (
                <span className="effect-list">
                  {labels.map((l, i) => (
                    <span key={i} className={`effect ${l.sign}`}>{l.text}</span>
                  ))}
                </span>
              )}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
