import { expect, it } from "vitest";
import { ExecutionSlots } from "./slots.js";

it("admits two executions and transfers capacity in FIFO order", async () => {
  const slots = new ExecutionSlots();
  const first = await slots.acquire(Date.now() + 500);
  const second = await slots.acquire(Date.now() + 500);
  const admitted: number[] = [];
  const third = slots.acquire(Date.now() + 500).then((release) => {
    admitted.push(3);
    return release;
  });
  const fourth = slots.acquire(Date.now() + 500).then((release) => {
    admitted.push(4);
    return release;
  });
  await Promise.resolve();
  expect(admitted).toEqual([]);
  first();
  const releaseThird = await third;
  expect(admitted).toEqual([3]);
  second();
  const releaseFourth = await fourth;
  expect(admitted).toEqual([3, 4]);
  releaseThird();
  releaseFourth();
});
it("expires a queued request without stealing a later slot", async () => {
  const slots = new ExecutionSlots();
  const first = await slots.acquire(Date.now() + 500);
  const second = await slots.acquire(Date.now() + 500);
  await expect(slots.acquire(Date.now() + 10)).rejects.toMatchObject({
    kind: "timeout",
  });
  first();
  const third = await slots.acquire(Date.now() + 100);
  third();
  second();
});
