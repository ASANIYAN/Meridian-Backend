import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient, type RedisClientType } from 'redis';

@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  private readonly client: RedisClientType;
  // A subscribed Redis connection can't issue other commands, so publishing and
  // blacklisting need a separate connection from subscribing.
  private readonly subscriber: RedisClientType;
  private readonly PRESENCE_TTL = 12 * 60 * 60;
  private readonly host: string;

  constructor(private readonly configService: ConfigService) {
    const url = this.configService.getOrThrow<string>('REDIS_URL');
    this.host = new URL(url).host;

    this.client = createClient({
      url,
      socket: {
        // Exponential backoff capped at 30 s; retries indefinitely.
        reconnectStrategy: (retries) => Math.min(retries * 100, 30_000),
      },
    });
    // duplicate() creates a second connection sharing the same config, avoiding
    // the need to call createClient() again with the same URL.
    this.subscriber = this.client.duplicate();

    this.client.on('error', (error: Error) => {
      this.logger.error(
        `Redis client error (host: ${this.host}): ${error.message}`,
      );
    });

    this.subscriber.on('error', (error: Error) => {
      this.logger.error(
        `Redis subscriber error (host: ${this.host}): ${error.message}`,
      );
    });
  }

  // Opens both connections and verifies reachability with PING when the module starts.
  async onModuleInit() {
    if (this.client.isOpen && this.subscriber.isOpen) {
      return;
    }

    await this.client.connect();
    await this.subscriber.connect();
    await this.client.ping();
    this.logger.log(
      `Redis client and subscriber connected (host: ${this.host})`,
    );
  }

  // Gracefully closes both connections on app shutdown so in-flight commands finish.
  async onModuleDestroy() {
    if (this.client.isOpen) await this.client.quit();
    if (this.subscriber.isOpen) await this.subscriber.quit();
    this.logger.log('Redis clients disconnected');
  }

  // Publishes a binary payload to a Redis pub/sub channel (e.g. a Yjs update frame).
  // Uses raw sendCommand because the typed publish helper encodes data as a string,
  // which corrupts binary payloads.
  async publish(channel: string, data: Buffer) {
    await this.client.sendCommand(['PUBLISH', channel, data]);
  }

  // Registers a callback that fires whenever a message arrives on the channel.
  // The `true` flag enables buffer mode so the callback receives raw bytes, not a string.
  async subscribe(channel: string, callback: (data: Buffer) => void) {
    await this.subscriber.subscribe(channel, callback, true);
  }

  async unsubscribe(channel: string) {
    await this.subscriber.unsubscribe(channel);
  }

  async ping(): Promise<void> {
    await this.client.ping();
  }

  // Adds a JWT ID to the revocation list with an expiry matching the token's remaining TTL.
  // Skipped if ttlSeconds <= 0 — the token is already expired, no need to store it.
  async blacklistToken(jti: string, ttlSeconds: number) {
    if (ttlSeconds <= 0) {
      return;
    }

    await this.client.set(this.getBlacklistKey(jti), '1', {
      expiration: {
        type: 'EX',
        value: ttlSeconds,
      },
    });
  }

  // Returns true if the JWT ID is on the revocation list.
  async isTokenBlacklisted(jti: string): Promise<boolean> {
    const value = await this.client.exists(this.getBlacklistKey(jti));
    return value === 1;
  }

  // Tries to acquire an exclusive lock by setting a key only if it doesn't exist (NX).
  // Returns true if this caller got the lock, false if someone else already holds it.
  // The key auto-expires after ttlSeconds so stale locks don't block forever.
  async tryAcquireLock(key: string, ttlSeconds: number): Promise<boolean> {
    const result = await this.client.set(key, '1', {
      condition: 'NX',
      expiration: { type: 'EX', value: ttlSeconds },
    });
    return result === 'OK';
  }

  // Stages an AI edit proposal under proposal:{id} with an expiry. The value is the
  // JSON-serialized proposal; the key's TTL is the entire cleanup mechanism — if the
  // author never accepts or declines, Redis drops it on its own.
  async stageProposal(
    proposalId: string,
    value: string,
    ttlSeconds: number,
  ): Promise<void> {
    await this.client.set(this.getProposalKey(proposalId), value, {
      expiration: { type: 'EX', value: ttlSeconds },
    });
  }

  // Reads a staged proposal without consuming it, refreshing its TTL so a proposal
  // that has to bounce through a re-confirmation step doesn't expire mid-review.
  // Returns null if the key is missing or already expired.
  async peekProposal(
    proposalId: string,
    ttlSeconds: number,
  ): Promise<string | null> {
    const key = this.getProposalKey(proposalId);
    const value = await this.client.get(key);
    if (value !== null) {
      await this.client.expire(key, ttlSeconds);
    }
    return value;
  }

  // Atomically reads and deletes a proposal. This is the exactly-once gate for accept:
  // only the caller that gets a non-null result owns the proposal and may apply it, so
  // two racing accepts can never double-apply the staged operations.
  async consumeProposal(proposalId: string): Promise<string | null> {
    return this.client.getDel(this.getProposalKey(proposalId));
  }

  // Discards a staged proposal. Idempotent — deleting an already-gone key is a no-op,
  // which is exactly what decline wants.
  async deleteProposal(proposalId: string): Promise<void> {
    await this.client.del(this.getProposalKey(proposalId));
  }

  private getProposalKey(proposalId: string) {
    return `proposal:${proposalId}`;
  }

  // Atomically increments a counter key, setting a TTL (ms) on the first hit.
  // Returns [hitCount, remainingTtlMs] from a Lua script so both ops are atomic.
  async throttleIncrement(
    key: string,
    ttlMs: number,
  ): Promise<[number, number]> {
    const script = `
      local c = redis.call('INCR', KEYS[1])
      if c == 1 then redis.call('PEXPIRE', KEYS[1], ARGV[1]) end
      return {c, redis.call('PTTL', KEYS[1])}
    `;
    const raw = await this.client.eval(script, {
      keys: [key],
      arguments: [String(ttlMs)],
    });
    const result = raw as unknown as [number, number];
    return [Number(result[0]), Number(result[1])];
  }

  // Records one more live connection for this user on a document and returns the
  // user's resulting total connection count across the whole cluster. A return of 1
  // means this is the user's first connection (they just became present); anything
  // higher means they were already present on another tab/instance. Refreshes the TTL
  // on both presence keys so an active room never lets its presence state expire.
  async presenceJoin(documentId: string, userId: string): Promise<number> {
    const n = await this.client.hIncrBy(
      this.getPresenceCountKey(documentId),
      userId,
      1,
    );
    await this.client.expire(
      this.getPresenceCountKey(documentId),
      this.PRESENCE_TTL,
    );
    await this.client.expire(
      this.getPresenceIdentityKey(documentId),
      this.PRESENCE_TTL,
    );

    return n;
  }

  // Stores the display name shown in the roster for a present user. Called once, on a
  // user's first connection, so the identity hash's fields stay in lockstep with the
  // set of currently-present users.
  async setPresenceIdentity(
    documentId: string,
    userId: string,
    name: string,
  ): Promise<void> {
    await this.client.hSet(
      this.getPresenceIdentityKey(documentId),
      userId,
      name,
    );
    await this.client.expire(
      this.getPresenceIdentityKey(documentId),
      this.PRESENCE_TTL,
    );
  }

  // Removes one live connection for this user. Returns the user's remaining connection
  // count and, when that reaches 0 (their last connection closed, so they are no longer
  // present), the display name to announce as offline. The decrement, the identity read,
  // and the cleanup of both keys run as one Lua script so a reconnect landing mid-leave
  // can't corrupt the count or strand an identity field.
  async presenceLeave(
    documentId: string,
    userId: string,
  ): Promise<{ remaining: number; name: string | null }> {
    const script = `
      local n = redis.call('HINCRBY', KEYS[1], ARGV[1], -1)
      if n <= 0 then
        local name = redis.call('HGET', KEYS[2], ARGV[1])
        redis.call('HDEL', KEYS[1], ARGV[1])
        redis.call('HDEL', KEYS[2], ARGV[1])
        return {0, name}
      end
      return {n, false}
    `;
    const raw = (await this.client.eval(script, {
      keys: [
        this.getPresenceCountKey(documentId),
        this.getPresenceIdentityKey(documentId),
      ],
      arguments: [userId],
    })) as [number, string | null | boolean];

    // The Lua `false` (no name; user still present) comes back as either null or false
    // depending on the RESP protocol version, so anything non-string normalizes to null.
    const name = typeof raw[1] === 'string' ? raw[1] : null;
    return { remaining: Number(raw[0]), name };
  }

  // The live roster for a document as a { userId: displayName } map — exactly the set
  // of users currently present, since identity fields are added on first join and
  // removed on last leave.
  async presenceRoster(documentId: string): Promise<Record<string, string>> {
    return this.client.hGetAll(this.getPresenceIdentityKey(documentId));
  }

  private getPresenceCountKey(documentId: string) {
    return `presence:doc:${documentId}:count`;
  }

  private getPresenceIdentityKey(documentId: string) {
    return `presence:doc:${documentId}:identity`;
  }

  private getBlacklistKey(jti: string) {
    return `auth:blacklist:${jti}`;
  }
}
