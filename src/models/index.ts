import { Model } from "@/core/db/model";
import { users } from "@models/user-model";
import { workspaces } from "@models/workspace-model";
import { pages } from "@models/page-model";
import { pageEdges } from "@models/page-edge-model";
import { pageColumns } from "@models/page-column-model";
import { pageColumnValues } from "@models/page-column-value-model";
import { pageMembers } from "@models/page-member-model";

export default {
    users,
    workspaces,
    pages,
    pageEdges,
    pageColumns,
    pageColumnValues,
    pageMembers,
    sqlRaw: Model.sqlRaw,
};
