function errorHandler(err, req, res, next) {
  console.error(err);

  const status = err.statusCode || 500;
  const message = err.message || "Internal error";

  res.status(status).json({ error: message });
}

module.exports = { errorHandler };
