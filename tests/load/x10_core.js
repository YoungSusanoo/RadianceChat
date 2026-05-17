import { chatScenario, coreLoadScenarios, coreThresholds, createRoomScenario, joinRoomScenario } from "./common.js";

export const options = {
  scenarios: coreLoadScenarios(10),
  thresholds: coreThresholds("rate<0.25", "p(95)<5000"),
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
