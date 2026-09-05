/**
 * lib/db.ts
 *
 * Reusable Mongoose connection helper with connection caching.
 * Caching prevents the creation of a new connection on every
 * module evaluation during Next.js hot-reloads in development.
 *
 * Usage:
 *   import dbConnect from '@/lib/db';
 *   await dbConnect();
 */

import mongoose, { Mongoose } from 'mongoose';
import dns from 'dns';

// Fix: Node.js on Windows sometimes uses 127.0.0.1:53 (no local DNS server)
// for SRV record lookups, causing ECONNREFUSED on mongodb+srv:// URIs.
// Explicitly pointing to Google's public DNS resolves this.
dns.setServers(['8.8.8.8', '8.8.4.4']);

const MONGODB_URI = process.env.MONGODB_URI as string;

if (!MONGODB_URI) {
  throw new Error(
    'Please define the MONGODB_URI environment variable inside .env.local'
  );
}

/**
 * In development, we attach the cached connection to the Node.js
 * global object so that the value is preserved across module reloads
 * caused by HMR (Hot Module Replacement). In production this caching
 * is unnecessary because the module is only evaluated once.
 */
interface MongooseCache {
  conn: Mongoose | null;
  promise: Promise<Mongoose> | null;
}

// Extend the NodeJS Global type to include our mongoose cache
declare global {
  // eslint-disable-next-line no-var
  var mongoose: MongooseCache | undefined;
}

const cached: MongooseCache = global.mongoose ?? { conn: null, promise: null };

// Persist cache on the global object in development
if (!global.mongoose) {
  global.mongoose = cached;
}

/**
 * Connects to MongoDB using Mongoose and returns the cached connection.
 * Safe to call multiple times — will reuse an existing connection.
 */
async function dbConnect(): Promise<Mongoose> {
  // Return the existing connection if available
  if (cached.conn) {
    return cached.conn;
  }

  // Explicitly set public DNS servers to resolve MongoDB SRV records on Windows
  try {
    dns.setServers(['8.8.8.8', '8.8.4.4', '1.1.1.1']);
    if (typeof dns.setDefaultResultOrder === 'function') {
      dns.setDefaultResultOrder('ipv4first');
    }
  } catch {
    // Ignore if not supported in environment
  }

  // Initiate a new connection if one is not already in progress
  if (!cached.promise) {
    const opts: mongoose.ConnectOptions = {
      bufferCommands: false, // Disable command buffering; fail fast if not connected
    };

    cached.promise = mongoose.connect(MONGODB_URI, opts);
  }

  try {
    cached.conn = await cached.promise;
  } catch (err) {
    // Reset promise so the next call can try again
    cached.promise = null;
    throw err;
  }

  return cached.conn;
}

export default dbConnect;
