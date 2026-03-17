/**
 * Tests for the OAuth state generation and validation.
 *
 * These tests verify the iOS-compatible HMAC-signed state approach.
 * The key property is that state validation requires only the server
 * secret (TOKEN_ENCRYPTION_KEY) — no cookie storage is needed.
 */

import { describe, it, expect } from "vitest";

// We test the crypto helpers by reproducing them inline since they're not
// exported from the main module.  This ensures the logic is correct in
// isolation from the Worker environment.

const TEST_HEX_KEY = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

function hexToBytes(hex: string): Uint8Array {
  const arr = new Uint8Array(hex.length / 2);
  for (let i = 0; i < arr.length; i++) {
    arr[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return arr;
}

function bytesToBase64url(buf: ArrayBuffer): string {
  return btoa(String.fromCharCode(...new Uint8Array(buf)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=/g, "");
}

function base64urlToBytes(s: string): Uint8Array {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/");
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

async function importHmacKey(hexKey: string): Promise<CryptoKey> {
  const raw = hexToBytes(hexKey);
  return crypto.subtle.importKey("raw", raw, { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}

async function generateState(hexKey: string): Promise<string> {
  const nonce = bytesToBase64url(crypto.getRandomValues(new Uint8Array(24)).buffer as ArrayBuffer);
  const key = await importHmacKey(hexKey);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(nonce));
  return `${nonce}.${bytesToBase64url(sig)}`;
}

async function validateState(state: string, hexKey: string): Promise<boolean> {
  const dot = state.lastIndexOf(".");
  if (dot < 1) return false;
  const nonce = state.slice(0, dot);
  const sig = state.slice(dot + 1);
  let sigBytes: Uint8Array;
  try {
    sigBytes = base64urlToBytes(sig);
  } catch {
    return false;
  }
  const key = await importHmacKey(hexKey);
  return crypto.subtle.verify("HMAC", key, sigBytes, new TextEncoder().encode(nonce));
}

describe("OAuth state — HMAC-signed, cookie-free (iOS-compatible)", () => {
  it("generates a state string with nonce and signature separated by a dot", async () => {
    const state = await generateState(TEST_HEX_KEY);
    expect(state).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
  });

  it("validates a freshly generated state", async () => {
    const state = await generateState(TEST_HEX_KEY);
    const valid = await validateState(state, TEST_HEX_KEY);
    expect(valid).toBe(true);
  });

  it("rejects a tampered nonce", async () => {
    const state = await generateState(TEST_HEX_KEY);
    const [, sig] = state.split(".");
    const tampered = `tampered_nonce.${sig}`;
    const valid = await validateState(tampered, TEST_HEX_KEY);
    expect(valid).toBe(false);
  });

  it("rejects a tampered signature", async () => {
    const state = await generateState(TEST_HEX_KEY);
    const [nonce] = state.split(".");
    const tampered = `${nonce}.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA`;
    const valid = await validateState(tampered, TEST_HEX_KEY);
    expect(valid).toBe(false);
  });

  it("rejects a state signed with a different key", async () => {
    const otherKey = "ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff";
    const state = await generateState(otherKey);
    const valid = await validateState(state, TEST_HEX_KEY);
    expect(valid).toBe(false);
  });

  it("rejects an empty state string", async () => {
    const valid = await validateState("", TEST_HEX_KEY);
    expect(valid).toBe(false);
  });

  it("rejects a state with no dot separator", async () => {
    const valid = await validateState("nodotseparatorhere", TEST_HEX_KEY);
    expect(valid).toBe(false);
  });

  it("rejects a state with invalid base64url in the signature part", async () => {
    const valid = await validateState("nonce.!!!invalid!!!", TEST_HEX_KEY);
    expect(valid).toBe(false);
  });

  it("generates different states on each call", async () => {
    const state1 = await generateState(TEST_HEX_KEY);
    const state2 = await generateState(TEST_HEX_KEY);
    expect(state1).not.toBe(state2);
  });
});
