/**
 * Simple API key middleware for crawler authentication.
 * Crawlers must send: Authorization: Bearer <CRAWLER_API_KEY>
 *
 * Skip this middleware on routes that the frontend hits directly
 * (frontend uses Firebase Auth instead).
 */
function crawlerAuth(req, res, next) {
  const apiKey = process.env.CRAWLER_API_KEY;

  // If no API key is configured, skip auth (dev mode)
  if (!apiKey) {
    return next();
  }

  const authHeader = req.headers['authorization'];
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing Authorization header' });
  }

  const token = authHeader.split(' ')[1];
  if (token !== apiKey) {
    return res.status(403).json({ error: 'Invalid API key' });
  }

  next();
}

/**
 * Error handling middleware — catches async errors from routes.
 */
function errorHandler(err, req, res, next) {
  console.error('[Error]', err.message);
  res.status(500).json({
    error: 'Internal server error',
    message: err.message,
  });
}

module.exports = { crawlerAuth, errorHandler };