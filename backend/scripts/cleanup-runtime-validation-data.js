require("../src/config/loadEnv");

const { connectDB, disconnectDB } = require("../src/config/db");
const models = require("../src/data/models");

const runtimeProductSkus = ["SKU-RT-CRUD-001", "SKU-RT-COUNT-001"];
const runtimeSaleIds = ["SALE-2012", "SALE-2013"];
const runtimeCycleCountIds = ["CC-1005"];
const runtimeCustomerNames = ["Runtime Verification"];
const runtimeSupplierNames = ["Runtime Supplier"];

async function main() {
  await connectDB();

  const products = await models.Product.find({ sku: { $in: runtimeProductSkus } }).lean();
  const productIds = products.map((product) => Number(product.id));
  const supplierIds = [
    ...new Set(
      products
        .map((product) => (product.supplierId === null || product.supplierId === undefined ? null : Number(product.supplierId)))
        .filter((value) => Number.isFinite(value))
    ),
  ];

  const customers = await models.Customer.find({ name: { $in: runtimeCustomerNames } }).lean();
  const customerIds = customers.map((customer) => Number(customer.id));

  const suppliers = await models.Supplier.find({
    $or: [
      { id: { $in: supplierIds.length > 0 ? supplierIds : [-1] } },
      { name: { $in: runtimeSupplierNames } },
    ],
  }).lean();

  const auditEntityIds = [
    ...productIds.map(String),
    ...customerIds.map(String),
    ...suppliers.map((supplier) => String(supplier.id)),
    ...runtimeSaleIds,
    ...runtimeCycleCountIds,
  ];

  const summary = {
    deleted: {
      auditLogs: 0,
      inventoryMovements: 0,
      cycleCounts: 0,
      sales: 0,
      products: 0,
      customers: 0,
      suppliers: 0,
    },
    kept: {
      suppliersInUse: [],
    },
  };

  if (auditEntityIds.length > 0) {
    const auditResult = await models.AuditLog.deleteMany({
      entityId: { $in: auditEntityIds },
    });
    summary.deleted.auditLogs = Number(auditResult.deletedCount || 0);
  }

  if (runtimeSaleIds.length > 0 || productIds.length > 0 || runtimeCycleCountIds.length > 0) {
    const inventoryMovementResult = await models.InventoryMovement.deleteMany({
      $or: [
        { productId: { $in: productIds.length > 0 ? productIds : [-1] } },
        { referenceId: { $in: [...runtimeSaleIds, ...runtimeCycleCountIds] } },
      ],
    });
    summary.deleted.inventoryMovements = Number(inventoryMovementResult.deletedCount || 0);
  }

  if (runtimeCycleCountIds.length > 0 || productIds.length > 0) {
    const cycleCountResult = await models.CycleCount.deleteMany({
      $or: [
        { id: { $in: runtimeCycleCountIds } },
        { "items.productId": { $in: productIds.length > 0 ? productIds : [-1] } },
      ],
    });
    summary.deleted.cycleCounts = Number(cycleCountResult.deletedCount || 0);
  }

  if (runtimeSaleIds.length > 0 || customerIds.length > 0) {
    const saleResult = await models.Sale.deleteMany({
      $or: [
        { id: { $in: runtimeSaleIds } },
        { customerId: { $in: customerIds.length > 0 ? customerIds : [-1] } },
      ],
    });
    summary.deleted.sales = Number(saleResult.deletedCount || 0);
  }

  if (customerIds.length > 0) {
    const customerResult = await models.Customer.deleteMany({
      id: { $in: customerIds },
    });
    summary.deleted.customers = Number(customerResult.deletedCount || 0);
  }

  if (productIds.length > 0) {
    const productResult = await models.Product.deleteMany({
      id: { $in: productIds },
    });
    summary.deleted.products = Number(productResult.deletedCount || 0);
  }

  for (const supplier of suppliers) {
    const stillReferenced = await models.Product.exists({ supplierId: Number(supplier.id) });

    if (stillReferenced) {
      summary.kept.suppliersInUse.push({
        id: supplier.id,
        name: supplier.name,
      });
      continue;
    }

    const supplierResult = await models.Supplier.deleteOne({ id: Number(supplier.id) });
    summary.deleted.suppliers += Number(supplierResult.deletedCount || 0);
  }

  console.log("Runtime validation data cleanup complete.");
  console.log(JSON.stringify(summary, null, 2));
}

main()
  .catch((error) => {
    console.error("Runtime validation data cleanup failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    try {
      await disconnectDB();
    } catch (error) {
      console.error("Mongo disconnect failed:", error);
      process.exitCode = 1;
    }
  });
