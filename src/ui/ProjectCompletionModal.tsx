import { projectById } from "../sim/content";
import type { EmpireProject } from "../sim/types";
import { ModifierChip } from "./modifierUi";

export function ProjectCompletionModal({
  projectId,
  turn,
  onDismiss,
}: {
  projectId: string;
  turn: number;
  onDismiss: () => void;
}) {
  const proj: EmpireProject | undefined = projectById(projectId);
  if (!proj) {
    return (
      <div className="modal-scrim" onClick={onDismiss}>
        <div className="modal" onClick={(e) => e.stopPropagation()}>
          <h2>Project Complete</h2>
          <button className="close-btn" onClick={onDismiss}>continue</button>
        </div>
      </div>
    );
  }

  const grantEntries = proj.onComplete.grantStoryModifiers
    ? Object.entries(proj.onComplete.grantStoryModifiers)
    : [];
  const removedKeys = proj.onComplete.removeStoryModifierKeys ?? [];

  return (
    <div className="modal-scrim" onClick={onDismiss}>
      <div className="modal project-completion" onClick={(e) => e.stopPropagation()}>
        <div className="completion-head">
          {proj.art && <img className="completion-art" src={proj.art} alt="" />}
          <div>
            <div className="completion-label">Turn {turn} · Project Complete</div>
            <h2>{proj.name}</h2>
          </div>
        </div>
        <div className="event-text">{proj.onComplete.chronicle}</div>
        {grantEntries.length > 0 && (
          <div className="completion-section">
            <div className="completion-section-label">Permanent effects</div>
            <div className="bonuses">
              {grantEntries.flatMap(([key, mods]) =>
                mods.map((m, i) => <ModifierChip key={`${key}-${i}`} mod={m} />),
              )}
            </div>
          </div>
        )}
        {removedKeys.length > 0 && (
          <div className="completion-section">
            <div className="completion-section-label">Lifted</div>
            <div className="bonuses">
              {removedKeys.map((k) => (
                <span key={k} className="bonus-chip pos">
                  {k.replace(/_/g, " ")} penalty lifted
                </span>
              ))}
            </div>
          </div>
        )}
        <button className="close-btn" onClick={onDismiss}>continue</button>
      </div>
    </div>
  );
}
