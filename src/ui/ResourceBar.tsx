import type { Resources, ResourceKey } from "../sim/types";

const ORDER: { key: ResourceKey; label: string; icon: string }[] = [
  { key: "food",      label: "Food",     icon: "/icons/food.png" },
  { key: "energy",    label: "Energy",   icon: "/icons/energy.png" },
  { key: "alloys",    label: "Alloys",   icon: "/icons/alloys.png" },
  { key: "political", label: "Pol. Cap.", icon: "/icons/political.png" },
];

function fmtDelta(n: number): string {
  if (n > 0) return `+${Math.round(n * 10) / 10}`;
  return `${Math.round(n * 10) / 10}`;
}

export function ResourceBar({
  resources,
  deltas,
}: {
  resources: Resources;
  deltas?: Resources;
}) {
  return (
    <div className="resources">
      {ORDER.map(({ key, label, icon }) => {
        const d = deltas?.[key] ?? 0;
        const cls = d > 0 ? "pos" : d < 0 ? "neg" : "";
        return (
          <div className="resource" key={key}>
            <img className="res-icon" src={icon} alt="" />
            <div className="label">{label}</div>
            <div className="value">{Math.round(resources[key])}</div>
            {deltas && <div className={`delta ${cls}`}>{fmtDelta(d)}</div>}
          </div>
        );
      })}
    </div>
  );
}
