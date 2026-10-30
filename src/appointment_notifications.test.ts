import test from "node:test";
import assert from "node:assert/strict";
import { notificationDecision } from "./appointment_notifications.ts";

test("a patient without consent does not receive an operational notification", () => {
  assert.equal(notificationDecision(false), "skip");
  assert.equal(notificationDecision(true), "send");
});
