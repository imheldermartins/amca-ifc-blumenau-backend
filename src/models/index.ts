import { Model } from "@/core/db/model";
import { users } from "@models/user-model";
import { workspaces } from "@models/workspace-model";
import { pages } from "@models/page-model";
import { pageHubs } from "@models/page-hub-model";

export default {
    users,
    workspaces,
    pages,
    pageHubs,
    // Executor de SQL cru (joins/agregações) -- ver Model.sqlRaw.
    sqlRaw: Model.sqlRaw,
};
