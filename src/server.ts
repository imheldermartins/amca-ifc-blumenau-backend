import HttpServer from "@/services/http/http-server";
import {db} from '@/db/client-db';
import authRouter from "@routes/auth-route";
import userRouter from "@routes/user-route";
import pageRouter from "@routes/page-route";
import workspaceRouter from "@routes/workspace-route";
import organizationRouter from "@routes/organization-route";
import accessRouter from "@routes/access-route";
import inviteRouter from "@routes/invite-route";
import scheduleRouter from "@routes/schedule-route";
import notificationRouter from "@routes/notification-route";
import formRouter from '@/routes/form-route';
import notificationWorker from '@/services/notifications/notification-worker';

const server = new HttpServer([
  { path: "/users", router: userRouter },
  { path: "/pages", router: pageRouter },
  { path: "/workspaces", router: workspaceRouter },
  { path: "/organizations", router: organizationRouter },
  { path: "/access", router: accessRouter },
  { path: "/invites", router: inviteRouter },
  { path: "/auth", router: authRouter },
  { path: "/schedule", router: scheduleRouter },
  { path: "/notifications", router: notificationRouter },
  { path: "/forms", router: formRouter },
]);

await db.waitForDatabase();
await db.assertReady();
server.start();
notificationWorker.start();
