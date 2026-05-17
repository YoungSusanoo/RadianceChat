import { chatScenario, createRoomScenario, joinRoomScenario, stressScenarios } from "./common.js";

export const options = {
  scenarios: stressScenarios(),
  // Stress testing searches for the degradation point. The report threshold is
  // observed in the summary/graphs: when http_req_failed exceeds 25%, the
  // current VU/RPS level is recorded as the breaking point.
  thresholds: {
    checks: ["rate>0.25"],
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
