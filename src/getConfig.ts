import S3Storage from './S3Storage';
import knexAdapter from './knexAdapter';
import { resolve } from 'path';
import { Opts } from '@cotype/core';
import { Method } from '@cotype/build-client/lib/transform';

function importDefault(mod: any) {
  return mod.default ? mod.default : mod;
}

function getBasePath({ COTYPE_BASE_PATH, BASE_PATH }) {
  // 'undefined' as a string might happen: `String(undefined)`
  if (!COTYPE_BASE_PATH || COTYPE_BASE_PATH === 'undefined') {
    return BASE_PATH;
  }

  return COTYPE_BASE_PATH;
}

async function importConfigFile(path: string, resetCache: boolean) {
  if (resetCache) {
    delete require.cache[path];
  }

  const mod = await import(path);

  return {
    opts: importDefault(mod),
    client: mod.client,
  };
}

export default async function getConfig(
  { env, cwd },
  resetCache?: boolean,
): Promise<{
  config: Opts;
  client: (methods?: Method[]) => Method[];
}> {
  const user = env.COTYPE_CONFIG_FILE
    ? await importConfigFile(
        resolve(cwd(), env.COTYPE_CONFIG_FILE),
        Boolean(resetCache),
      )
    : { opts: {}, client: false };

  const basePath = getBasePath(env);

  const defaults: Partial<Opts> = {
    models: [
      {
        name: 'Startpage',
        singular: 'Startpage',
        collection: 'singleton',
        fields: {
          pageTitle: {
            label: 'Title',
            type: 'string',
          },
        },
      },
    ],
    basePath,
    sessionOpts: {
      secret: env.SESSION_SECRET,
      secure: env.IS_OFFLINE ? false : true,
    },
    baseUrls: {
      cms: env.CMS_URL,
    },
    storage: new S3Storage(env.MEDIA_BUCKET!),
    persistenceAdapter: knexAdapter(false),
  };

  return Promise.resolve({
    config: {
      ...defaults,
      ...user.opts,
    },
    client: user.client || (() => []),
  });
}
