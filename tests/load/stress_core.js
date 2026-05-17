import { chatScenario, coreThresholds, createRoomScenario, joinRoomScenario, stressStages } from "./common.js";

export const options = {
  scenarios: {
    create_room_stress: {
      executor: "ramping-vus",
      exec: "createRoomTransaction",
      stages: stressStages(4),
    },
    join_room_stress: {
      executor: "ramping-vus",
      exec: "joinRoomTransaction",
      stages: stressStages(4),
    },
    chat_stress: {
      executor: "ramping-vus",
      exec: "chatTransaction",
      stages: stressStages(8),
    },
  },
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
