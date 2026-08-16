/**
 * Tests covering the authentication flow: registration, login (success and
 * failure), and the requireAuth middleware. Written against Jest-style
 * globals (describe/test/expect) - illustrative only, not wired to a
 * runner in this sample project.
 */
const authService = require("../src/services/authService");
const { requireAuth } = require("../src/middleware/authMiddleware");

describe("authService.register", () => {
  test("creates a new user and returns a token", async () => {
    const { user, token } = await authService.register("new@example.com", "correct-horse");
    expect(user.email).toBe("new@example.com");
    expect(typeof token).toBe("string");
  });

  test("rejects a duplicate email", async () => {
    await authService.register("dupe@example.com", "password1");
    await expect(authService.register("dupe@example.com", "password2")).rejects.toThrow(
      "already exists"
    );
  });
});

describe("authService.login", () => {
  test("succeeds with correct credentials", async () => {
    await authService.register("login@example.com", "correct-password");
    const { token } = await authService.login("login@example.com", "correct-password");
    expect(typeof token).toBe("string");
  });

  test("fails with the wrong password", async () => {
    await authService.register("wrongpw@example.com", "correct-password");
    await expect(authService.login("wrongpw@example.com", "incorrect")).rejects.toThrow(
      "Invalid email or password."
    );
  });

  test("fails for an unknown email with the same generic error", async () => {
    await expect(authService.login("nobody@example.com", "whatever")).rejects.toThrow(
      "Invalid email or password."
    );
  });
});

describe("authMiddleware.requireAuth", () => {
  test("rejects requests with no Authorization header", () => {
    const req = { headers: {} };
    const res = {
      status(code) {
        this.statusCode = code;
        return this;
      },
      json(body) {
        this.body = body;
        return this;
      },
    };
    requireAuth(req, res, () => {
      throw new Error("next() should not be called");
    });
    expect(res.statusCode).toBe(401);
  });
});
