// Vercel entry point: the whole Express API runs as one serverless function.
// The React app is served as static files from client/dist (see vercel.json).
import { createApp } from '../server/app.js';
import { createDb } from '../server/db.js';

if (!process.env.DATABASE_URL || !process.env.SESSION_SECRET) {
  throw new Error('DATABASE_URL and SESSION_SECRET must be set');
}

// Created once per warm instance and reused across requests.
const db = await createDb({ url: process.env.DATABASE_URL });

export default createApp({ db, secret: process.env.SESSION_SECRET, isProd: true });
