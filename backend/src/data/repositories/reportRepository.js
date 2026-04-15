const models = require("../models");

async function getSales() {
  return models.Sale.find({}).sort({ updatedAt: -1, date: -1, id: -1 }).lean();
}

module.exports = {
  getSales,
};
