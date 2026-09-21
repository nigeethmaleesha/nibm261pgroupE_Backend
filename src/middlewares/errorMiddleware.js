const notFound = (req, res) => res.status(404).json({
  message: `Route not found: ${req.method} ${req.originalUrl}`
});

const errorHandler = (error, req, res, next) => {
  let statusCode = error.statusCode || 500;
  let message = error.message || 'Internal server error';

  if (error.name === 'ValidationError') {
    statusCode = 400;
    message = Object.values(error.errors).map((item) => item.message).join(', ');
  }

  if (error.code === 11000) {
    statusCode = 409;
    message = 'An account with this email address already exists';
  }

  if (error.retryAfterSeconds) {
    res.set('Retry-After', String(error.retryAfterSeconds));
  }

  if (process.env.NODE_ENV !== 'production' && statusCode >= 500) {
    console.error(error);
  }

  return res.status(statusCode).json({
    message,
    ...(error.retryAfterSeconds ? { retryAfterSeconds: error.retryAfterSeconds } : {})
  });
};

module.exports = {
  notFound,
  errorHandler
};
