import HttpServer from "@core/http/http-server";
import authRouter from "@/core/auth/auth-router";
import userRouter from "@routes/user-route";
import pageRouter from "@routes/page-route";
import workspaceRouter from "@routes/workspace-route";
import organizationRouter from "@routes/organization-route";
import accessRouter from "@routes/access-route";
import inviteRouter from "@routes/invite-route";

const server = new HttpServer([
  { path: "/users", router: userRouter },
  { path: "/pages", router: pageRouter },
  { path: "/workspaces", router: workspaceRouter },
  { path: "/organizations", router: organizationRouter },
  { path: "/access", router: accessRouter },
  { path: "/invites", router: inviteRouter },
  { path: "/auth", router: authRouter },
]);

server.start();
