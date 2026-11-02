const REQUIRED = ['DATABASE_URL', 'QDRANT_URL', 'QDRANT_API_KEY'] as const;

// Vitest 5 crashes while printing an error thrown from a global setup, so the message is
// written by hand and the process ends without a throw.
export default function setup(): void {
  const missing = REQUIRED.filter((name) => (process.env[name] ?? '').trim() === '');

  if (missing.length > 0) {
    console.error(
      `Integration tests need ${missing.join(', ')}. Start the services with "npm run db:up" and set the values in .env.`,
    );

    process.exit(1);
  }
}
