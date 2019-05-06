import { APIGatewayProxyEvent, Context } from 'aws-lambda';
import { init } from '@cotype/core';
import S3Storage from './S3Storage';
import knexAdapter from './knexAdapter';
import { resolve } from 'path';
import serverless from 'serverless-http';
import cached from './cached';

type LambdaPartial = Promise<
  (event: APIGatewayProxyEvent, context: Context) => void
>;

const isOffline = process.env.IS_OFFLINE;

function importDefault(mod: any) {
  return mod.default ? mod.default : mod;
}

function getBasePath() {
  if (
    !process.env.COTYPE_BASE_PATH ||
    process.env.COTYPE_BASE_PATH === 'undefined'
  ) {
    return process.env.BASE_PATH;
  }

  return process.env.COTYPE_BASE_PATH;
}

async function getCotype() {
  const userOpts = process.env.COTYPE_CONFIG_FILE
    ? importDefault(
        await import(resolve(process.cwd(), process.env.COTYPE_CONFIG_FILE)),
      )
    : {};

  const config = {
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
    basePath: getBasePath(),
    sessionOpts: {
      secret: process.env.SESSION_SECRET,
      secure: isOffline ? false : true,
    },
    storage: new S3Storage(process.env.MEDIA_BUCKET!),
    persistenceAdapter: knexAdapter(false),
    ...userOpts,
  };

  return init(config);
}

async function getServer() {
  return serverless((await getCotype()).app);
}

export default (isOffline ? getServer : cached<LambdaPartial>(getServer));
