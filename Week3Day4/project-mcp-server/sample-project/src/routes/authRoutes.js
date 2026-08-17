/**
 * HTTP entry points for authentication. Thin by design - request/response
 * plumbing only, with the real logic delegated to authService.
 */
const express = require("express");
const authService = require("../services/authService");
const { requireAuth } = require("../middleware/authMiddleware");

const router = express.Router();

router.post("/register", async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) {
    return res.status(400).json({ error: "email and password are required." });
  }
  try {
    const { user, token } = await authService.register(email, password);
    res.status(201).json({ user: { id: user.id, email: user.email }, token });
  } catch (err) {
    res.status(409).json({ error: err.message });
  }
});

router.post("/login", async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) {
    return res.status(400).json({ error: "email and password are required." });
  }
  try {
    const { user, token } = await authService.login(email, password);
    res.json({ user: { id: user.id, email: user.email }, token });
  } catch (err) {
    res.status(401).json({ error: err.message });
  }
});

// Logout is stateless (JWTs aren't stored server-side) - this just
// documents the endpoint for clients that expect one.
router.post("/logout", requireAuth, (req, res) => {
  res.status(204).end();
});

router.get("/me", requireAuth, (req, res) => {
  res.json({ user: req.user });
});

module.exports = router;
