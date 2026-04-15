const mongoose = require("mongoose");
const runtime = require("./runtime");
const { maybeStartDevMemoryMongo } = require("./devMemoryMongo");
const { ensureLocalReplicaSet } = require("./localReplicaSet");

let connectionPromise = null;

mongoose.set("strictQuery", true);

async function connectDB() {
  if (mongoose.connection.readyState === 1) {
    return mongoose.connection;
  }

  if (connectionPromise) {
    return connectionPromise;
  }

  const options = {
    appName: "afrospice-backend",
    maxPoolSize: Number(process.env.MONGO_MAX_POOL_SIZE || 20),
    minPoolSize: Number(process.env.MONGO_MIN_POOL_SIZE || 3),
    serverSelectionTimeoutMS: Number(process.env.MONGO_SERVER_SELECTION_TIMEOUT_MS || 10000),
    socketTimeoutMS: Number(process.env.MONGO_SOCKET_TIMEOUT_MS || 45000),
    retryWrites: true,
    autoIndex: !runtime.isProduction,
  };

  connectionPromise = Promise.resolve()
    .then(async () => {
      await maybeStartDevMemoryMongo();
      await ensureLocalReplicaSet();
      return mongoose.connect(runtime.mongoUri, options);
    })
    .then((conn) => {
      console.log(`MongoDB connected: ${conn.connection.host}:${conn.connection.port}`);
      return conn.connection;
    })
    .catch((error) => {
      connectionPromise = null;
      throw error;
    });

  return connectionPromise;
}

async function disconnectDB() {
  connectionPromise = null;

  if (mongoose.connection.readyState === 0) {
    return;
  }

  await mongoose.disconnect();
}

module.exports = {
  connectDB,
  disconnectDB,
  mongoose,
};
