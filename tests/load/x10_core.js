import { chatScenario, coreLoadScenarios, coreThresholds, createRoomScenario, joinRoomScenario } from "./common.js";

export const options = {
  scenarios: coreLoadScenarios(10),
  thresholds: coreThresholds("rate<0.10", "p(95)<1000"),
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
