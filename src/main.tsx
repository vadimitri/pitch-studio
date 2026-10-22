import { createRoot } from "react-dom/client";
import "./styles/neo.css";
import "./styles/ui.css";
import "./styles/app.css";
import { App } from "./App";

createRoot(document.getElementById("root")!).render(<App />);
