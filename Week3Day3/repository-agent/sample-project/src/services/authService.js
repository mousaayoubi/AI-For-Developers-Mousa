/**
 * Core authentication logic: password hashing, credential verification,
 * and JWT issuing. This is the file that actually answers "how does login
 * work" - routes and middleware just call into it.
 */
const crypto = require("crypto");
const jwt = require("jsonwebtoken");
const userRepository = require("../repositories/userRepository");

const JWT_SECRET = process.env.JWT_SECRET;
const JWT_EXPIRY = "1h";

function hashPassword(plainTextPassword) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto
    .scryptSync(plainTextPassword, salt, 64)
    .toString("hex");
  return `${salt}:${hash}`;
}

function verifyPassword(plainTextPassword, storedHash) {
  const [salt, hash] = storedHash.split(":");
  const attemptHash = crypto
    .scryptSync(plainTextPassword, salt, 64)
    .toString("hex");
  return crypto.timingSafeEqual(Buffer.from(hash), Buffer.from(attemptHash));
}

function issueToken(user) {
  return jwt.sign({ sub: user.id, email: user.email }, JWT_SECRET, {
    expiresIn: JWT_EXPIRY,
  });
}

async function register(email, password) {
  if (userRepository.findByEmail(email)) {
    throw new Error("A user with that email already exists.");
  }
  const passwordHash = hashPassword(password);
  const user = userRepository.createUser({ email, passwordHash });
  return { user, token: issueToken(user) };
}

async function login(email, password) {
  const user = userRepository.findByEmail(email);
  if (!user || !verifyPassword(password, user.passwordHash)) {
    // Deliberately the same error for "no such user" and "wrong password"
    // so login failures don't leak which emails are registered.
    throw new Error("Invalid email or password.");
  }
  return { user, token: issueToken(user) };
}

function verifyToken(token) {
  // Throws JsonWebTokenError / TokenExpiredError on invalid or expired
  // tokens - callers (authMiddleware) are responsible for turning that
  // into a 401 response.
  return jwt.verify(token, JWT_SECRET);
}

module.exports = { register, login, verifyToken, hashPassword, verifyPassword };
