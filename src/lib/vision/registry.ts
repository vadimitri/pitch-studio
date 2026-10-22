// The most recently created Vision, so the ?debug=1 overlay can find it without prop drilling.
import { createStore } from "../store";
import type { Vision } from "./index";

export const activeVision = createStore<Vision | null>(null);
