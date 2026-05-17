import { chatScenario, createRoomScenario, joinRoomScenario, stressBreakpointScenarios } from "./common.js";

export const options = {
  scenarios: stressBreakpointScenarios(),
  thresholds: {
    checks: ["rate>0.50"],
  },
};

export function createRoomTransaction() {
  createRoomScenario();
}

export function joinRoomTransaction() {
  joinRoomScenario();
}

export function chatTransaction() {
  chatScenario();
}
