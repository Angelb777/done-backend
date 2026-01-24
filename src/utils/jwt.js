const jwt = require("jsonwebtoken");

function signToken(userId) {
  const secret = process.env.JWT_SECRET;
  const expiresIn = process.env.JWT_EXPIRES_IN || "30d";
  if (!secret) throw new Error("JWT_SECRET missing");

  return jwt.sign({}, secret, {
    subject: String(userId),
    expiresIn
  });
}

function verifyToken(token) {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error("JWT_SECRET missing");
  return jwt.verify(token, secret);
}

module.exports = { signToken, verifyToken };
