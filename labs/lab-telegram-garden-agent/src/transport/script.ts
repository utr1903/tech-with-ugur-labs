import type { GardenChatSession } from "../agent/session.js";
import type {
  RecordedToolCall,
  ToolCallRecorder,
} from "../agent/tool-call-recorder.js";
import {
  type GardenSimulator,
  MOISTURE_PERCENT_PER_ML,
} from "../garden/simulator.js";
import type { Logger } from "../logger.js";

export interface ScriptedRunDeps {
  session: GardenChatSession;
  recorder: ToolCallRecorder;
  garden: GardenSimulator;
  logger: Logger;
}

interface ScriptedStep {
  message: string;
  expectedTool: string;
  expectedArgs?: Record<string, unknown>;
  verify?: (context: {
    reply: string;
    turnCalls: RecordedToolCall[];
    garden: GardenSimulator;
    moistureBefore: number;
  }) => string | null; // null = ok, string = failure reason
}

const WATER_AMOUNT_ML = 150;

const STEPS: ScriptedStep[] = [
  {
    message: "What plants do I have?",
    expectedTool: "list_plants",
    verify: ({ reply }) => {
      const missing = [1, 2, 3, 4].filter(
        (id) => !new RegExp(`\\b${id}\\b`).test(reply),
      );
      return missing.length === 0
        ? null
        : `reply does not mention plant ID(s) ${missing.join(", ")}`;
    },
  },
  {
    message: "How warm is plant 3?",
    expectedTool: "measure_temperature",
    expectedArgs: { plantId: 3 },
  },
  {
    message: "What's the humidity of plant 1?",
    expectedTool: "measure_humidity",
    expectedArgs: { plantId: 1 },
  },
  {
    message: `Give plant 2 ${WATER_AMOUNT_ML} ml of water`,
    expectedTool: "put_water",
    expectedArgs: { plantId: 2, amountMl: WATER_AMOUNT_ML },
    verify: ({ garden, moistureBefore }) => {
      const expected =
        moistureBefore + WATER_AMOUNT_ML * MOISTURE_PERCENT_PER_ML;
      const actual = garden.getMoisturePercent(2);
      return Math.abs(actual - expected) < 1e-9
        ? null
        : `plant 2 moisture is ${actual}, expected exactly ${expected}`;
    },
  },
];

function findMatchingCall(
  turnCalls: RecordedToolCall[],
  step: ScriptedStep,
): RecordedToolCall | undefined {
  return turnCalls.find(
    (call) =>
      call.tool === step.expectedTool &&
      Object.entries(step.expectedArgs ?? {}).every(
        ([key, value]) => call.args[key] === value,
      ),
  );
}

// Drives the fixed verification conversation through the real agent code
// path and asserts on recorded tool calls and simulator state — the model's
// prose is checked only where the lab's contract demands it (turn 1's IDs).
export async function runScriptedConversation(
  deps: ScriptedRunDeps,
): Promise<boolean> {
  const { session, recorder, garden, logger } = deps;
  let allPassed = true;

  for (const [index, step] of STEPS.entries()) {
    const turnNumber = index + 1;
    const callsBefore = recorder.calls.length;
    const moistureBefore = garden.getMoisturePercent(2);
    logger.info(
      { turnNumber, message: step.message },
      "Scripted turn starting...",
    );

    const reply = await session.send(step.message);
    const turnCalls = recorder.calls.slice(callsBefore);
    const failures: string[] = [];

    if (findMatchingCall(turnCalls, step) === undefined) {
      failures.push(
        `expected a ${step.expectedTool} call with args ${JSON.stringify(
          step.expectedArgs ?? {},
        )}, recorded: ${JSON.stringify(turnCalls)}`,
      );
    }
    const verifyFailure = step.verify?.({
      reply,
      turnCalls,
      garden,
      moistureBefore,
    });
    if (verifyFailure != null) failures.push(verifyFailure);

    if (failures.length === 0) {
      logger.info({ turnNumber, turnCalls }, "Scripted turn succeeded.");
    } else {
      allPassed = false;
      logger.error({ turnNumber, failures, reply }, "Scripted turn failed.");
    }
  }

  if (allPassed) {
    logger.info(
      { turns: STEPS.length },
      "Scripted verification succeeded. All checks passed.",
    );
  } else {
    logger.error({}, "Scripted verification failed.");
  }
  return allPassed;
}
