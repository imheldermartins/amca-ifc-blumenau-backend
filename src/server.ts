import HttpServer from "@core/http/http-server";
import authRouter from "@/core/auth/auth-router";
import userRouter from "@routes/user-route";
import pageRouter from "@routes/page-route";
import workspaceRouter from "@routes/workspace-route";

const server = new HttpServer([
  { path: "/users", router: userRouter },
  { path: "/pages", router: pageRouter },
  { path: "/workspaces", router: workspaceRouter },
  { path: "/auth", router: authRouter },
]);

// Ponto de extensão pra middleware global (logging, etc.) -- chame antes de start():
// server.use(someMiddleware);

server.start();