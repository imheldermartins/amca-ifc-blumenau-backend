import HttpServer from "@core/http/http-server";
import authRouter from "@/core/auth/auth-router";
import userRouter from "@routes/user-route";
import pageRouter from "@routes/page-route";
import workspaceRouter from "@routes/workspace-route";
import organizationRouter from "@routes/organization-route";

const server = new HttpServer([
  { path: "/users", router: userRouter },
  { path: "/pages", router: pageRouter },
  { path: "/workspaces", router: workspaceRouter },
  { path: "/organizations", router: organizationRouter },
  { path: "/auth", router: authRouter },
]);

server.start();
