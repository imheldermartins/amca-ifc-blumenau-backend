import db from "@models/index";
import type { Model } from "@/core/db/model";
import type { Schema } from "@/models/schemas/index";

class UserController implements IBaseController<Schema.User> {
  private db: Model<Schema.User> = db.users;

  // O SELECT * traz a coluna password_hash em runtime (mesmo o tipo sendo
  // Schema.User). Removemos antes de devolver qualquer usuário ao cliente.
  private sanitize(user: Schema.User): Schema.User {
    const { password_hash, ...safe } = user as Schema.User & { password_hash?: unknown };
    return safe as Schema.User;
  }

  async all(lookup?: LookupsConfig<Schema.User>) {
    try {
      const users = await this.db.findAll(lookup);

      if (!users) throw new Error("No users found");

      return users.map((user) => this.sanitize(user));
    } catch (error) {
      if (error instanceof Error) {
        console.error(`[${error.cause}] ${error.message}`);
      }
      return null;
    }
  }

  async get(lookup: LookupValues<Schema.User>) {
    try {
      const user = await this.db.find(lookup);

      if (!user) throw new Error("User not found");

      return this.sanitize(user);
    } catch (error) {
      if (error instanceof Error) {
        console.error(`[${error.cause}] ${error.message}`);
      }
      return null;
    }
  }

  async create(data: CreateValues<Schema.User>) {
    try {
      const createdUser = await this.db.create(data);

      if (!createdUser) throw new Error("Failed to create user");

      return this.sanitize(createdUser);
    } catch (error) {
      if (error instanceof Error) {
        console.error(`[${error.cause}] ${error.message}`);
      }
      return null;
    }
  }

  async update(lookup: LookupValues<Schema.User>, data: UpdateValues<Schema.User>) {
    try {
      const updated = await this.db.update(data, lookup);

      if (!updated) throw new Error("Failed to update user");

      // db.update only returns a boolean, so we re-fetch to hand back the fresh entity
      const user = await this.db.find(lookup);

      return user ? this.sanitize(user) : null;
    } catch (error) {
      if (error instanceof Error) {
        console.error(`[${error.cause}] ${error.message}`);
      }
      return null;
    }
  }

  async delete(lookup: LookupValues<Schema.User>) {
    try {
      const deleted = await this.db.delete(lookup);

      if (!deleted) throw new Error("Failed to delete user");

      return deleted;
    } catch (error) {
      if (error instanceof Error) {
        console.error(`[${error.cause}] ${error.message}`);
      }
      return false;
    }
  }
}

// Singleton: routes import this directly, no req/res knowledge needed here.
export default new UserController();