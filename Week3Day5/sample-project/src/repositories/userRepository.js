/**
 * Very small in-memory user store standing in for a real database table.
 * Keeps the sample project self-contained (no DB driver required) while
 * still giving the repository agent a realistic "data access layer" file
 * to find and read.
 */
const { getConnectionConfig } = require("../config/database");

// Not used for anything except proving the config module is wired up -
// a real repository would use this to open a pool/connection.
getConnectionConfig();

const usersByEmail = new Map();

function findByEmail(email) {
  return usersByEmail.get(email.toLowerCase()) || null;
}

function createUser({ email, passwordHash }) {
  const user = {
    id: usersByEmail.size + 1,
    email: email.toLowerCase(),
    passwordHash,
    createdAt: new Date().toISOString(),
  };
  usersByEmail.set(user.email, user);
  return user;
}

module.exports = { findByEmail, createUser };
