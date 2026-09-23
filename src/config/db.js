const mongoose = require("mongoose");

let baseConnection = null;

async function connectDB() {
  mongoose.set("strictQuery", true);
  if (!baseConnection || baseConnection.readyState !== 1) {
    if (mongoose.connection && mongoose.connection.readyState === 1) {
      baseConnection = mongoose.connection;
    } else {
      await mongoose.connect(process.env.MONGODB_URI, {
        maxPoolSize: 50,
        minPoolSize: 5,
        serverSelectionTimeoutMS: 5000,
        socketTimeoutMS: 45000,
      });
      baseConnection = mongoose.connection;
    }
  }
  console.log(`MongoDB connected: ${baseConnection.host}`);
  return baseConnection;
}

function getTenantDB(schoolCode) {
  const code = (schoolCode || "owneradmin").toString().trim().toLowerCase();
  const conn = baseConnection || mongoose.connection;
  if (!conn || conn.readyState !== 1) {
    throw Object.assign(new Error("Database connection not ready. Check process.env.MONGODB_URI"), { status: 500 });
  }
  return conn.useDb(code, { useCache: true });
}

connectDB.connectDB = connectDB;
connectDB.getTenantDB = getTenantDB;

module.exports = connectDB;

