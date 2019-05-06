import { knexAdapter } from '@cotype/core';

function parseDbUrl(connection: string) {
  let match: RegExpMatchArray | null;
  if (connection.match(/^postgres:/)) {
    return { client: 'pg', connection };
  } else if (connection.match(/^mysql:/)) {
    return { client: 'mysql', connection };
  } else if ((match = connection.match(/^sqlite3:(.*)/))) {
    return {
      client: 'sqlite3',
      connection: {
        filename: match[1],
      },
      useNullAsDefault: true,
    };
  }

  throw new Error('Unsupported connection string: ' + connection);
}

function getConnection() {
  if (!process.env.DB || process.env.DB === 'undefined') {
    return `sqlite3:./cotype-db-${process.env.NODE_ENV}`;
  }

  return process.env.DB;
}

export default function adapter(migrate = false) {
  return knexAdapter({
    ...parseDbUrl(getConnection()),
    migrate,
  });
}
