// triage/triage.test.mjs — 承認型の純関数（env正規化・承認判定）の単体テスト。
import test from "node:test";
import assert from "node:assert/strict";
import { envKey, channelOf, repoOf, approvalDecision } from "./apps.mjs";

test("envKey: - を _ に、英字を大文字化", () => {
  assert.equal(envKey("DISCORD_CHANNEL", "kanji-drill"), "DISCORD_CHANNEL_KANJI_DRILL");
  assert.equal(envKey("TARGET_REPO", "hiragana"), "TARGET_REPO_HIRAGANA");
});

test("channelOf/repoOf: app 別 env を引く / 無ければ null", () => {
  const env = { DISCORD_CHANNEL_HIRAGANA: "123", TARGET_REPO_HIRAGANA: "n0mu-a1/hiragana" };
  assert.equal(channelOf("hiragana", env), "123");
  assert.equal(repoOf("hiragana", env), "n0mu-a1/hiragana");
  assert.equal(channelOf("kanji-drill", env), null);
});

test("approvalDecision: オーナーの ✅ で approve", () => {
  assert.equal(approvalDecision({ ownerId: "u1", approvers: ["bot", "u1"], rejecters: ["bot"] }), "approve");
});

test("approvalDecision: オーナーの ❌ は approve より優先(reject)", () => {
  assert.equal(approvalDecision({ ownerId: "u1", approvers: ["u1"], rejecters: ["u1"] }), "reject");
});

test("approvalDecision: オーナー未反応は pending（他人の ✅ では動かない）", () => {
  assert.equal(approvalDecision({ ownerId: "u1", approvers: ["bot", "stranger"], rejecters: ["bot"] }), "pending");
});

test("approvalDecision: ownerId 無しは常に pending", () => {
  assert.equal(approvalDecision({ ownerId: null, approvers: ["x"], rejecters: [] }), "pending");
});
