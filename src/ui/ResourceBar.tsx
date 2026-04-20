import type { Resources, ResourceKey } from "../sim/types";

const ORDER: { key: ResourceKey; label: string }[] = [
  { key: "food", label: "Food" },
  { key: "energy", label: "Energy" },
  { key: "alloys", label: "Alloys" },
  { key: "influence", label: "Influence" },
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
      {ORDER.map(({ key, label }) => {
        const d = deltas?.[key] ?? 0;
        const cls = d > 0 ? "pos" : d < 0 ? "neg" : "";
        return (
          <div className="resource" key={key}>
            <div className="label">{label}</div>
            <div className="value">{Math.round(resources[key])}</div>
            {deltas && <div className={`delta ${cls}`}>{fmtDelta(d)}</div>}
          </div>
        );
      })}
    </div>
  );
}
