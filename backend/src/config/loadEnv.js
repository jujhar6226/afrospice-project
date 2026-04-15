const path = require("path");
const dotenv = require("dotenv");

let loaded = false;

function loadEnv() {
  if (loaded) {
    return;
  }

  dotenv.config({
    path: path.resolve(__dirname, "..", ".env"),
    override: false,
  });

  loaded = true;
}

loadEnv();

module.exports = loadEnv;
