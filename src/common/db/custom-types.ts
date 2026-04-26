import { customType } from 'drizzle-orm/pg-core';

// Custom type for 'bytea' since it's not a standard Drizzle helper yet
export const bytea = customType<{ data: Buffer }>({
  dataType() {
    return 'bytea';
  },
});
