import { chatScenario, coreThresholds, createRoomScenario, joinRoomScenario } from "./common.js";

export const options = {
  scenarios: {
    create_room_smoke: {
      executor: "constant-vus",
      exec: "createRoomTransaction",
      vus: 1,
      duration: "30s",
    },
    join_room_smoke: {
      executor: "constant-vus",
      exec: "joinRoomTransaction",
      vus: 1,
      duration: "30s",
    },
    chat_smoke: {
      executor: "constant-vus",
      exec: "chatTransaction",
      vus: 1,
      duration: "30s",
    },
  },
  thresholds: coreThresholds("rate<0.02", "p(95)<1000"),
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
