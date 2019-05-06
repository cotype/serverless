import { Handler, APIGatewayProxyEvent } from 'aws-lambda';
import knexAdapter from './knexAdapter';
import getCotype from './getCotype';

export const cotype: Handler<APIGatewayProxyEvent> = async (event, context) =>
  (await getCotype())(event, context);

export async function migrate() {
  try {
    const p = await knexAdapter(true);
    p.shutdown();
    return { status: 0 };
  } catch (e) {
    return { status: e.status || 1, message: e.message };
  }
}
