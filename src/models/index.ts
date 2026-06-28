import { Model } from "@/core/db/model";
import { users } from "@models/user-model";
import { workspaces } from "@models/workspace-model";
import { pages } from "@models/page-model";
import { pageHubs } from "@models/page-hub-model";
import { pageColumns } from "@models/page-column-model";
import { pageColumnValues } from "@models/page-column-value-model";

export default {
    users,
    workspaces,
    pages,
    pageHubs,
    pageColumns,
    pageColumnValues,
    sqlRaw: Model.sqlRaw,
};
