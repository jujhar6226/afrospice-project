const userService = require("../services/userService");
const asyncHandler = require("../utils/asyncHandler");
const { success, created } = require("../utils/response");

const getUsers = asyncHandler(async (req, res) => {
  return success(res, await userService.getUsers(), "Users fetched.");
});

const getUser = asyncHandler(async (req, res) => {
  return success(res, await userService.getUserById(req.params.id), "User fetched.");
});

const getUserAccessEvents = asyncHandler(async (req, res) => {
  return success(
    res,
    await userService.getUserAccessEvents(req.params.id),
    "User access events fetched."
  );
});

const getUserOversight = asyncHandler(async (req, res) => {
  return success(
    res,
    await userService.getUserOversight(req.params.id),
    "User oversight fetched."
  );
});

const createUser = asyncHandler(async (req, res) => {
  return created(
    res,
    await userService.createUser(req.body || {}, req.user),
    "Staff record created. Assign a PIN and approve access before sign-in."
  );
});

const updateUser = asyncHandler(async (req, res) => {
  return success(
    res,
    await userService.updateUser(req.params.id, req.body || {}, req.user),
    "User updated successfully."
  );
});

const assignUserPin = asyncHandler(async (req, res) => {
  const payload = await userService.assignUserPin(req.params.id, req.body || {}, req.user);

  return success(
    res,
    payload.user,
    payload.wasReset ? "PIN reset successfully." : "PIN assigned successfully."
  );
});

const approveUser = asyncHandler(async (req, res) => {
  return success(
    res,
    await userService.approveUser(req.params.id, req.user),
    "Access approved successfully."
  );
});

const updateUserStatus = asyncHandler(async (req, res) => {
  return success(
    res,
    await userService.updateUserStatus(req.params.id, req.body || {}, req.user),
    "Access status updated successfully."
  );
});

const deleteUser = asyncHandler(async (req, res) => {
  return success(
    res,
    await userService.deleteUser(req.params.id, req.user),
    "User deleted successfully."
  );
});

const updateUserWorkforceProfile = asyncHandler(async (req, res) => {
  return success(
    res,
    await userService.updateUserWorkforceProfile(req.params.id, req.body || {}, req.user),
    "Workforce profile updated successfully."
  );
});

const exportUserAudit = asyncHandler(async (req, res) => {
  const csv = await userService.exportUserAuditCsv();
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${csv.filename}"`);
  return res.status(200).send(csv.body);
});

const exportSingleUserAudit = asyncHandler(async (req, res) => {
  const csv = await userService.exportSingleUserAuditCsv(req.params.id);
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${csv.filename}"`);
  return res.status(200).send(csv.body);
});

const getSavedUserViews = asyncHandler(async (req, res) => {
  return success(
    res,
    await userService.getSavedUserViews(req.user, req.query || {}),
    "Saved user views fetched."
  );
});

const saveUserView = asyncHandler(async (req, res) => {
  return success(
    res,
    await userService.saveUserView(req.user, req.body || {}),
    "Saved user view updated."
  );
});

const deleteSavedUserView = asyncHandler(async (req, res) => {
  return success(
    res,
    await userService.deleteSavedUserView(req.user, req.params.viewId),
    "Saved user view deleted."
  );
});

module.exports = {
  getUsers,
  getUser,
  getUserAccessEvents,
  getUserOversight,
  createUser,
  updateUser,
  updateUserWorkforceProfile,
  assignUserPin,
  approveUser,
  updateUserStatus,
  exportUserAudit,
  exportSingleUserAudit,
  getSavedUserViews,
  saveUserView,
  deleteSavedUserView,
  deleteUser,
};
