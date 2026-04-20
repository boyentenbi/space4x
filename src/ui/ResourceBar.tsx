import type { Resources, ResourceKey } from "../sim/types";

const ORDER: { key: ResourceKey; label: string }[] = [
  { key: "food", label: "Food" },
  { key: "energy", label: "Energy" },
  { key: "alloys", label: "Alloys" },
  { key: "influence", label: "Influence" },
];

export function ResourceBar({ resources }: { resources: Resources }) {
  return (
    <div className="resources">
      {ORDER.map(({ key, label }) => (
        <div className="resource" key={key}>
          <div className="label">{label}</div>
          <div className="value">{Math.round(resources[key])}</div>
        </div>
      ))}
    </div>
  );
}
