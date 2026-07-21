import { Model } from "@/core/db/model";
import { type Schema } from "@models/schemas/index";

const pageMembers = new Model<Schema.PageMember>("page_members");
export { pageMembers };
