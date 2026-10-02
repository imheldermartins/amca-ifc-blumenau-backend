import { Model } from "@/repositories/model";
import { users } from "@models/user-model";
import { workspaces } from "@models/workspace-model";
import { pages } from "@models/page-model";
import { pageEdges } from "@models/page-edge-model";
import { pageColumns } from "@models/page-column-model";
import { pageColumnValues } from "@models/page-column-value-model";
import { pageCollaborators } from "@models/page-collaborator-model";
import { organizations } from "@models/organization-model";
import { organizationMembers } from "@models/organization-member-model";
import { workspaceMembers } from "@models/workspace-member-model";
import { pinnedSchedulePages } from "@models/pinned-schedule-page-model";
import { notifications, notificationDeliveries } from "@models/notification-model";
import { schedulePinRequests } from "@models/schedule-pin-request-model";

export default {
    users,
    workspaces,
    pages,
    pageEdges,
    pageColumns,
    pageColumnValues,
    pageCollaborators,
    organizations,
    organizationMembers,
    workspaceMembers,
    pinnedSchedulePages,
    notifications,
    notificationDeliveries,
    schedulePinRequests,
    sqlRaw: Model.sqlRaw,
};
