import { APIGatewayProxyEvent, Context } from 'aws-lambda';
import { init } from '@cotype/core';
import serverless from 'serverless-http';
import cached from './cached';
import getConfig from './getConfig';

type LambdaPartial = Promise<
  (event: APIGatewayProxyEvent, context: Context) => void
>;

const isOffline = process.env.IS_OFFLINE;

export async function getCotype() {
  return init((await getConfig(process)).config);
}

async function getServer() {
  return serverless((await getCotype()).app);
}

export default (isOffline ? getServer : cached<LambdaPartial>(getServer));
