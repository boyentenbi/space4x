export function PortraitMenu({
  onReset,
  onClose,
}: {
  onReset: () => void;
  onClose: () => void;
}) {
  function confirmReset() {
    if (confirm("Reset game? Your current empire and galaxy will be lost.")) {
      onReset();
      onClose();
    }
  }

  return (
    <div className="modal-scrim" onClick={onClose}>
      <div className="modal menu-modal" onClick={(e) => e.stopPropagation()}>
        <h2>Menu</h2>
        <div className="menu-list">
          <button className="menu-item danger" onClick={confirmReset}>
            Reset Game
          </button>
        </div>
        <button className="close-btn" onClick={onClose}>close</button>
      </div>
    </div>
  );
}
