const {
  ensureObject,
  readOptionalPositiveInteger,
  readOptionalString,
  readPositiveInteger,
  readEnum,
  throwValidationError,
} = require("./helpers");

const SALE_CHANNELS = ["In-Store", "Online", "Delivery", "Pickup"];
const PAYMENT_METHODS = ["Card", "Cash", "Transfer", "Mobile Money", "Other"];
const SALE_STATUSES = ["Pending", "Paid"];
const SALE_STATUS_UPDATES = ["Pending", "Paid", "Declined", "Refunded"];

function normalizeItems(items) {
  if (!Array.isArray(items) || items.length === 0) {
    throwValidationError("Sale items are required.");
  }

  return items.map((item, index) => {
    const productId = readPositiveInteger(item?.id ?? item?.productId, `Line ${index + 1} product`);
    const qty = readPositiveInteger(item?.qty, `Line ${index + 1} quantity`);

    return {
      productId,
      qty,
    };
  });
}

function validateCreateSalePayload(payload) {
  const body = ensureObject(payload);

  return {
    items: normalizeItems(body.items),
    customerId: readOptionalPositiveInteger(body.customerId, "Customer"),
    customer: readOptionalString(body.customer, {
      label: "Customer",
      maxLength: 120,
      defaultValue: "Walk-in Customer",
    }),
    channel: readEnum(body.channel, "Channel", SALE_CHANNELS, "In-Store"),
    paymentMethod: readEnum(body.paymentMethod, "Payment method", PAYMENT_METHODS, "Card"),
    status: readEnum(body.status, "Sale status", SALE_STATUSES, "Paid"),
  };
}

function validateSaleStatusPayload(payload) {
  const body = ensureObject(payload);

  return {
    status: readEnum(body.status, "Sale status", SALE_STATUS_UPDATES),
    note: readOptionalString(body.note, {
      label: "Status note",
      maxLength: 240,
      defaultValue: "",
    }),
  };
}

module.exports = {
  validateCreateSalePayload,
  validateSaleStatusPayload,
};
