import * as schema from '../database/schema';
import { Inject, Injectable } from '@nestjs/common';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { DATABASE_CONNECTION } from '../database/database-connection';
import { eq } from 'drizzle-orm';

// Columns safe to expose to API consumers — excludes passwordHash and the verification
// token fields. Shared across every safe read so the projection lives in one place.
const safeUserColumns = {
  id: schema.users.id,
  email: schema.users.email,
  firstName: schema.users.firstName,
  lastName: schema.users.lastName,
  verifiedAt: schema.users.verifiedAt,
  createdAt: schema.users.createdAt,
  updatedAt: schema.users.updatedAt,
};

@Injectable()
export class UsersService {
  constructor(
    @Inject(DATABASE_CONNECTION)
    private readonly database: NodePgDatabase<typeof schema>,
  ) {}

  async getUsers() {
    return this.database.select(safeUserColumns).from(schema.users);
  }

  async getUserByEmail(email: string) {
    const [user] = await this.database
      .select(safeUserColumns)
      .from(schema.users)
      .where(eq(schema.users.email, email));
    return user;
  }

  async getUserById(id: string) {
    const [user] = await this.database
      .select(safeUserColumns)
      .from(schema.users)
      .where(eq(schema.users.id, id));
    return user;
  }

  async getUserCredentialsByEmail(email: string) {
    const [user] = await this.database
      .select()
      .from(schema.users)
      .where(eq(schema.users.email, email));
    return user;
  }
}
