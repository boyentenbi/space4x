import { useGame } from "../store";
import { NewGame } from "./NewGame";
import { MainScreen } from "./MainScreen";

export function App() {
  const state = useGame((s) => s.state);
  const started = state.turn > 0 && state.empires.length > 0;
  return <div className="app">{started ? <MainScreen /> : <NewGame />}</div>;
}
