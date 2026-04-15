const defaultSettings = require("../defaultSettings");
const models = require("../models");

function mergeSettings(document) {
  return {
    ...defaultSettings,
    ...(document || {}),
  };
}

async function getAnalyticsWorkspaceSnapshot() {
  const [
    settings,
    products,
    users,
    customers,
    suppliers,
    sales,
    inventoryMovements,
    purchaseOrders,
    cycleCounts,
  ] = await Promise.all([
    models.AppSetting.findOne({ id: 1 }).lean(),
    models.Product.find({}).sort({ id: 1 }).lean(),
    models.User.find({}).sort({ id: 1 }).lean(),
    models.Customer.find({}).sort({ name: 1 }).lean(),
    models.Supplier.find({}).sort({ name: 1 }).lean(),
    models.Sale.find({}).sort({ updatedAt: -1, date: -1, id: -1 }).lean(),
    models.InventoryMovement.find({}).sort({ createdAt: -1, id: -1 }).lean(),
    models.PurchaseOrder.find({}).sort({ createdAt: -1, id: -1 }).lean(),
    models.CycleCount.find({}).sort({ createdAt: -1, id: -1 }).lean(),
  ]);

  return {
    settings: mergeSettings(settings),
    products,
    users,
    customers,
    suppliers,
    sales,
    inventoryMovements,
    purchaseOrders,
    cycleCounts,
  };
}

module.exports = {
  getAnalyticsWorkspaceSnapshot,
};
