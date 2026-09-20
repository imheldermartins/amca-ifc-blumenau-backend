export const DB_RAFT_HOST = process.env.DB_RAFT_HOST?.trim() || "localhost";
export const DB_RAFT_PORT = process.env.DB_RAFT_PORT?.trim() || "8000";

export const DB_RAFT_URL = `http://${DB_RAFT_HOST}:${DB_RAFT_PORT}`;
