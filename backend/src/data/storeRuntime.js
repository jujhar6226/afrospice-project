const activeStore = require("./store.mongo");

async function initialize() {
  if (typeof activeStore.initialize === "function") {
    await activeStore.initialize();
  }
}

module.exports = {
  ...activeStore,
  initialize,
};
