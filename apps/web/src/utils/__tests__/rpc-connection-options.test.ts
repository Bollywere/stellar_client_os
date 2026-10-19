// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { getStellarServerOptions } from "../rpc-connection-options";

describe("getStellarServerOptions", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("should configure headers when passed a Bearer token string", () => {
    const options = getStellarServerOptions(
      "https://soroban-testnet.stellar.org",
      "Bearer secret-token"
    );
    expect(options.headers).toEqual({ Authorization: "Bearer secret-token" });
  });

  it("should parse key-value header string like X-Api-Key: foo", () => {
    const options = getStellarServerOptions(
      "https://soroban-testnet.stellar.org",
      "X-Api-Key: secret-123"
    );
    expect(options.headers).toEqual({ "X-Api-Key": "secret-123" });
  });

  it("should parse JSON header string", () => {
    const options = getStellarServerOptions(
      "https://soroban-testnet.stellar.org",
      JSON.stringify({ "x-rpc-auth": "token-xyz" })
    );
    expect(options.headers).toEqual({ "x-rpc-auth": "token-xyz" });
  });

  it("should read from process.env.NEXT_PUBLIC_SOROBAN_RPC_HEADER if header param is omitted", () => {
    process.env.NEXT_PUBLIC_SOROBAN_RPC_HEADER = "x-key: env-secret";
    const options = getStellarServerOptions("https://soroban-testnet.stellar.org");
    expect(options.headers).toEqual({ "x-key": "env-secret" });
  });

  it("should respect explicit empty string header even when env variable is present", () => {
    process.env.NEXT_PUBLIC_SOROBAN_RPC_HEADER = "x-key: env-secret";
    const options = getStellarServerOptions("https://soroban-testnet.stellar.org", "");
    expect(options.headers).toBeUndefined();
  });

  it("should return empty/undefined headers if no header is provided", () => {
    delete process.env.NEXT_PUBLIC_SOROBAN_RPC_HEADER;
    const options = getStellarServerOptions("https://soroban-testnet.stellar.org");
    expect(options.headers).toBeUndefined();
  });
});
