
import * as config from "./config";
import * as redis from 'redis'

const Client = redis.createClient({
  url: config.get('REDIS_CONNECTION_URL') as string,
  socket: {
    reconnectStrategy: () => 2000
  }
});

let readyToSend = false;
export function online(): boolean {
  return readyToSend;
};

Client.on('end', () => {
  readyToSend = false;
});

Client.on('reconnecting', () => {
  readyToSend = false;
});

Client.on('ready', () => {
  readyToSend = true;
});

export async function connect(): Promise<void> {
  return Client.connect();
}

export async function get(key: string): Promise<string> {
  return Client.get(key);
}

export async function del(key: string): Promise<number> {
  return Client.del(key);
}

export async function getList(key: string): Promise<string[]> {
  return Client.lRange(key, 0, -1);
}

export async function setWithExpire(
  key: string,
  value: string,
  expire: number
): Promise<void> {
  await Client
    .multi()
    .set(key, value)
    .expire(key, expire)
    .exec()
}

export async function pop(key: string): Promise<string> {
  return Client.getDel(key)
}
