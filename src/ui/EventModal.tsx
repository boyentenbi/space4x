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
  }
}

export function EventModal({ eventId }: { eventId: string }) {
  const dispatch = useGame((s) => s.dispatch);
  const event = eventById(eventId);
  if (!event) return null;

  return (
    <div className="modal-scrim" role="dialog" aria-modal="true">
      <div className="modal">
        <h2>{event.title}</h2>
        <div className="event-text">{event.text}</div>
        <div className="choices">
          {event.choices.map((c) => {
            const labels = c.effects.map(effectLabel).filter((x): x is NonNullable<typeof x> => !!x);
            return (
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
            );
          })}
        </div>
      </div>
    </div>
  );
}
