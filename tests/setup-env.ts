// Runs before every test file, before any module that creates a Prisma client.
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? "postgresql://controlroom:controlroom@localhost:5432/controlroom_test";
process.env.SESSION_SECRET = "test-session-secret-that-is-long-enough-123";
process.env.APP_URL = "http://localhost:3000";
process.env.STORAGE_DIR = process.env.STORAGE_DIR_TEST ?? "/tmp/control-room-test-storage";
