function success(res, data = {}, message = "Success", status = 200) {
  return res.status(status).json({
    success: true,
    message,
    data,
  });
}

function created(res, data = {}, message = "Created") {
  return success(res, data, message, 201);
}

function fail(res, message = "Error", status = 500, extra = {}) {
  return res.status(status).json({
    success: false,
    message,
    ...extra,
  });
}

module.exports = {
  success,
  created,
  fail,
};